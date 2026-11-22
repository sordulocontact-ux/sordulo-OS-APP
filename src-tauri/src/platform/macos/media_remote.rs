//! macOS — musique en cours de TOUS les lecteurs (Spotify, Musique, onglets de navigateur avec Media
//! Session : YouTube, Spotify web, Deezer…), par MediaRemote, le framework qui alimente le « À l'écoute » du
//! centre de contrôle.
//!
//! Depuis macOS 15.4, seul un client autorisé peut lire MediaRemote : on passe par l'adaptateur Perl embarqué
//! dans le crate `media-remote` (`/usr/bin/perl` a ce droit). Aucune autorisation demandée à l'utilisateur. Le
//! crate lance `perl … stream` une fois et pousse chaque changement ; on garde le dernier état ici, et
//! `media.rs` le lit à chaque tour de la boucle de la musique (`music.rs`).
//!
//! Source principale de `media.rs` : tant que l'adaptateur répond, c'est lui qui fait foi. S'il ne démarre pas
//! ou n'écrit rien dans les 5 s (perl absent, framework refusé par une future version de macOS), `media.rs`
//! retombe sur la lecture AppleScript de Spotify et Musique.
//!
//! Pochette : décodée par le crate (fonction `artwork`), réduite ici à 256 px et réencodée en JPEG, une fois
//! par image. Le processus `perl` est tué à la sortie de l'app (`shutdown`) ; ceux d'une session précédente
//! morte sans passer par là (rattachés à launchd) sont tués au démarrage.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use anyhow::{bail, ensure, Result};
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;
use media_remote::{Controller, NowPlayingInfo, NowPlayingPerl, Subscription};

use crate::platform::{MediaCommand, NowPlaying};
use crate::time::now_ms;

const PERL: &str = "/usr/bin/perl";
/// Délai pour la première ligne de l'adaptateur (il écrit l'état courant dès son lancement).
const FIRST_DATA_TIMEOUT: Duration = Duration::from_secs(5);
/// Côté maximal de la pochette envoyée à l'île (affichée à 40 px au plus, écrans Retina compris).
const ARTWORK_MAX_PX: u32 = 256;
const ARTWORK_JPEG_QUALITY: u8 = 85;

/// Morceau lu par MediaRemote, déjà converti.
#[derive(Debug, Clone, PartialEq)]
struct Snapshot {
    now: NowPlaying,
    /// Pochette réduite (JPEG), clé = `now.artwork_key`.
    artwork: Option<Vec<u8>>,
}

#[derive(Default)]
struct State {
    /// Dernier état de MediaRemote (`None` : rien de chargé).
    current: Option<Snapshot>,
    /// Dernière pochette encodée et l'image d'où elle vient (réencodée seulement si l'image change).
    cover_source: Option<DynamicImage>,
    cover: Option<(String, Vec<u8>)>,
    /// Numéro de pochette, pour une clé qui change avec l'image.
    cover_serial: u64,
}

struct Remote {
    perl: NowPlayingPerl,
    /// L'adaptateur a écrit au moins une ligne : il fonctionne.
    alive: AtomicBool,
    /// Pas de première ligne dans les 5 s : on ne compte plus sur lui.
    failed: AtomicBool,
    started: Instant,
    state: Mutex<State>,
}

static REMOTE: OnceLock<Option<&'static Remote>> = OnceLock::new();

/// Verrou empoisonné (panique d'un rappel) : on garde les données, elles restent cohérentes.
fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|e| e.into_inner())
}

/// Adaptateur lancé au premier appel ; `None` s'il n'a pas pu démarrer.
fn remote() -> Option<&'static Remote> {
    *REMOTE.get_or_init(|| match start() {
        Ok(remote) => {
            log::info!("musique : lecture par MediaRemote (adaptateur Perl), tous les lecteurs");
            Some(remote)
        }
        Err(e) => {
            log::warn!("musique : MediaRemote indisponible ({e:#}), repli sur Spotify et Musique");
            None
        }
    })
}

