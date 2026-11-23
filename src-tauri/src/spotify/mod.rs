//! Connecteur Spotify (API Web officielle), même code pour Windows et macOS.
//!
//! But : montrer dans l'île ce qui joue sur un AUTRE appareil du compte (téléphone, enceinte), quand rien
//! ne joue sur l'ordinateur. La fusion avec le lecteur du système est faite par `music.rs`
//! ([`prefer_remote`]) ; ce module ne fait que lire Spotify et garder la dernière lecture connue.
//!
//! - Connexion : OAuth PKCE sans secret ([`connect`]). Un serveur local (`callback.rs`) écoute
//!   `http://127.0.0.1:43127/callback` le temps de la connexion (3 min au plus), la page d'autorisation
//!   s'ouvre dans le navigateur par défaut (`platform::open_url`).
//! - Jetons + Client ID : `app_data_dir()/spotify.json` (`store.rs`), relus au démarrage, rafraîchis avant
//!   expiration. Refus de Spotify (`invalid_grant`, 401 après rafraîchissement) : jetons oubliés,
//!   `needsReconnect`. Chaque changement d'état émet `desktop://spotify` (`SpotifyStatus`) à toutes les
//!   fenêtres.
//! - Lecture : un thread interroge `GET /v1/me/player` (~3 s quand quelque chose est connu ou que rien ne
//!   joue sur l'ordinateur, 15 s sinon), seulement avec un compte connecté et la musique de l'île activée ;
//!   429 respecté (`Retry-After`) ; erreur réseau : dernière lecture gardée 15 s. La pochette (https) est
//!   téléchargée quand son URL change, AVANT de publier la lecture : `music.rs` l'a tout de suite.
//! - Commandes (Premium) : précédent, suivant, lecture / pause sur l'appareil actif ; `open` ouvre l'app
//!   Spotify (`spotify:`), sinon open.spotify.com.
//!
//! Le client HTTP est bloquant : jamais appelé depuis un thread async (les commandes Tauri passent par
//! `spawn_blocking`). Verrous : `inner` seul, jamais tenu pendant un appel réseau ni avec un verrou de
//! `DesktopState` ; `refresh` (un seul rafraîchissement à la fois) peut prendre `inner` ensuite.
//! Jamais de jeton dans les logs.

mod api;
mod callback;
mod pkce;
mod player;
mod store;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use tauri::{AppHandle, Emitter, Manager};

use crate::events::EVENT_SPOTIFY;
use crate::platform::{self, MediaCommand};
use crate::state::DesktopState;
use crate::time::now_ms;

use api::{ApiError, PlayerCommand};
/// Encodage des paramètres d'URL, repris par `music_tempo` (recherche Deezer).
pub use pkce::form_body;
pub use player::{prefer_remote, RemotePlayback, APP_ID};
pub use store::SpotifyStatus;
use store::Stored;

/// Fichier des jetons dans le dossier de données de l'app.
const FILE_NAME: &str = "spotify.json";
/// Attente maximale de la redirection de Spotify.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(180);
/// Sondage quand une lecture est connue ou que rien ne joue sur l'ordinateur.
const POLL_ACTIVE: Duration = Duration::from_secs(3);
/// Sondage quand l'ordinateur joue et que Spotify ne jouait rien.
const POLL_SLOW: Duration = Duration::from_secs(15);
/// Sans compte ou musique masquée : simple vérification de l'état.
const POLL_IDLE: Duration = Duration::from_secs(1);
/// Erreurs réseau : la dernière lecture reste montrée ce temps-là.
const KEEP_ON_ERROR: Duration = Duration::from_secs(15);
/// Relecture après une commande (Spotify met un instant à refléter le changement).
const AFTER_COMMAND: Duration = Duration::from_millis(700);

/// Lecture Spotify à distance et sa pochette (octets déjà téléchargés).
#[derive(Debug, Clone)]
pub struct Remote {
    pub playback: RemotePlayback,
    pub artwork: Option<Arc<Vec<u8>>>,
}

