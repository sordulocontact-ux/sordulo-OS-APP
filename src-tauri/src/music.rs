//! Musique écoutée sur l'ordinateur, montrée par l'île (pochette, titre, artiste, contrôles).
//!
//! Sources : le lecteur du système (`platform::now_playing`) et, si un compte est connecté, Spotify sur un
//! autre appareil (`spotify/`, dernière lecture connue, sondée par son propre thread). L'ordinateur d'abord :
//! ce qui joue sur l'ordinateur passe devant ; sinon Spotify à distance (en lecture ou en pause) ; sinon le
//! lecteur du système en pause (`spotify::prefer_remote`). Spotify à distance : `appId` « spotify:connect »,
//! `appName` « Spotify sur <appareil> », `canControl` selon Premium.
//!
//! Une boucle (~1 s) choisit le morceau à montrer et émet `desktop://music` (payload `MusicState | null`)
//! vers l'île SEULEMENT quand quelque chose change : morceau, lecteur, lecture / pause, pochette, durée,
//! commandes possibles, ou position qui saute de plus de 2 s par rapport à celle attendue (avance ou recul
//! manuel). La position qui avance toute seule n'est pas émise : le front l'avance à partir de `positionMs` /
//! `positionAt`.
//!
//! Pochette : `artworkId` est un compteur (en chaîne) qui change à chaque nouvelle image ; les octets sont
//! gardés ici pour `get_music_artwork`. La pochette est relue quand sa clé change, puis encore quelques tours
//! (sous Windows, certains lecteurs donnent le titre avant la nouvelle image) : même image = même id.
//! Spotify à distance : la clé est l'URL https de la pochette, ses octets sont déjà téléchargés par
//! `spotify/` ; même cache et même `artworkId` que la pochette du système.
//!
//! Apps d'appel (Teams, Zoom, Discord…) : jamais montrées (`call_apps`). Case « Afficher la musique dans
//! l'île » du menu du soleil décochée : un `null` est émis une fois, plus aucun sondage, `get_music` rend `null`.
//!
//! Vrai son (`music_levels`) : à chaque tour, l'analyse du son de l'ordinateur est démarrée si le morceau
//! montré est en lecture sur l'ordinateur (pas Spotify à distance, `Tracker::plays_on_computer`), arrêtée
//! sinon ; arrêtée aussi quand la case est décochée.
//!
//! Tempo (`music_tempo`) : à chaque tour, le tempo du morceau montré est demandé à Deezer (réponse au tour
//! suivant, gardée en cache) et part dans `tempoBpm` ; son arrivée suffit à émettre un nouvel état.
//!
//! Tout ce qui est pur (nom du lecteur, exclusion, choix de la session, détection des changements, choix entre
//! l'ordinateur et Spotify : `spotify/player.rs`) est testé
//! plus bas ; seuls `spawn_music_loop`, `publish`, `clear` et les accès à l'état touchent Tauri.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::call_apps::{self, CallApp};
use crate::events::{EVENT_MUSIC, WINDOW_PROMPT};
use crate::music_levels;
use crate::music_tempo;
use crate::platform::{self, NowPlaying};
use crate::spotify::{self, RemotePlayback};
use crate::state::DesktopState;

/// Période de sondage du lecteur.
const POLL: Duration = Duration::from_secs(1);
/// Écart (ms) entre la position lue et celle attendue au-delà duquel on prévient l'île (avance / recul manuel).
const POSITION_JUMP_MS: u64 = 2_000;
/// Relectures de la pochette après un changement de clé (une par tour).
const ARTWORK_RECHECKS: u8 = 3;
/// Erreurs de suite avant de considérer qu'il n'y a plus de musique.
const ERRORS_BEFORE_CLEAR: u32 = 5;

// ---------------------------------------------------------------------------
// Types du contrat IPC
// ---------------------------------------------------------------------------

/// `MusicState` du contrat (`src/shared/desktop-contract.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicState {
    /// AppUserModelId (Windows) ou bundle id (macOS).
    pub app_id: String,
    /// Nom du lecteur montré à l'utilisateur (« Spotify », « Google Chrome », « Musique »).
    pub app_name: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub playing: bool,
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    /// Epoch Unix en ms de la lecture de `position_ms`.
    pub position_at: u64,
    pub artwork_id: Option<String>,
    /// Boutons précédent / lecture-pause / suivant possibles. Absent (lecteur du système) : oui. `false` :
    /// Spotify sur un autre appareil sans Premium (ou appareil qui refuse les commandes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_control: Option<bool>,
    /// Tempo du morceau d'après Deezer (`music_tempo`). Absent : inconnu, ou pas encore trouvé.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tempo_bpm: Option<f64>,
}

/// Pochette courante : identifiant donné au front et octets bruts (PNG ou JPEG).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artwork {
    pub id: String,
    pub bytes: Arc<Vec<u8>>,
}