/// Adaptateur qui fonctionne (première ligne reçue), ou encore dans son délai de démarrage.
fn usable() -> Option<&'static Remote> {
    let remote = remote()?;
    if remote.alive.load(Ordering::SeqCst) {
        return Some(remote);
    }
    if remote.failed.load(Ordering::SeqCst) {
        return None;
    }
    if remote.started.elapsed() >= FIRST_DATA_TIMEOUT {
        remote.failed.store(true, Ordering::SeqCst);
        log::warn!("musique : l'adaptateur MediaRemote ne répond pas, repli sur Spotify et Musique");
        kill_adapters(&std::process::id().to_string());
        return None;
    }
    Some(remote)
}

fn start() -> Result<&'static Remote> {
    ensure!(std::path::Path::new(PERL).exists(), "{PERL} introuvable");
    // Adaptateurs d'une session précédente arrêtée sans `shutdown` (plantage, kill) : rattachés à launchd
    // (parent 1), ils ne s'arrêtent qu'au prochain changement de lecture.
    kill_adapters("1");
    // Le crate panique (au lieu de renvoyer une erreur) si le dossier temporaire est inutilisable.
    let perl = std::panic::catch_unwind(NowPlayingPerl::new)
        .map_err(|_| anyhow::anyhow!("démarrage de l'adaptateur impossible"))?;
    // Vit jusqu'à la fin de l'app : `shutdown` tue le processus.
    let remote: &'static Remote = Box::leak(Box::new(Remote {
        perl,
        alive: AtomicBool::new(false),
        failed: AtomicBool::new(false),
        started: Instant::now(),
        state: Mutex::new(State::default()),
    }));
    let first_call = AtomicBool::new(true);
    // Appelé sous les verrous du crate : ne jamais rappeler `perl` d'ici.
    remote.perl.subscribe(move |guard| {
        // Le premier appel est synchrone (dans `subscribe`) : état vide, avant toute ligne de perl.
        if first_call.swap(false, Ordering::SeqCst) {
            return;
        }
        remote.alive.store(true, Ordering::SeqCst);
        let mut state = lock(&remote.state);
        let snapshot = guard
            .as_ref()
            .and_then(|info| snapshot_of(info, &mut state, now_ms()));
        state.current = snapshot;
    });
    Ok(remote)
}

/// Convertit l'état de MediaRemote. `None` : rien de chargé ou titre vide.
fn snapshot_of(info: &NowPlayingInfo, state: &mut State, now: u64) -> Option<Snapshot> {
    let mut now_playing = now_playing_of(info, now)?;
    let artwork = cover_of(state, info.album_cover.as_ref());
    now_playing.artwork_key = artwork.as_ref().map(|(key, _)| key.clone());
    Some(Snapshot {
        now: now_playing,
        artwork: artwork.map(|(_, bytes)| bytes),
    })
}

fn now_playing_of(info: &NowPlayingInfo, now: u64) -> Option<NowPlaying> {
    let title = text(info.title.as_deref())?;
    let measured = info
        .info_update_time
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| u64::try_from(d.as_millis()).ok());
    let seconds_to_ms = |s: f64| (s.is_finite() && s >= 0.0).then(|| (s * 1000.0).round() as u64);
    Some(NowPlaying {
        app_id: info.bundle_id.clone().unwrap_or_default(),
        title,
        artist: text(info.artist.as_deref()),
        album: text(info.album.as_deref()),
        playing: info.is_playing.unwrap_or(false),
        position_ms: info.elapsed_time.and_then(seconds_to_ms),
        duration_ms: info.duration.and_then(seconds_to_ms).filter(|d| *d > 0),
        position_at: measured_at(measured, now),
        artwork_key: None,
    })
}

/// Instant de la mesure de la position. MediaRemote la date à la seconde près : on prend le milieu de la
/// seconde, sans dépasser maintenant (mesure toute fraîche). Erreur au plus 0,5 s.
fn measured_at(measured_ms: Option<u64>, now: u64) -> u64 {
    measured_ms.map_or(now, |ms| (ms + 500).min(now))
}