#[derive(Default)]
struct Inner {
    /// `app_data_dir()/spotify.json` (`None` si le dossier est introuvable : rien n'est gardé).
    path: Option<PathBuf>,
    stored: Option<Stored>,
    connecting: bool,
    /// Dernière lecture connue (`None` : rien ne joue sur le compte, ou pas de compte).
    remote: Option<Remote>,
    /// Dernière pochette téléchargée (URL, octets) : pas de nouveau téléchargement pour la même.
    artwork: Option<(String, Arc<Vec<u8>>)>,
    /// Profil (nom, Premium) relu depuis le lancement.
    profile_checked: bool,
}

/// État Tauri du connecteur (`app.manage`).
pub struct SpotifyState {
    inner: Mutex<Inner>,
    /// Un seul rafraîchissement des jetons à la fois.
    refresh: Mutex<()>,
    client: OnceLock<Client>,
    /// Réveille le thread de lecture (durée avant le prochain sondage).
    wake: Mutex<Option<Sender<Duration>>>,
    /// Le lecteur de l'ordinateur joue (renseigné par la boucle de la musique) : sondage plus lent.
    local_playing: AtomicBool,
    /// Numéro de la dernière connexion lancée : une nouvelle connexion ou une déconnexion annule la précédente.
    attempt: AtomicU64,
}

impl SpotifyState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            refresh: Mutex::new(()),
            client: OnceLock::new(),
            wake: Mutex::new(None),
            local_playing: AtomicBool::new(false),
            attempt: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Client HTTP (construit au premier appel, hors thread async).
    fn client(&self) -> Result<&Client, ApiError> {
        if let Some(client) = self.client.get() {
            return Ok(client);
        }
        let client = api::client().map_err(ApiError::Network)?;
        Ok(self.client.get_or_init(|| client))
    }

    fn wake(&self, delay: Duration) {
        let wake = self.wake.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sender) = wake.as_ref() {
            let _ = sender.send(delay);
        }
    }
}

fn state(app: &AppHandle) -> &SpotifyState {
    app.state::<SpotifyState>().inner()
}

// ---------------------------------------------------------------------------
// État, événement
// ---------------------------------------------------------------------------

/// `spotify_status` : état de la connexion.
pub fn status(app: &AppHandle) -> SpotifyStatus {
    let inner = state(app).lock();
    store::status_of(inner.stored.as_ref(), inner.connecting)
}

fn emit_status(app: &AppHandle) {
    let status = status(app);
    if let Err(e) = app.emit(EVENT_SPOTIFY, &status) {
        log::warn!("émission de {EVENT_SPOTIFY} impossible : {e}");
    }
}

/// Écrit le fichier des jetons (à appeler avec le verrou `inner`, l'écriture est courte).
fn persist(inner: &Inner) {
    let (Some(path), Some(stored)) = (&inner.path, &inner.stored) else {
        return;
    };
    if let Err(e) = store::save(path, stored) {
        log::warn!(
            "Spotify : enregistrement de {} impossible : {e}",
            path.display()
        );
    }
}

/// Lecture Spotify à distance à montrer (`music.rs`), `None` sans compte ou si rien ne joue.
pub fn remote(app: &AppHandle) -> Option<Remote> {
    state(app).lock().remote.clone()
}

/// La boucle de la musique signale si l'ordinateur joue (sondage de Spotify plus lent dans ce cas).
pub fn set_local_playing(app: &AppHandle, playing: bool) {
    state(app).local_playing.store(playing, Ordering::Relaxed);
}