/// Ce que `get_music` et `get_music_artwork` lisent : le dernier état émis et sa pochette.
#[derive(Debug, Default)]
pub struct MusicHub {
    state: Option<MusicState>,
    artwork: Option<Artwork>,
}

// ---------------------------------------------------------------------------
// Pur : nom du lecteur, exclusion, choix de la session
// ---------------------------------------------------------------------------

/// Lecteurs connus : mot cherché dans l'identifiant (minuscules) → nom affiché. Ordre important (le premier
/// trouvé gagne : `com.apple.music` avant `applemusic`).
const PLAYER_NAMES: &[(&str, &str)] = &[
    ("spotify", "Spotify"),
    ("deezer", "Deezer"),
    ("com.apple.music", "Musique"),
    ("applemusic", "Apple Music"),
    ("zunemusic", "Lecteur multimédia"),
    ("tidal", "TIDAL"),
    ("qobuz", "Qobuz"),
    ("vlc", "VLC"),
    ("chrome", "Google Chrome"),
    ("msedge", "Microsoft Edge"),
    ("edgemac", "Microsoft Edge"),
    ("firefox", "Firefox"),
    ("brave", "Brave"),
    ("vivaldi", "Vivaldi"),
    ("opera", "Opera"),
    ("thebrowser", "Arc"),
    ("com.apple.safari", "Safari"),
];

/// Firefox sous Windows s'annonce par une empreinte de son dossier d'installation : 16 chiffres
/// hexadécimaux (`308046B0AF4A39CB` pour l'installation habituelle).
pub fn is_firefox_app_id(app_id: &str) -> bool {
    app_id.len() == 16 && app_id.chars().all(|c| c.is_ascii_hexdigit())
}

/// Nom du lecteur montré à l'utilisateur, d'après son identifiant (AppUserModelId Windows, bundle id Mac).
/// Inconnu : nom tiré de l'identifiant (`AIMP.exe` → « AIMP », `com.foo.Player` → « Player »).
pub fn player_name(app_id: &str) -> String {
    if is_firefox_app_id(app_id) {
        return "Firefox".to_owned();
    }
    let lower = app_id.to_lowercase();
    if let Some((_, name)) = PLAYER_NAMES.iter().find(|(word, _)| lower.contains(word)) {
        return (*name).to_owned();
    }
    // Paquet Windows (`Famille_empreinte!App`) : la famille ; chemin : le fichier.
    let base = app_id.split('!').next().unwrap_or(app_id);
    let base = base.split('_').next().unwrap_or(base);
    let base = base.rsplit(['\\', '/']).next().unwrap_or(base);
    let base = match base.len().checked_sub(4) {
        Some(cut) if base.is_char_boundary(cut) && base[cut..].eq_ignore_ascii_case(".exe") => {
            &base[..cut]
        }
        _ => base,
    };
    let base = base
        .rsplit('.')
        .find(|part| !part.is_empty())
        .unwrap_or(base)
        .trim();
    if base.is_empty() {
        return app_id.to_owned();
    }
    let mut chars = base.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => app_id.to_owned(),
    }
}

/// Lecture jamais montrée : apps d'appel (Teams, Zoom, Discord… voir `call_apps`) et Sordulo OS elle-même.
pub fn is_excluded(app_id: &str) -> bool {
    call_apps::classify(app_id) == Some(CallApp::Dedicated)
        || app_id.to_lowercase().contains("sordulo")
}

/// État de lecture d'une session, pour choisir laquelle montrer.
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Playback {
    Playing,
    Paused,
    /// Arrêtée, fermée, rien de chargé : jamais montrée.
    Inactive,
}

/// Session à montrer parmi `candidates` (identifiant, état), dans l'ordre de préférence de l'appelant :
/// la première en lecture, sinon la première en pause ; jamais une app exclue (`is_excluded`).
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
pub fn pick_session(candidates: &[(&str, Playback)]) -> Option<usize> {
    let allowed = |state: Playback| {
        candidates
            .iter()
            .position(|(id, s)| *s == state && !is_excluded(id))
    };
    allowed(Playback::Playing).or_else(|| allowed(Playback::Paused))
}

// ---------------------------------------------------------------------------
// Pur : détection des changements et pochette
// ---------------------------------------------------------------------------

/// Morceau à montrer, avec ce qui dépend de sa source (nom affiché, commandes possibles) et son tempo.
#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub now: NowPlaying,
    pub app_name: String,
    pub can_control: Option<bool>,
    pub tempo_bpm: Option<f64>,
}

impl Track {
    /// Lecteur du système : nom tiré de son identifiant, commandes toujours possibles.
    pub fn system(now: NowPlaying) -> Self {
        Self {
            app_name: player_name(&now.app_id),
            can_control: None,
            tempo_bpm: None,
            now,
        }
    }