fn text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

/// Pochette réduite et sa clé, réencodée seulement si l'image a changé.
fn cover_of(state: &mut State, cover: Option<&DynamicImage>) -> Option<(String, Vec<u8>)> {
    let Some(cover) = cover else {
        state.cover_source = None;
        state.cover = None;
        return None;
    };
    if state.cover_source.as_ref() != Some(cover) {
        state.cover = encode_cover(cover).map(|bytes| {
            state.cover_serial += 1;
            (format!("mediaremote:{}", state.cover_serial), bytes)
        });
        state.cover_source = Some(cover.clone());
    }
    state.cover.clone()
}

/// Réduit la pochette à 256 px de côté au plus et l'encode en JPEG.
fn encode_cover(cover: &DynamicImage) -> Option<Vec<u8>> {
    let small = if cover.width() > ARTWORK_MAX_PX || cover.height() > ARTWORK_MAX_PX {
        cover.thumbnail(ARTWORK_MAX_PX, ARTWORK_MAX_PX)
    } else {
        cover.clone()
    };
    let mut out = Vec::new();
    match JpegEncoder::new_with_quality(&mut out, ARTWORK_JPEG_QUALITY).encode_image(&small.to_rgb8())
    {
        Ok(()) => Some(out),
        Err(e) => {
            log::debug!("musique : pochette non encodée : {e}");
            None
        }
    }
}

/// Ce que joue l'ordinateur d'après MediaRemote : `Some(morceau ou None)` si l'adaptateur fait foi, `None`
/// s'il n'est pas utilisable (`media.rs` interroge alors Spotify et Musique par AppleScript).
pub fn now_playing() -> Option<Option<NowPlaying>> {
    let remote = usable()?;
    Some(lock(&remote.state).current.as_ref().map(|s| s.now.clone()))
}

/// MediaRemote fait foi (pochette et commandes passent par lui).
pub fn active() -> bool {
    usable().is_some()
}

/// Pochette du morceau courant (JPEG réduit).
pub fn artwork() -> Option<Vec<u8>> {
    let remote = usable()?;
    lock(&remote.state)
        .current
        .as_ref()
        .and_then(|s| s.artwork.clone())
}

/// Précédent, lecture / pause, suivant ; `Open` met le lecteur au premier plan (`open -b`).
pub fn command(command: MediaCommand) -> Result<()> {
    let Some(remote) = usable() else {
        bail!("MediaRemote indisponible");
    };
    let sent = match command {
        MediaCommand::PlayPause => remote.perl.toggle(),
        MediaCommand::Next => remote.perl.next(),
        MediaCommand::Previous => remote.perl.previous(),
        MediaCommand::Open => {
            let current = lock(&remote.state)
                .current
                .as_ref()
                .map(|s| (s.now.app_id.clone(), s.now.title.clone()))
                .filter(|(id, _)| !id.is_empty());
            let Some((bundle_id, title)) = current else {
                bail!("aucune musique en cours");
            };
            // Navigateur : l'onglet qui joue (titre du morceau), pas seulement le navigateur.
            return super::media::open_player(&bundle_id, Some(&title));
        }
    };
    ensure!(sent, "commande refusée par MediaRemote");
    Ok(())
}

/// Tue l'adaptateur (sortie de l'app). Sans effet s'il n'a jamais été lancé.
pub fn shutdown() {
    if matches!(REMOTE.get(), Some(Some(_))) {
        kill_adapters(&std::process::id().to_string());
    }
}