/// Relit le compte gardé et lance le thread de lecture (une fois, dans `setup`).
pub fn start(app: &AppHandle) {
    let path = match app.path().app_data_dir() {
        Ok(dir) => Some(dir.join(FILE_NAME)),
        Err(e) => {
            log::warn!("Spotify : dossier de données introuvable, compte non gardé : {e}");
            None
        }
    };
    let stored = path.as_deref().and_then(store::load);
    match &stored {
        Some(s) if s.connected() => log::info!("Spotify : compte connecté retrouvé"),
        Some(s) if s.needs_reconnect => log::info!("Spotify : compte à reconnecter"),
        _ => log::debug!("Spotify : aucun compte connecté"),
    }
    let spotify = state(app);
    {
        let mut inner = spotify.lock();
        inner.path = path;
        inner.stored = stored;
    }
    let (sender, receiver) = mpsc::channel();
    *spotify.wake.lock().unwrap_or_else(|e| e.into_inner()) = Some(sender);
    let handle = app.clone();
    let spawned = thread::Builder::new()
        .name("spotify-player".into())
        .spawn(move || poll_loop(&handle, &receiver));
    if let Err(e) = spawned {
        log::error!("impossible de lancer la lecture de Spotify : {e}");
    }
}

// ---------------------------------------------------------------------------
// Jetons
// ---------------------------------------------------------------------------

/// Oublie les jetons après un refus de Spotify (si ce sont toujours ceux-là) et prévient le front.
fn lose_access(app: &AppHandle, refresh_token: &str) {
    let spotify = state(app);
    {
        let mut inner = spotify.lock();
        let same = inner
            .stored
            .as_ref()
            .and_then(|s| s.tokens.as_ref())
            .is_some_and(|t| t.refresh_token == refresh_token);
        if !same {
            return;
        }
        if let Some(stored) = inner.stored.as_mut() {
            stored.lose_access();
        }
        inner.remote = None;
        persist(&inner);
    }
    log::warn!("Spotify : accès refusé, le compte est à reconnecter");
    emit_status(app);
}

/// Jetons valides (rafraîchis s'ils expirent bientôt, ou si `force`).
fn tokens(app: &AppHandle, force: bool) -> Result<store::Tokens, ApiError> {
    let spotify = state(app);
    let current = || {
        let inner = spotify.lock();
        inner
            .stored
            .as_ref()
            .and_then(|s| s.tokens.clone().map(|t| (s.client_id.clone(), t)))
    };
    let (_, before) = current().ok_or(ApiError::NotConnected)?;
    if !force && !before.expires_soon(now_ms()) {
        return Ok(before);
    }
    let refreshing = spotify.refresh.lock().unwrap_or_else(|e| e.into_inner());
    // Un autre thread a peut-être rafraîchi pendant l'attente du verrou.
    let (client_id, tokens) = current().ok_or(ApiError::NotConnected)?;
    if tokens.access_token != before.access_token && !tokens.expires_soon(now_ms()) {
        return Ok(tokens);
    }
    let client = spotify.client()?;
    match api::refresh(client, &client_id, &tokens.refresh_token, now_ms()) {
        Ok(fresh) => {
            let mut inner = spotify.lock();
            let still_same = inner
                .stored
                .as_ref()
                .and_then(|s| s.tokens.as_ref())
                .is_some_and(|t| t.refresh_token == tokens.refresh_token);
            if !still_same {
                // Déconnecté ou reconnecté entre-temps : ces jetons ne servent plus.
                return Err(ApiError::NotConnected);
            }
            if let Some(stored) = inner.stored.as_mut() {
                stored.tokens = Some(fresh.clone());
            }
            persist(&inner);
            log::debug!("Spotify : jeton d'accès rafraîchi");
            Ok(fresh)
        }
        Err(ApiError::Revoked | ApiError::Unauthorized) => {
            drop(refreshing);
            lose_access(app, &tokens.refresh_token);
            Err(ApiError::Revoked)
        }
        Err(e) => Err(e),
    }
}