    /// Spotify sur un autre appareil.
    pub fn remote(playback: &RemotePlayback) -> Self {
        Self {
            now: playback.track.clone(),
            app_name: playback.app_name.clone(),
            can_control: Some(playback.can_control),
            tempo_bpm: None,
        }
    }

    /// Le même morceau avec son tempo (`music_tempo`).
    pub fn with_tempo(self, tempo_bpm: Option<f64>) -> Self {
        Self { tempo_bpm, ..self }
    }
}

/// Suit le morceau en cours entre deux tours : dernier état émis, pochette, relectures restantes.
#[derive(Debug, Default)]
pub struct Tracker {
    emitted: Option<MusicState>,
    artwork_key: Option<String>,
    artwork: Option<Artwork>,
    rechecks: u8,
    next_artwork: u64,
}

impl Tracker {
    /// Faut-il lire la pochette à ce tour (clé changée, ou relecture prévue) ?
    pub fn wants_artwork(&self, playing: Option<&NowPlaying>) -> bool {
        match playing.and_then(|p| p.artwork_key.as_deref()) {
            None => false,
            Some(key) => self.artwork_key.as_deref() != Some(key) || self.rechecks > 0,
        }
    }

    /// Comme [`Tracker::update_track`], pour un morceau du lecteur du système.
    #[cfg(test)]
    pub fn update(
        &mut self,
        playing: Option<NowPlaying>,
        fetched: Option<Option<Vec<u8>>>,
    ) -> Option<Option<MusicState>> {
        self.update_track(playing.map(Track::system), fetched)
    }

    /// Intègre le morceau à montrer. `fetched` : résultat de la lecture de la pochette si `wants_artwork`
    /// l'a demandée (`Some(None)` : pas d'image), `None` si elle n'a pas été lue.
    /// Renvoie `Some(état)` quand il faut émettre (`Some(None)` : plus de musique), `None` sinon.
    pub fn update_track(
        &mut self,
        playing: Option<Track>,
        fetched: Option<Option<Vec<u8>>>,
    ) -> Option<Option<MusicState>> {
        let next = match playing {
            Some(track) => {
                self.apply_artwork(&track.now, fetched);
                Some(self.state_of(track))
            }
            None => {
                self.artwork_key = None;
                self.artwork = None;
                self.rechecks = 0;
                None
            }
        };
        if !should_emit(self.emitted.as_ref(), next.as_ref()) {
            return None;
        }
        self.emitted = next.clone();
        Some(next)
    }

    /// Pochette de l'état émis en dernier (pour `get_music_artwork`).
    pub fn artwork(&self) -> Option<&Artwork> {
        self.artwork.as_ref()
    }

    /// Le morceau émis en dernier est en lecture sur l'ordinateur (lecteur du système, pas Spotify sur un
    /// autre appareil) : c'est lui que `music_levels` analyse.
    pub fn plays_on_computer(&self) -> bool {
        self.emitted
            .as_ref()
            .is_some_and(|m| m.playing && m.app_id != spotify::APP_ID)
    }

    fn apply_artwork(&mut self, p: &NowPlaying, fetched: Option<Option<Vec<u8>>>) {
        let key_changed = self.artwork_key != p.artwork_key;
        if key_changed {
            self.artwork_key = p.artwork_key.clone();
            self.rechecks = if p.artwork_key.is_some() {
                ARTWORK_RECHECKS
            } else {
                0
            };
        }
        if p.artwork_key.is_none() {
            self.artwork = None;
            return;
        }
        match fetched {
            // Pas lue alors que la clé a changé : l'ancienne image n'est plus la bonne.
            None if key_changed => self.artwork = None,
            None => {}
            Some(result) => {
                if !key_changed {
                    self.rechecks = self.rechecks.saturating_sub(1);
                }
                match result.filter(|bytes| !bytes.is_empty()) {
                    Some(bytes) => {
                        let same = self.artwork.as_ref().is_some_and(|a| *a.bytes == bytes);
                        if !same {
                            self.next_artwork += 1;
                            self.artwork = Some(Artwork {
                                id: self.next_artwork.to_string(),
                                bytes: Arc::new(bytes),
                            });
                        }
                    }
                    // Pas (encore) d'image pour ce morceau ; en relecture, on garde celle qu'on a.
                    None if key_changed => self.artwork = None,
                    None => {}
                }
            }
        }
    }

    fn state_of(&self, track: Track) -> MusicState {
        let p = track.now;
        MusicState {
            app_name: track.app_name,
            app_id: p.app_id,
            title: p.title,
            artist: p.artist,
            album: p.album,
            playing: p.playing,
            position_ms: p.position_ms,
            duration_ms: p.duration_ms,
            position_at: p.position_at,
            artwork_id: self.artwork.as_ref().map(|a| a.id.clone()),
            can_control: track.can_control,
            tempo_bpm: track.tempo_bpm,
        }
    }
}