/// Tue les processus de l'adaptateur dont le parent est `parent_pid` (flux et commandes en cours).
fn kill_adapters(parent_pid: &str) {
    let result = Command::new("/usr/bin/pkill")
        .args(["-TERM", "-P", parent_pid, "-f", "mediaremote-adapter"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match result {
        // 0 : tué ; 1 : plus rien à tuer.
        Ok(status) if matches!(status.code(), Some(0) | Some(1)) => {}
        Ok(status) => log::debug!("musique : pkill a échoué ({status})"),
        Err(e) => log::debug!("musique : pkill impossible : {e}"),
    }
    // Laisse au processus le temps de s'arrêter avant un éventuel relancement.
    thread::sleep(Duration::from_millis(20));
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use std::time::SystemTime;

    fn info(title: Option<&str>) -> NowPlayingInfo {
        NowPlayingInfo {
            is_playing: Some(true),
            title: title.map(str::to_owned),
            artist: Some("  Artiste ".into()),
            album: Some(String::new()),
            album_cover: None,
            elapsed_time: Some(12.5),
            duration: Some(200.0),
            playback_rate: Some(1.0),
            info_update_time: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000)),
            bundle_id: Some("company.thebrowser.Browser".into()),
            bundle_name: Some("Arc".into()),
            bundle_icon: None,
        }
    }

    #[test]
    fn convertit_l_etat_de_mediaremote() {
        let now = now_playing_of(&info(Some("Titre")), 1_000_900).unwrap();
        assert_eq!(now.title, "Titre");
        assert_eq!(now.artist.as_deref(), Some("Artiste"));
        assert_eq!(now.album, None);
        assert!(now.playing);
        assert_eq!(now.position_ms, Some(12_500));
        assert_eq!(now.duration_ms, Some(200_000));
        assert_eq!(now.position_at, 1_000_500);
        assert_eq!(now.app_id, "company.thebrowser.Browser");
        assert_eq!(crate::music::player_name(&now.app_id), "Arc");
    }

    #[test]
    fn titre_vide_ou_absent_rien() {
        assert!(now_playing_of(&info(None), 0).is_none());
        assert!(now_playing_of(&info(Some("   ")), 0).is_none());
    }

    #[test]
    fn mesure_au_milieu_de_la_seconde_jamais_dans_le_futur() {
        assert_eq!(measured_at(Some(1_000), 5_000), 1_500);
        assert_eq!(measured_at(Some(1_000), 1_200), 1_200);
        assert_eq!(measured_at(None, 42), 42);
    }

    #[test]
    fn pochette_reduite_a_256_et_cle_stable_pour_la_meme_image() {
        let mut state = State::default();
        let big = DynamicImage::ImageRgb8(RgbImage::from_pixel(600, 600, Rgb([200, 30, 30])));
        let (key, bytes) = cover_of(&mut state, Some(&big)).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (256, 256));
        assert_eq!(cover_of(&mut state, Some(&big)).unwrap().0, key);
        let other = DynamicImage::ImageRgb8(RgbImage::from_pixel(10, 10, Rgb([0, 0, 0])));
        assert_ne!(cover_of(&mut state, Some(&other)).unwrap().0, key);
        assert!(cover_of(&mut state, None).is_none());
    }

    /// Manuel : `cargo test lire_mediaremote -- --ignored --nocapture` (mettre de la musique).
    #[test]
    #[ignore]
    fn lire_mediaremote() {
        for _ in 0..8 {
            println!("{:?}", now_playing().map(|n| n.map(|n| (n.title, n.app_id, n.playing))));
            println!("pochette : {:?} o", artwork().map(|a| a.len()));
            thread::sleep(Duration::from_secs(1));
        }
        shutdown();
    }

    /// Manuel : `cargo test commande_mediaremote -- --ignored --nocapture` (mettre de la musique) :
    /// pause puis reprise du lecteur courant.
    #[test]
    #[ignore]
    fn commande_mediaremote() {
        let playing = || now_playing().flatten().map(|n| n.playing);
        thread::sleep(Duration::from_secs(2));
        println!("avant : {:?}", playing());
        command(MediaCommand::PlayPause).expect("commande");
        thread::sleep(Duration::from_secs(2));
        println!("après une commande : {:?}", playing());
        command(MediaCommand::PlayPause).expect("commande");
        thread::sleep(Duration::from_secs(2));
        println!("après deux commandes : {:?}", playing());
        shutdown();
    }
}