/// Appel authentifié : en cas de 401, rafraîchit et réessaie une fois ; 401 encore = accès perdu.
fn with_token<T>(
    app: &AppHandle,
    call: impl Fn(&Client, &str) -> Result<T, ApiError>,
) -> Result<T, ApiError> {
    let client = state(app).client()?;
    let first = tokens(app, false)?;
    match call(client, &first.access_token) {
        Err(ApiError::Unauthorized) => {
            let second = tokens(app, true)?;
            match call(client, &second.access_token) {
                Err(ApiError::Unauthorized) => {
                    lose_access(app, &second.refresh_token);
                    Err(ApiError::Revoked)
                }
                other => other,
            }
        }
        other => other,
    }
}

// ---------------------------------------------------------------------------
// Connexion, déconnexion
// ---------------------------------------------------------------------------

/// `spotify_connect` : ouvre la page d'autorisation et attend la redirection (bloquant, 3 min au plus).
pub fn connect(app: &AppHandle, client_id: &str) -> Result<SpotifyStatus, String> {
    let client_id = client_id.trim();
    if !pkce::valid_client_id(client_id) {
        return Err(
            "Client ID Spotify manquant ou invalide : vérifie VITE_SPOTIFY_CLIENT_ID.".into(),
        );
    }
    let spotify = state(app);
    let attempt = spotify.attempt.fetch_add(1, Ordering::SeqCst) + 1;
    spotify.lock().connecting = true;
    emit_status(app);
    let result = run_connect(app, client_id, attempt);
    // Une connexion plus récente (ou une déconnexion) a pris la main : elle gère `connecting`.
    if spotify.attempt.load(Ordering::SeqCst) == attempt {
        spotify.lock().connecting = false;
    }
    emit_status(app);
    match &result {
        Ok(()) => log::info!("Spotify : compte connecté"),
        Err(e) => log::warn!("Spotify : connexion non aboutie : {e}"),
    }
    result.map(|()| status(app))
}

fn run_connect(app: &AppHandle, client_id: &str, attempt: u64) -> Result<(), String> {
    let pkce = pkce::Pkce::generate()?;
    let expected_state = pkce::random_state()?;
    let listener = callback::bind()?;
    let url = pkce::authorize_url(client_id, &pkce.challenge, &expected_state);
    platform::open_url(&url).map_err(|e| format!("Impossible d'ouvrir le navigateur : {e:#}"))?;
    log::info!("Spotify : page d'autorisation ouverte dans le navigateur");
    let spotify = state(app);
    callback::wait_for_code(
        &listener,
        &expected_state,
        Instant::now() + CONNECT_TIMEOUT,
        || spotify.attempt.load(Ordering::SeqCst) != attempt,
        |code| finish_connect(app, client_id, &code, &pkce.verifier, attempt),
    )
}

/// Échange le code, lit le profil, garde le compte et relance la lecture.
fn finish_connect(
    app: &AppHandle,
    client_id: &str,
    code: &str,
    verifier: &str,
    attempt: u64,
) -> Result<(), String> {
    let spotify = state(app);
    let client = spotify.client().map_err(|e| e.to_string())?;
    let tokens = api::exchange_code(client, client_id, code, verifier, now_ms())
        .map_err(|e| format!("Connexion à Spotify impossible : {e}"))?;
    let profile = api::profile(client, &tokens.access_token)
        .map_err(|e| format!("Lecture du compte Spotify impossible : {e}"))?;
    {
        let mut inner = spotify.lock();
        if spotify.attempt.load(Ordering::SeqCst) != attempt {
            return Err("Connexion à Spotify annulée.".into());
        }
        inner.stored = Some(Stored {
            client_id: client_id.to_owned(),
            tokens: Some(tokens),
            account: Some(profile.account),
            premium: profile.premium,
            needs_reconnect: false,
        });
        inner.remote = None;
        inner.profile_checked = true;
        persist(&inner);
    }
    spotify.wake(Duration::ZERO);
    Ok(())
}