/// Faut-il prévenir l'île ? Jamais juste parce que la position avance normalement.
fn should_emit(previous: Option<&MusicState>, next: Option<&MusicState>) -> bool {
    match (previous, next) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(a), Some(b)) => {
            a.app_id != b.app_id
                || a.app_name != b.app_name
                || a.can_control != b.can_control
                || a.title != b.title
                || a.artist != b.artist
                || a.album != b.album
                || a.playing != b.playing
                || a.duration_ms != b.duration_ms
                || a.artwork_id != b.artwork_id
                || a.tempo_bpm != b.tempo_bpm
                || position_jumped(a, b)
        }
    }
}

/// La position lue s'écarte de plus de `POSITION_JUMP_MS` de celle que le front calcule depuis `previous`.
fn position_jumped(previous: &MusicState, next: &MusicState) -> bool {
    match (previous.position_ms, next.position_ms) {
        (None, None) => false,
        (Some(before), Some(now)) => {
            let elapsed = if previous.playing {
                next.position_at.saturating_sub(previous.position_at)
            } else {
                0
            };
            before.saturating_add(elapsed).abs_diff(now) > POSITION_JUMP_MS
        }
        _ => true,
    }
}

// ---------------------------------------------------------------------------
// Tauri : boucle, état partagé, interrupteur
// ---------------------------------------------------------------------------

/// Dernier état émis (`get_music`) : `None` si rien ne joue ou si la musique est masquée.
pub fn current(app: &AppHandle) -> Option<MusicState> {
    app.state::<DesktopState>().music().state.clone()
}

/// Octets de la pochette `artwork_id`, erreur si ce n'est plus la pochette courante.
pub fn artwork(app: &AppHandle, artwork_id: &str) -> Result<Arc<Vec<u8>>, String> {
    let state = app.state::<DesktopState>();
    let hub = state.music();
    match &hub.artwork {
        Some(artwork) if artwork.id == artwork_id => Ok(Arc::clone(&artwork.bytes)),
        _ => Err("Cette pochette n'est plus celle du morceau en cours.".into()),
    }
}

/// Musique masquée (case du menu du soleil décochée) : oublie l'état et émet `null` une fois. La boucle
/// arrête de sonder tant que la case reste décochée (elle lit `Shared::music_enabled`).
pub fn clear(app: &AppHandle) {
    music_levels::set_active(app, false);
    let state = app.state::<DesktopState>();
    let mut hub = state.music();
    hub.state = None;
    hub.artwork = None;
    emit(app, None);
}

fn emit(app: &AppHandle, music: Option<&MusicState>) {
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_MUSIC, music) {
        log::warn!("émission de {EVENT_MUSIC} impossible : {e}");
    }
}

/// Publie un nouvel état (et sa pochette) puis le signale à l'île, sauf si la musique vient d'être masquée.
/// Verrous : `music` puis `shared` (jamais l'inverse) ; `clear` passe après, donc le `null` reste le dernier.
fn publish(app: &AppHandle, music: Option<MusicState>, artwork: Option<Artwork>) {
    let state = app.state::<DesktopState>();
    let mut hub = state.music();
    if !state.shared().music_enabled {
        return;
    }
    match (&hub.state, &music) {
        (None, Some(m)) => log::info!("musique détectée ({})", m.app_name),
        (Some(_), None) => log::info!("musique : plus rien en cours"),
        _ => {}
    }
    if let Some(m) = &music {
        log::debug!(
            "musique : {} · {} ({}, {})",
            m.title,
            m.artist.as_deref().unwrap_or("artiste inconnu"),
            m.app_name,
            if m.playing { "lecture" } else { "pause" }
        );
    }
    emit(app, music.as_ref());
    hub.state = music;
    hub.artwork = artwork;
}

/// Lance la boucle de la musique (une fois, dans `setup`).
pub fn spawn_music_loop(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("music-monitor".into())
        .spawn(move || {
            log::info!("boucle de la musique démarrée (toutes les {POLL:?})");
            let mut tracker = Tracker::default();
            let mut errors: u32 = 0;
            let mut last_error = String::new();
            loop {
                let enabled = app.state::<DesktopState>().shared().music_enabled;
                if !enabled {
                    // Masquée : plus aucun sondage ; on repartira de zéro (le `null` est émis par `clear`).
                    music_levels::set_active(&app, false);
                    tracker = Tracker::default();
                    errors = 0;
                    thread::sleep(POLL);
                    continue;
                }
                let local = match platform::now_playing() {
                    Ok(playing) => {
                        errors = 0;
                        last_error.clear();
                        playing.filter(|p| !is_excluded(&p.app_id))
                    }
                    Err(e) => {
                        let message = format!("{e:#}");
                        // Une erreur qui se répète chaque seconde : signalée une fois, puis en debug.
                        if message != last_error {
                            log::warn!("lecture de la musique en cours : {message}");
                            last_error = message;
                        } else {
                            log::debug!("lecture de la musique en cours : {message}");
                        }
                        errors = errors.saturating_add(1);
                        // Quelques erreurs : on garde ce qui est montré ; au-delà, plus rien sur l'ordinateur.
                        if errors < ERRORS_BEFORE_CLEAR {
                            thread::sleep(POLL);
                            continue;
                        }
                        None
                    }
                };
                spotify::set_local_playing(&app, local.as_ref().is_some_and(|p| p.playing));
                // L'ordinateur d'abord, Spotify à distance quand rien n'y joue.
                let remote = spotify::remote(&app)
                    .filter(|r| spotify::prefer_remote(local.as_ref(), &r.playback));
                let (track, remote_artwork) = match remote {
                    Some(r) => (Some(Track::remote(&r.playback)), Some(r.artwork)),
                    None => (local.map(Track::system), None),
                };
                // Tempo connu (sinon demandé à Deezer, pour un prochain tour).
                let track = track.map(|t| {
                    let bpm = music_tempo::bpm(t.now.artist.as_deref(), &t.now.title);
                    t.with_tempo(bpm)
                });
                let fetched = tracker
                    .wants_artwork(track.as_ref().map(|t| &t.now))
                    .then(|| match remote_artwork {
                        Some(bytes) => bytes.map(|b| b.to_vec()),
                        None => read_artwork(),
                    });
                if let Some(music) = tracker.update_track(track, fetched) {
                    publish(&app, music, tracker.artwork().cloned());
                }
                // Vrai son : seulement pour la musique en lecture sur l'ordinateur, case toujours cochée
                // (relue : elle a pu être décochée pendant ce tour).
                let analyze = tracker.plays_on_computer()
                    && app.state::<DesktopState>().shared().music_enabled;
                music_levels::set_active(&app, analyze);
                thread::sleep(POLL);
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer la boucle de la musique : {e}");
    }
}

fn read_artwork() -> Option<Vec<u8>> {
    platform::now_playing_artwork().unwrap_or_else(|e| {
        log::debug!("pochette illisible : {e:#}");
        None
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::MediaCommand;

    fn track(title: &str) -> NowPlaying {
        NowPlaying {
            app_id: "Spotify.exe".into(),
            title: title.into(),
            artist: Some("Daft Punk".into()),
            album: Some("Discovery".into()),
            playing: true,
            position_ms: Some(10_000),
            duration_ms: Some(200_000),
            position_at: 1_000_000,
            artwork_key: Some(format!("cle-{title}")),
        }
    }

    /// Même morceau, lu `dt` ms plus tard, la position ayant avancé de `advance` ms.
    fn later(p: &NowPlaying, dt: u64, advance: u64) -> NowPlaying {
        NowPlaying {
            position_ms: p.position_ms.map(|ms| ms + advance),
            position_at: p.position_at + dt,
            ..p.clone()
        }
    }

    #[test]
    fn noms_des_lecteurs() {
        for (id, name) in [
            ("Spotify.exe", "Spotify"),
            ("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"),
            ("com.spotify.client", "Spotify"),
            ("Chrome", "Google Chrome"),
            ("com.google.Chrome", "Google Chrome"),
            ("MSEdge", "Microsoft Edge"),
            ("com.microsoft.edgemac", "Microsoft Edge"),
            ("firefox.exe", "Firefox"),
            ("308046B0AF4A39CB", "Firefox"),
            ("E7CF176E110C211B", "Firefox"),
            ("Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music", "Deezer"),
            ("com.apple.Music", "Musique"),
            ("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App", "Apple Music"),
            (
                "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic",
                "Lecteur multimédia",
            ),
            ("TheBrowserCompany.Arc_ttt1ap7aakyb4!Arc", "Arc"),
            ("company.thebrowser.Browser", "Arc"),
            ("com.apple.Safari", "Safari"),
        ] {
            assert_eq!(player_name(id), name, "{id}");
        }
    }

    #[test]
    fn nom_tire_de_l_identifiant() {
        assert_eq!(player_name("AIMP.exe"), "AIMP");
        assert_eq!(player_name("foobar2000.EXE"), "Foobar2000");
        assert_eq!(player_name("com.example.player"), "Player");
        assert_eq!(player_name("Editeur.MonLecteur_abc123!App"), "MonLecteur");
        assert_eq!(
            player_name("C:\\Programmes\\Lecteur\\lecteur.exe"),
            "Lecteur"
        );
        assert_eq!(player_name("..."), "...");
        assert_eq!(player_name("été.exe"), "Été");
    }

    #[test]
    fn apps_d_appel_exclues() {
        for id in [
            "MSTeams_8wekyb3d8bbwe!MSTeams",
            "com.squirrel.Discord.Discord",
            "Zoom.exe",
            "us.zoom.xos",
            "com.hnc.Discord",
            "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App",
            "com.sordulo.os",
        ] {
            assert!(is_excluded(id), "{id}");
        }
        for id in [
            "Spotify.exe",
            "com.spotify.client",
            "Chrome",
            "com.apple.Music",
            "MSEdge",
        ] {
            assert!(!is_excluded(id), "{id}");
        }
    }

    #[test]
    fn choix_de_la_session() {
        use Playback::{Inactive, Paused, Playing};
        // Celle qui joue, même si une autre (la session courante) est en pause avant elle.
        assert_eq!(
            pick_session(&[("Chrome", Paused), ("Spotify.exe", Playing)]),
            Some(1)
        );
        // Rien ne joue : la première en pause.
        assert_eq!(
            pick_session(&[("Chrome", Inactive), ("Spotify.exe", Paused)]),
            Some(1)
        );
        // Ordre de l'appelant en cas d'égalité.
        assert_eq!(
            pick_session(&[("Chrome", Playing), ("Spotify.exe", Playing)]),
            Some(0)
        );
        // Teams qui « joue » n'est jamais montré.
        assert_eq!(
            pick_session(&[
                ("MSTeams_8wekyb3d8bbwe!MSTeams", Playing),
                ("Spotify.exe", Paused)
            ]),
            Some(1)
        );
        assert_eq!(pick_session(&[("Chrome", Inactive)]), None);
        assert_eq!(pick_session(&[]), None);
    }

    #[test]
    fn emet_au_debut_puis_pas_quand_la_position_avance() {
        let mut t = Tracker::default();
        let a = track("One More Time");
        assert!(t.wants_artwork(Some(&a)));
        let first = t
            .update(Some(a.clone()), Some(Some(vec![1, 2, 3])))
            .expect("émis");
        let first = first.expect("état");
        assert_eq!(first.app_name, "Spotify");
        assert_eq!(first.artwork_id.as_deref(), Some("1"));
        // 1 s plus tard, la position a avancé d'1 s : rien à émettre.
        let b = later(&a, 1_000, 1_000);
        let fetched = t.wants_artwork(Some(&b)).then_some(Some(vec![1, 2, 3]));
        assert_eq!(t.update(Some(b.clone()), fetched), None);
        // Windows : position et horodatage figés entre deux mises à jour du lecteur : rien non plus.
        let fetched = t.wants_artwork(Some(&b)).then_some(Some(vec![1, 2, 3]));
        assert_eq!(t.update(Some(b), fetched), None);
        // Légère dérive (< 2 s) : rien.
        let c = later(&a, 10_000, 11_500);
        let fetched = t.wants_artwork(Some(&c)).then_some(Some(vec![1, 2, 3]));
        assert_eq!(t.update(Some(c), fetched), None);
    }

    #[test]
    fn emet_sur_saut_de_position_pause_et_changement() {
        let mut t = Tracker::default();
        let a = track("Aerodynamic");
        t.update(Some(a.clone()), Some(Some(vec![9])));
        // Avance manuelle de 30 s.
        let jump = later(&a, 1_000, 31_000);
        let state = t
            .update(Some(jump.clone()), None)
            .expect("saut émis")
            .expect("état");
        assert_eq!(state.position_ms, Some(41_000));
        // Pause : émis ; puis la position ne bouge plus et le temps passe : rien.
        let paused = NowPlaying {
            playing: false,
            ..later(&jump, 1_000, 1_000)
        };
        assert!(
            !t.update(Some(paused.clone()), None)
                .expect("pause émise")
                .expect("état")
                .playing
        );
        assert_eq!(t.update(Some(later(&paused, 5_000, 0)), None), None);
        // Reprise : émis.
        let resumed = NowPlaying {
            playing: true,
            ..later(&paused, 6_000, 0)
        };
        assert!(
            t.update(Some(resumed), None)
                .expect("reprise émise")
                .expect("état")
                .playing
        );
        // Autre lecteur, même morceau : émis.
        let chrome = NowPlaying {
            app_id: "Chrome".into(),
            ..a.clone()
        };
        let state = t
            .update(Some(chrome), None)
            .expect("lecteur émis")
            .expect("état");
        assert_eq!(state.app_name, "Google Chrome");
        // Durée apprise après coup : émis.
        let mut t = Tracker::default();
        let unknown = NowPlaying {
            duration_ms: None,
            position_ms: None,
            ..a.clone()
        };
        t.update(Some(unknown), Some(None));
        assert!(t.update(Some(a.clone()), None).is_some());
    }

    #[test]
    fn null_emis_une_seule_fois() {
        let mut t = Tracker::default();
        // Rien au démarrage : rien à émettre.
        assert_eq!(t.update(None, None), None);
        t.update(Some(track("Digital Love")), Some(Some(vec![1])));
        assert_eq!(t.update(None, None), Some(None));
        assert_eq!(t.update(None, None), None);
        assert!(t.artwork().is_none());
    }

    #[test]
    fn pochette_compteur_et_relectures() {
        let mut t = Tracker::default();
        let a = track("Voyager");
        // Windows : le titre change avant l'image ; la première lecture rend l'ancienne image.
        t.update(Some(track("Avant")), Some(Some(vec![1])));
        assert_eq!(t.artwork().map(|a| a.id.as_str()), Some("1"));
        assert!(t.wants_artwork(Some(&a)));
        let state = t
            .update(Some(a.clone()), Some(Some(vec![1])))
            .expect("titre émis")
            .expect("état");
        // Même image : même id (pas de clignotement côté front).
        assert_eq!(state.artwork_id.as_deref(), Some("1"));
        // Relecture au tour suivant : la nouvelle image arrive, nouvel id.
        assert!(t.wants_artwork(Some(&a)));
        let state = t
            .update(Some(a.clone()), Some(Some(vec![2])))
            .expect("pochette émise")
            .expect("état");
        assert_eq!(state.artwork_id.as_deref(), Some("2"));
        assert_eq!(t.artwork().map(|a| a.bytes.as_slice()), Some(&[2u8][..]));
        // Encore deux relectures (3 au total après le changement), puis plus rien.
        assert!(t.wants_artwork(Some(&a)));
        assert_eq!(t.update(Some(a.clone()), Some(Some(vec![2]))), None);
        assert!(t.wants_artwork(Some(&a)));
        // Une relecture qui échoue garde l'image.
        assert_eq!(t.update(Some(a.clone()), Some(None)), None);
        assert_eq!(t.artwork().map(|a| a.id.as_str()), Some("2"));
        assert!(!t.wants_artwork(Some(&a)));
        // Plus de pochette pour ce lecteur : id à null.
        let none = NowPlaying {
            artwork_key: None,
            ..a.clone()
        };
        assert!(!t.wants_artwork(Some(&none)));
        let state = t.update(Some(none), None).expect("émis").expect("état");
        assert_eq!(state.artwork_id, None);
        assert!(t.artwork().is_none());
        // Nouveau morceau sans image lisible : null, puis l'image arrive à une relecture.
        let b = track("Crescendolls");
        let state = t
            .update(Some(b.clone()), Some(None))
            .expect("émis")
            .expect("état");
        assert_eq!(state.artwork_id, None);
        assert!(t.wants_artwork(Some(&b)));
        let state = t
            .update(Some(b), Some(Some(vec![3])))
            .expect("émis")
            .expect("état");
        assert_eq!(state.artwork_id.as_deref(), Some("3"));
    }

    #[test]
    fn music_state_a_la_forme_du_contrat() {
        let mut t = Tracker::default();
        let state = t
            .update(Some(track("Harder")), Some(Some(vec![7])))
            .expect("émis")
            .expect("état");
        let json = serde_json::to_value(&state).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "album",
                "appId",
                "appName",
                "artist",
                "artworkId",
                "durationMs",
                "playing",
                "positionAt",
                "positionMs",
                "title"
            ]
        );
        assert_eq!(json["appId"], "Spotify.exe");
        assert_eq!(json["appName"], "Spotify");
        assert_eq!(json["playing"], true);
        assert_eq!(json["positionMs"], 10_000);
        assert_eq!(json["durationMs"], 200_000);
        assert_eq!(json["positionAt"], 1_000_000);
        assert_eq!(json["artworkId"], "1");
        // Valeurs inconnues : null (jamais absentes).
        let bare = MusicState {
            artist: None,
            album: None,
            position_ms: None,
            duration_ms: None,
            artwork_id: None,
            ..state
        };
        let json = serde_json::to_value(&bare).unwrap();
        for key in ["artist", "album", "positionMs", "durationMs", "artworkId"] {
            assert!(json[key].is_null(), "{key}");
        }
        // `desktop://music` sans musique : null.
        assert!(serde_json::to_value(None::<&MusicState>).unwrap().is_null());
    }

    #[test]
    fn tempo_emis_quand_il_arrive() {
        let mut t = Tracker::default();
        t.update(Some(track("Harder")), None).expect("émis");
        // Même morceau, tempo trouvé au tour suivant : nouvel état avec `tempoBpm`.
        let with = Track::system(later(&track("Harder"), 1_000, 1_000)).with_tempo(Some(123.4));
        let state = t
            .update_track(Some(with), None)
            .expect("émis")
            .expect("état");
        assert_eq!(state.tempo_bpm, Some(123.4));
        assert_eq!(serde_json::to_value(&state).unwrap()["tempoBpm"], 123.4);
        // Rien de neuf ensuite.
        let again = Track::system(later(&track("Harder"), 2_000, 2_000)).with_tempo(Some(123.4));
        assert!(t.update_track(Some(again), None).is_none());
    }

    #[test]
    fn commandes_du_contrat() {
        for (text, command) in [
            ("previous", MediaCommand::Previous),
            ("playPause", MediaCommand::PlayPause),
            ("next", MediaCommand::Next),
            ("open", MediaCommand::Open),
        ] {
            assert_eq!(
                serde_json::from_value::<MediaCommand>(serde_json::json!(text)).unwrap(),
                command
            );
        }
        assert!(serde_json::from_value::<MediaCommand>(serde_json::json!("stop")).is_err());
    }

    fn remote(device: &str, can_control: bool) -> RemotePlayback {
        RemotePlayback {
            track: NowPlaying {
                app_id: spotify::APP_ID.into(),
                artwork_key: Some("https://i.scdn.co/image/a".into()),
                ..track("Get Lucky")
            },
            app_name: format!("Spotify sur {device}"),
            on_computer: false,
            can_control,
        }
    }

    #[test]
    fn spotify_sur_un_autre_appareil() {
        let mut t = Tracker::default();
        let phone = remote("iPhone", true);
        let state = t
            .update_track(Some(Track::remote(&phone)), Some(Some(vec![4, 2])))
            .expect("émis")
            .expect("état");
        assert_eq!(state.app_id, "spotify:connect");
        assert_eq!(state.app_name, "Spotify sur iPhone");
        assert_eq!(state.artwork_id.as_deref(), Some("1"));
        assert_eq!(t.artwork().map(|a| a.bytes.as_slice()), Some(&[4u8, 2][..]));
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["canControl"], true);
        // Même lecture sur un autre appareil : émis (nom affiché changé).
        let speaker = remote("Cuisine", true);
        let state = t
            .update_track(Some(Track::remote(&speaker)), None)
            .expect("appareil émis")
            .expect("état");
        assert_eq!(state.app_name, "Spotify sur Cuisine");
        // Premium perdu : émis, boutons masqués.
        let free = remote("Cuisine", false);
        let state = t
            .update_track(Some(Track::remote(&free)), None)
            .expect("commandes émises")
            .expect("état");
        assert_eq!(serde_json::to_value(&state).unwrap()["canControl"], false);
        // Retour au lecteur du système : `canControl` absent (oui par défaut).
        let state = t
            .update(Some(track("Get Lucky")), Some(Some(vec![4, 2])))
            .expect("lecteur émis")
            .expect("état");
        assert_eq!(state.app_name, "Spotify");
        assert!(serde_json::to_value(&state)
            .unwrap()
            .get("canControl")
            .is_none());
    }

    #[test]
    fn analyse_seulement_pour_la_musique_de_l_ordinateur() {
        let mut t = Tracker::default();
        assert!(!t.plays_on_computer());
        let a = track("Around the World");
        t.update(Some(a.clone()), Some(Some(vec![1])));
        assert!(t.plays_on_computer());
        // Pause : arrêt.
        let paused = NowPlaying {
            playing: false,
            ..a.clone()
        };
        t.update(Some(paused), None);
        assert!(!t.plays_on_computer());
        // Spotify sur un autre appareil, même en lecture : aucun son sur l'ordinateur.
        t.update_track(Some(Track::remote(&remote("iPhone", true))), None);
        assert!(!t.plays_on_computer());
        // Retour au lecteur de l'ordinateur, puis plus rien.
        t.update(Some(a), None);
        assert!(t.plays_on_computer());
        t.update(None, None);
        assert!(!t.plays_on_computer());
    }

    /// Diagnostic manuel, avec de la musique qui joue :
    /// `cargo test print_now_playing -- --ignored --nocapture` (dans `src-tauri/`).
    /// macOS : la lecture se fait en arrière-plan, les premiers tours peuvent ne rien trouver ; la première
    /// fois, macOS demande au terminal l'autorisation de contrôler Spotify / Musique.
    #[test]
    #[ignore]
    fn print_now_playing() {
        crate::logging::init();
        for _ in 0..5 {
            match platform::now_playing() {
                Ok(Some(p)) => {
                    println!("{p:?} → « {} »", player_name(&p.app_id));
                    match platform::now_playing_artwork() {
                        Ok(Some(bytes)) => println!("pochette : {} octets", bytes.len()),
                        Ok(None) => println!("pas de pochette"),
                        Err(e) => println!("pochette : {e:#}"),
                    }
                }
                Ok(None) => println!("rien en cours"),
                Err(e) => println!("erreur : {e:#}"),
            }
            thread::sleep(Duration::from_secs(1));
        }
    }
}