/// `spotify_disconnect` : oublie les jetons (fichier supprimé) et annule une connexion en cours.
pub fn disconnect(app: &AppHandle) -> SpotifyStatus {
    let spotify = state(app);
    spotify.attempt.fetch_add(1, Ordering::SeqCst);
    {
        let mut inner = spotify.lock();
        inner.stored = None;
        inner.remote = None;
        inner.artwork = None;
        inner.connecting = false;
        inner.profile_checked = false;
        if let Some(path) = &inner.path {
            if let Err(e) = store::delete(path) {
                log::warn!(
                    "Spotify : suppression de {} impossible : {e}",
                    path.display()
                );
            }
        }
    }
    log::info!("Spotify : compte déconnecté");
    emit_status(app);
    status(app)
}

// ---------------------------------------------------------------------------
// Lecture en cours
// ---------------------------------------------------------------------------

fn connected(app: &AppHandle) -> bool {
    state(app)
        .lock()
        .stored
        .as_ref()
        .is_some_and(Stored::connected)
}

fn set_remote(app: &AppHandle, remote: Option<Remote>) {
    let spotify = state(app);
    let mut inner = spotify.lock();
    match (&inner.remote, &remote) {
        (None, Some(r)) => log::info!("Spotify : lecture détectée ({})", r.playback.app_name),
        (Some(_), None) => log::info!("Spotify : plus rien en cours"),
        _ => {}
    }
    inner.remote = remote;
}

/// Relit le profil une fois après le lancement (Premium a pu changer).
fn check_profile(app: &AppHandle) -> Result<(), ApiError> {
    if state(app).lock().profile_checked {
        return Ok(());
    }
    let profile = match with_token(app, api::profile) {
        Ok(profile) => profile,
        Err(e @ (ApiError::Revoked | ApiError::RateLimited(_) | ApiError::NotConnected)) => {
            return Err(e)
        }
        Err(e) => {
            log::debug!("Spotify : profil non relu : {e}");
            return Ok(());
        }
    };
    let changed = {
        let mut inner = state(app).lock();
        inner.profile_checked = true;
        let Some(stored) = inner.stored.as_mut() else {
            return Ok(());
        };
        let changed = stored.account.as_deref() != Some(profile.account.as_str())
            || stored.premium != profile.premium;
        stored.account = Some(profile.account);
        stored.premium = profile.premium;
        if changed {
            persist(&inner);
        }
        changed
    };
    if changed {
        emit_status(app);
    }
    Ok(())
}

/// Pochette de `url` : celle déjà téléchargée, sinon téléchargée maintenant (`None` en cas d'échec).
fn artwork_for(app: &AppHandle, url: &str) -> Option<Arc<Vec<u8>>> {
    let spotify = state(app);
    if let Some((cached, bytes)) = &spotify.lock().artwork {
        if cached == url {
            return Some(Arc::clone(bytes));
        }
    }
    let client = spotify.client().ok()?;
    match api::download_artwork(client, url) {
        Ok(Some(bytes)) => {
            let bytes = Arc::new(bytes);
            spotify.lock().artwork = Some((url.to_owned(), Arc::clone(&bytes)));
            Some(bytes)
        }
        Ok(None) => None,
        Err(e) => {
            log::debug!("Spotify : pochette non téléchargée : {e}");
            None
        }
    }
}

/// Un sondage : lecture en cours du compte (et sa pochette).
fn poll_once(app: &AppHandle) -> Result<Option<Remote>, ApiError> {
    check_profile(app)?;
    let sent = now_ms();
    let body = with_token(app, api::player)?;
    let received = now_ms();
    let Some(body) = body else {
        return Ok(None);
    };
    let premium = state(app).lock().stored.as_ref().is_some_and(|s| s.premium);
    // `progress_ms` est juste au moment où Spotify a répondu : milieu de l'aller-retour.
    let read_at = sent + received.saturating_sub(sent) / 2;
    let Some(playback) =
        player::parse_player(&body, premium, read_at).map_err(ApiError::Invalid)?
    else {
        return Ok(None);
    };
    let artwork = playback
        .track
        .artwork_key
        .as_deref()
        .and_then(|url| artwork_for(app, url));
    Ok(Some(Remote { playback, artwork }))
}

fn poll_loop(app: &AppHandle, wake: &Receiver<Duration>) {
    log::info!("lecture de Spotify prête (toutes les {POLL_ACTIVE:?} avec un compte connecté)");
    let mut next = Instant::now();
    let mut last_ok: Option<Instant> = None;
    let mut last_error = String::new();
    loop {
        let now = Instant::now();
        if next > now {
            match wake.recv_timeout(next - now) {
                Ok(delay) => {
                    next = next.min(Instant::now() + delay);
                    continue;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let enabled = app.state::<DesktopState>().shared().music_enabled;
        if !enabled || !connected(app) {
            if state(app).lock().remote.is_some() {
                set_remote(app, None);
            }
            last_ok = None;
            next = Instant::now() + POLL_IDLE;
            continue;
        }
        match poll_once(app) {
            Ok(remote) => {
                last_ok = Some(Instant::now());
                last_error.clear();
                set_remote(app, remote);
            }
            Err(ApiError::RateLimited(wait)) => {
                log::warn!("Spotify : trop de demandes, pause de {} s", wait.as_secs());
                next = Instant::now() + wait;
                continue;
            }
            Err(ApiError::Revoked | ApiError::NotConnected) => {
                set_remote(app, None);
                next = Instant::now() + POLL_IDLE;
                continue;
            }
            Err(e) => {
                let message = e.to_string();
                // Une erreur qui se répète : signalée une fois, puis en debug.
                if message != last_error {
                    log::warn!("Spotify : lecture en cours impossible : {message}");
                    last_error = message;
                } else {
                    log::debug!("Spotify : lecture en cours impossible : {message}");
                }
                if last_ok.map_or(true, |t| t.elapsed() > KEEP_ON_ERROR) {
                    set_remote(app, None);
                }
            }
        }
        let spotify = state(app);
        let active =
            spotify.lock().remote.is_some() || !spotify.local_playing.load(Ordering::Relaxed);
        next = Instant::now() + if active { POLL_ACTIVE } else { POLL_SLOW };
    }
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

/// Commande correspondant au bouton de l'île (`playPause` selon l'état connu).
fn player_command(command: MediaCommand, playing: bool) -> Option<PlayerCommand> {
    match command {
        MediaCommand::Previous => Some(PlayerCommand::Previous),
        MediaCommand::Next => Some(PlayerCommand::Next),
        MediaCommand::PlayPause if playing => Some(PlayerCommand::Pause),
        MediaCommand::PlayPause => Some(PlayerCommand::Play),
        MediaCommand::Open => None,
    }
}

/// Ouvre l'app Spotify (`spotify:`), sinon le lecteur web.
fn open_spotify() -> Result<(), String> {
    platform::open_url("spotify:")
        .or_else(|e| {
            log::debug!("Spotify : app introuvable ({e:#}), ouverture du lecteur web");
            platform::open_url("https://open.spotify.com")
        })
        .map_err(|e| format!("Impossible d'ouvrir Spotify : {e:#}"))
}

/// `music_command` quand l'île montre Spotify à distance (bloquant : depuis `spawn_blocking`).
pub fn command(app: &AppHandle, command: MediaCommand) -> Result<(), String> {
    let (remote, premium) = {
        let inner = state(app).lock();
        let premium = inner.stored.as_ref().is_some_and(|s| s.premium);
        (inner.remote.clone(), premium)
    };
    let playing = remote.as_ref().is_some_and(|r| r.playback.track.playing);
    let Some(action) = player_command(command, playing) else {
        return open_spotify();
    };
    if !premium {
        return Err(
            "Les commandes de Spotify sur un autre appareil demandent un compte Premium.".into(),
        );
    }
    if remote.as_ref().is_some_and(|r| !r.playback.can_control) {
        return Err("Cet appareil Spotify n'accepte pas les commandes.".into());
    }
    with_token(app, |client, token| {
        api::player_command(client, token, action)
    })
    .map_err(|e| match e {
        ApiError::PremiumRequired => {
            "Spotify refuse la commande (compte Premium nécessaire).".to_owned()
        }
        ApiError::NoActiveDevice => "Aucun appareil Spotify actif.".to_owned(),
        e => format!("Commande Spotify impossible : {e}"),
    })?;
    if matches!(action, PlayerCommand::Pause | PlayerCommand::Play) {
        toggle_remote(app, action == PlayerCommand::Play);
    }
    state(app).wake(AFTER_COMMAND);
    Ok(())
}

/// Lecture / pause appliquée tout de suite à la dernière lecture connue (la relecture confirme ensuite).
fn toggle_remote(app: &AppHandle, playing: bool) {
    let spotify = state(app);
    let mut inner = spotify.lock();
    if let Some(remote) = inner.remote.as_mut() {
        let track = &mut remote.playback.track;
        let now = now_ms();
        if track.playing {
            let elapsed = now.saturating_sub(track.position_at);
            track.position_ms = track.position_ms.map(|p| {
                let p = p.saturating_add(elapsed);
                track.duration_ms.map_or(p, |d| p.min(d))
            });
        }
        track.position_at = now;
        track.playing = playing;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boutons_de_l_ile() {
        assert_eq!(
            player_command(MediaCommand::PlayPause, true),
            Some(PlayerCommand::Pause)
        );
        assert_eq!(
            player_command(MediaCommand::PlayPause, false),
            Some(PlayerCommand::Play)
        );
        assert_eq!(
            player_command(MediaCommand::Previous, true),
            Some(PlayerCommand::Previous)
        );
        assert_eq!(
            player_command(MediaCommand::Next, false),
            Some(PlayerCommand::Next)
        );
        assert_eq!(player_command(MediaCommand::Open, true), None);
    }

    /// Diagnostic manuel avec un compte déjà connecté dans l'app (lit `spotify.json` du dossier de données) :
    /// `cargo test print_spotify_player -- --ignored --nocapture` (dans `src-tauri/`). N'affiche aucun jeton.
    #[test]
    #[ignore]
    fn print_spotify_player() {
        crate::logging::init();
        // Windows : %APPDATA% ; macOS : ~/Library/Application Support.
        let base = std::env::var_os("APPDATA").map(PathBuf::from).or_else(|| {
            std::env::var_os("HOME").map(|home| {
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
            })
        });
        let path = base
            .expect("dossier de données introuvable")
            .join("com.sordulo.os")
            .join(FILE_NAME);
        let stored = store::load(&path).expect("aucun compte Spotify connecté dans l'app");
        let mut tokens = stored.tokens.clone().expect("compte à reconnecter");
        let client = api::client().unwrap();
        if tokens.expires_soon(now_ms()) {
            tokens = api::refresh(&client, &stored.client_id, &tokens.refresh_token, now_ms())
                .expect("rafraîchissement");
            println!("jeton rafraîchi (non enregistré : relancer l'app ensuite)");
        }
        println!("profil : {:?}", api::profile(&client, &tokens.access_token));
        match api::player(&client, &tokens.access_token) {
            Ok(Some(body)) => {
                let playback = player::parse_player(&body, stored.premium, now_ms());
                println!("lecture : {playback:?}");
                if let Ok(Some(p)) = playback {
                    if let Some(url) = p.track.artwork_key.as_deref() {
                        match api::download_artwork(&client, url) {
                            Ok(Some(bytes)) => println!("pochette : {} octets", bytes.len()),
                            other => println!("pochette : {other:?}"),
                        }
                    }
                }
            }
            Ok(None) => println!("rien en cours sur le compte"),
            Err(e) => println!("erreur : {e}"),
        }
    }
}
