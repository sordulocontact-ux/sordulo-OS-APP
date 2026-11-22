//! Mises à jour automatiques de la version installée (Windows et macOS), par
//! `tauri-plugin-updater` : `latest.json` signé sur GitHub Releases (configuration
//! `plugins.updater` de `tauri.conf.json`).
//!
//! - Jamais en dev : état `disabled`, le plugin n'est même pas enregistré (voir `register`).
//! - Première vérification 60 s après le démarrage, puis toutes les 4 h. Une version plus récente
//!   est téléchargée en arrière-plan et gardée en mémoire (état `ready`).
//! - Installation seulement à un moment calme : fenêtre principale cachée et aucun enregistrement
//!   (« arrêt en cours » compris), vérifié toutes les 30 s. Jamais pendant un enregistrement.
//! - Installation : Windows lance l'installeur NSIS (mode silencieux) puis quitte aussitôt par
//!   `process::exit`, sans `RunEvent::Exit` : `before_exit` fait donc ici ce que fait `lib.rs` à la
//!   sortie ; l'installeur relance l'app. macOS remplace le `.app` en place sans quitter : l'app se
//!   relance par `request_restart`, qui passe par `RunEvent::Exit`.
//! - Le témoin `update-restart` (`app_config_dir()`) dit à l'app relancée si elle doit rouvrir la
//!   fenêtre principale (cachée lors d'une installation au calme, ouverte avec
//!   `install_update_now`).
//! - Après une mise à jour, notification « Sordulo OS est à jour » (témoin `last-version`).
//!
//! État envoyé à la fenêtre principale (`desktop://update-status`), affiché dans le menu du soleil et
//! dans Paramètres > Application de bureau (`check_update`, `install_update_now`).
//!
//! Menu du soleil : un menu se ferme dès qu'on clique (comportement du système, impossible à garder
//! ouvert). Le résultat d'une recherche lancée depuis le menu arrive donc par une notification (à jour,
//! prête, échec), et une mise à jour prête change la ligne en « Installer la mise à jour X et
//! redémarrer », qui installe tout de suite.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::{NotificationExt, PermissionState};
use tauri_plugin_updater::{Update, UpdaterBuilder, UpdaterExt};

use crate::claude;
use crate::events::{EVENT_UPDATE_STATUS, WINDOW_MAIN};
use crate::recording;
use crate::state::{DesktopState, UpdateState, UpdateStatus};
use crate::time::now_ms;
use crate::tray;

/// Délai avant la première vérification : laisse l'app finir de démarrer.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
/// Intervalle entre deux vérifications automatiques.
const CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
/// Fréquence de la recherche d'un moment calme quand une mise à jour est prête.
const QUIET_POLL: Duration = Duration::from_secs(30);
/// Attente de la fin d'un enregistrement commencé pendant l'installation, avant de relancer.
const RECORDING_POLL: Duration = Duration::from_secs(2);
/// Durée maximale d'une requête (vérification ou téléchargement complet de l'installeur).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Au-delà, le témoin de relance est ignoré (installation interrompue, app relancée plus tard).
const RESTART_MARKER_MAX_AGE_MS: u64 = 10 * 60 * 1000;

/// Dernière version lancée, pour la notification après une mise à jour.
const LAST_VERSION_FILE: &str = "last-version";
/// Témoin écrit juste avant l'installation : `<epoch ms> shown|hidden`.
const RESTART_MARKER_FILE: &str = "update-restart";

const NOTIFICATION_TITLE: &str = "Sordulo OS est à jour";

/// Mise à jour téléchargée et vérifiée (signature), en attente d'un moment calme.
struct Pending {
    update: Update,
    bytes: Vec<u8>,
}

/// État géré par Tauri. Verrous : `work` sérialise vérification, téléchargement et installation
/// (pris en premier, longtemps) ; `status` et `pending` sont pris brièvement, jamais ensemble.
pub struct UpdaterState {
    status: Mutex<UpdateStatus>,
    pending: Mutex<Option<Pending>>,
    work: Mutex<()>,
}

impl UpdaterState {
    fn status(&self) -> MutexGuard<'_, UpdateStatus> {
        self.status.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn pending(&self) -> MutexGuard<'_, Option<Pending>> {
        self.pending.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Attend la fin d'une vérification ou d'un téléchargement en cours.
    fn lock_work(&self) -> MutexGuard<'_, ()> {
        self.work.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `None` si une vérification, un téléchargement ou une installation est déjà en cours.
    fn try_work(&self) -> Option<MutexGuard<'_, ()>> {
        match self.work.try_lock() {
            Ok(guard) => Some(guard),
            Err(TryLockError::Poisoned(e)) => Some(e.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        }
    }
}

/// Vrai pour la version installée : le dev ne se met jamais à jour.
pub fn enabled() -> bool {
    !cfg!(debug_assertions)
}

/// Enregistre les plugins. Celui des mises à jour seulement en release : il exige la configuration
/// `plugins.updater` au démarrage, et le dev n'en a pas besoin.
pub fn register(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    let builder = builder.plugin(tauri_plugin_notification::init());
    if enabled() {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    }
}

/// Au démarrage, avant le menu du soleil : état initial, notification après une mise à jour, puis
/// boucle de vérification (release seulement).
pub fn init(app: &AppHandle) {
    let current = app.package_info().version.to_string();
    app.manage(UpdaterState {
        status: Mutex::new(UpdateStatus {
            current: current.clone(),
            state: if enabled() {
                UpdateState::Idle
            } else {
                UpdateState::Disabled
            },
            available: None,
            message: None,
        }),
        pending: Mutex::new(None),
        work: Mutex::new(()),
    });
    if !enabled() {
        log::info!("mises à jour automatiques désactivées (dev)");
        return;
    }
    notify_if_updated(app, &current);
    spawn_loop(app.clone());
}

/// État courant (`get_update_status`).
pub fn status(app: &AppHandle) -> UpdateStatus {
    match app.try_state::<UpdaterState>() {
        Some(state) => state.status().clone(),
        None => UpdateStatus {
            current: app.package_info().version.to_string(),
            state: UpdateState::Disabled,
            available: None,
            message: None,
        },
    }
}

/// Textes du menu du soleil : ligne d'état et action (rechercher, ou installer la version prête),
/// activée ou non.
pub fn menu_texts(app: &AppHandle) -> (String, String, bool) {
    let status = status(app);
    (status_line(&status), action_text(&status, enabled()), can_check(&status))
}

/// Action du menu du soleil, dans un thread à part (le menu est déjà fermé) : mise à jour prête →
/// installation immédiate ; sinon recherche, avec le résultat en notification.
pub fn menu_action(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let ready = status(app).state == UpdateState::Ready;
    let app = app.clone();
    let spawned = thread::Builder::new()
        .name("updater-menu".into())
        .spawn(move || {
            if ready {
                log::info!("mise à jour : installation demandée depuis le menu");
                if let Err(message) = install_now(&app) {
                    notify(&app, "Mise à jour non installée", &message);
                }
            } else {
                check_from_menu(&app);
            }
        });
    if let Err(e) = spawned {
        log::error!("mise à jour : thread du menu impossible : {e}");
    }
}

/// Recherche demandée depuis le menu : vérifie, télécharge, installe si le moment est calme, sinon
/// donne le résultat en notification (le menu fermé ne peut pas le montrer).
fn check_from_menu(app: &AppHandle) {
    {
        let state = app.state::<UpdaterState>();
        let Some(_work) = state.try_work() else {
            log::info!("mise à jour : vérification déjà en cours");
            return;
        };
        log::info!("mise à jour : vérification demandée depuis le menu");
        check_and_download(app);
    }
    install_if_quiet(app);
    if let Some((title, body)) = check_notification(&status(app)) {
        notify(app, title, &body);
    }
}

/// `check_update` (Paramètres) : vérifie et télécharge, sans installer (la fenêtre est ouverte :
/// l'utilisateur choisit « Installer et redémarrer »). Bloquant : hors du thread principal.
pub fn check_now(app: &AppHandle) -> Result<UpdateStatus, String> {
    if !enabled() {
        return Err("Les mises à jour ne concernent que la version installée de Sordulo OS.".into());
    }
    let state = app.state::<UpdaterState>();
    let _work = state.lock_work();
    log::info!("mise à jour : vérification demandée depuis les paramètres");
    check_and_download(app);
    Ok(status(app))
}

/// `install_update_now` : vérifie, télécharge et installe tout de suite, même fenêtre ouverte
/// (l'app redémarre). Refusé pendant un enregistrement. Bloquant : hors du thread principal.
pub fn install_now(app: &AppHandle) -> Result<UpdateStatus, String> {
    if !enabled() {
        return Err("Les mises à jour ne concernent que la version installée de Sordulo OS.".into());
    }
    const REFUSED: &str =
        "Un appel est en cours d'enregistrement : la mise à jour s'installera après l'appel.";
    if recording_in_progress(app) {
        return Err(REFUSED.into());
    }
    let state = app.state::<UpdaterState>();
    let _work = state.lock_work();
    log::info!("mise à jour : installation immédiate demandée");
    check_and_download(app);
    if state.pending().is_none() {
        // À jour, ou échec de la vérification (état `error` avec son message).
        return Ok(status(app));
    }
    // Le téléchargement a pu durer : un enregistrement a peut-être commencé entre-temps.
    if recording_in_progress(app) {
        return Err(REFUSED.into());
    }
    install_pending(app)?;
    Ok(status(app))
}

/// À appeler par `lib.rs` au démarrage : `Some(true / false)` si l'app vient d'être relancée par
/// une mise à jour et doit rouvrir (ou non) la fenêtre principale ; `None` sinon. Le témoin est
/// consommé.
pub fn take_restart_window(app: &AppHandle) -> Option<bool> {
    if !enabled() {
        return None;
    }
    let path = config_file(app, RESTART_MARKER_FILE)?;
    let content = fs::read_to_string(&path).ok()?;
    if let Err(e) = fs::remove_file(&path) {
        log::warn!("mise à jour : témoin {} non supprimé : {e}", path.display());
    }
    let show = parse_restart_marker(&content, now_ms());
    if let Some(show) = show {
        log::info!(
            "relancé après une mise à jour, fenêtre principale {}",
            if show { "rouverte" } else { "laissée cachée" }
        );
    }
    show
}

// ---------------------------------------------------------------------------
// Boucle, vérification, installation
// ---------------------------------------------------------------------------

fn spawn_loop(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("updater".into())
        .spawn(move || {
            thread::sleep(FIRST_CHECK_DELAY);
            let mut next_check = Instant::now();
            loop {
                if Instant::now() >= next_check {
                    next_check = Instant::now() + CHECK_EVERY;
                    let state = app.state::<UpdaterState>();
                    // Occupé (vérification lancée depuis le menu) : ce cycle est déjà fait.
                    let work = state.try_work();
                    if work.is_some() {
                        check_and_download(&app);
                    }
                    drop(work);
                }
                install_if_quiet(&app);
                thread::sleep(QUIET_POLL);
            }
        });
    if let Err(e) = spawned {
        log::error!("mise à jour : boucle de vérification impossible : {e}");
    }
}

/// Le plugin, avec le délai des requêtes et ce qu'il faut faire avant que Windows ne quitte.
fn updater_builder(app: &AppHandle) -> UpdaterBuilder {
    let handle = app.clone();
    app.updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .on_before_exit(move || {
            // Windows : l'installeur est lancé, le processus va quitter par `process::exit` sans
            // `RunEvent::Exit`. Même nettoyage que dans `lib.rs`, puis celui de Tauri (dont le
            // verrou d'instance unique, pour que l'app relancée par l'installeur démarre).
            log::info!("mise à jour : l'installeur prend la main, Sordulo OS s'arrête");
            recording::stop_before_exit(&handle);
            claude::shutdown(&handle);
            handle.cleanup_before_exit();
        })
}

/// Vérifie puis télécharge (appelant : verrou `work` tenu). Rien à faire si une mise à jour est
/// déjà prête. Les erreurs passent l'état à `error` ; nouvel essai au prochain cycle.
fn check_and_download(app: &AppHandle) {
    let state = app.state::<UpdaterState>();
    if state.pending().is_some() {
        return;
    }
    publish(app, UpdateState::Checking, None, None);
    let result = (|| -> tauri_plugin_updater::Result<Option<Pending>> {
        let updater = updater_builder(app).build()?;
        let Some(update) = tauri::async_runtime::block_on(updater.check())? else {
            return Ok(None);
        };
        log::info!("mise à jour : version {} trouvée, téléchargement", update.version);
        publish(app, UpdateState::Downloading, Some(update.version.clone()), None);
        // `download` vérifie la signature avant de rendre les octets.
        let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}))?;
        Ok(Some(Pending { update, bytes }))
    })();
    match result {
        Ok(None) => {
            log::info!("mise à jour : aucune version plus récente");
            publish(app, UpdateState::UpToDate, None, None);
        }
        Ok(Some(pending)) => {
            let version = pending.update.version.clone();
            log::info!(
                "mise à jour : version {version} prête ({} octets), installée au prochain moment \
                 calme",
                pending.bytes.len()
            );
            *state.pending() = Some(pending);
            publish(app, UpdateState::Ready, Some(version), None);
        }
        Err(e) => {
            let message = error_message(&e);
            log::warn!("mise à jour : échec de la vérification ou du téléchargement : {e}");
            // Échec du téléchargement : la version trouvée reste affichée.
            let available = {
                let status = state.status();
                (status.state == UpdateState::Downloading)
                    .then(|| status.available.clone())
                    .flatten()
            };
            publish(app, UpdateState::Error, available, Some(message));
        }
    }
}

/// Installe si une mise à jour est prête et que le moment est calme.
fn install_if_quiet(app: &AppHandle) {
    let state = app.state::<UpdaterState>();
    let ready = state.status().state;
    if !should_install(ready, main_window_visible(app), recording_in_progress(app)) {
        return;
    }
    let Some(_work) = state.try_work() else {
        return;
    };
    // Revérifié sous le verrou : l'état a pu changer pendant l'attente.
    let ready = state.status().state;
    if should_install(ready, main_window_visible(app), recording_in_progress(app)) {
        log::info!("mise à jour : moment calme (fenêtre cachée, aucun enregistrement)");
        // Erreur déjà journalisée et publiée par `install_pending`.
        let _ = install_pending(app);
    }
}

/// Installe la mise à jour prête (appelant : verrou `work` tenu, hors du thread principal). Windows
/// ne revient pas en cas de succès (le processus quitte) ; macOS demande une relance.
fn install_pending(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<UpdaterState>();
    let Some(pending) = state.pending().take() else {
        return Err("Aucune mise à jour n'est prête.".into());
    };
    let version = pending.update.version.clone();
    publish(app, UpdateState::Installing, Some(version.clone()), None);
    write_restart_marker(app, main_window_visible(app));
    log::info!("mise à jour : installation de la version {version}");
    match pending.update.install(&pending.bytes) {
        Ok(()) => {
            // macOS : le nouveau .app est en place. Un enregistrement commencé pendant
            // l'installation va jusqu'au bout avant la relance.
            while recording_in_progress(app) {
                thread::sleep(RECORDING_POLL);
            }
            log::info!("mise à jour : version {version} installée, redémarrage");
            app.request_restart();
            Ok(())
        }
        Err(e) => {
            remove_restart_marker(app);
            let message = error_message(&e);
            log::error!("mise à jour : échec de l'installation de la version {version} : {e}");
            publish(app, UpdateState::Error, Some(version), Some(message.clone()));
            Err(message)
        }
    }
}

/// Change l'état, prévient la fenêtre principale et met à jour le menu du soleil.
fn publish(
    app: &AppHandle,
    state: UpdateState,
    available: Option<String>,
    message: Option<String>,
) {
    let status = {
        let updater = app.state::<UpdaterState>();
        let mut status = updater.status();
        status.state = state;
        status.available = available;
        status.message = message;
        status.clone()
    };
    if let Err(e) = app.emit_to(WINDOW_MAIN, EVENT_UPDATE_STATUS, &status) {
        log::warn!("émission de {EVENT_UPDATE_STATUS} impossible : {e}");
    }
    tray::refresh_update(app);
}

fn main_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window(WINDOW_MAIN)
        .is_some_and(|w| w.is_visible().unwrap_or(true))
}

/// Enregistrement en cours ou en cours d'arrêt.
fn recording_in_progress(app: &AppHandle) -> bool {
    app.state::<DesktopState>().shared().session.is_some()
}

fn error_message(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => {
            "Serveur des mises à jour injoignable. Nouvel essai plus tard.".into()
        }
        E::Minisign(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            "La signature de la mise à jour est invalide : elle n'a pas été installée.".into()
        }
        E::ReleaseNotFound | E::TargetNotFound(_) | E::TargetsNotFound(_) => {
            "Aucune mise à jour publiée pour ce système.".into()
        }
        _ => format!("Mise à jour impossible : {e}"),
    }
}

// ---------------------------------------------------------------------------
// Témoins (app_config_dir) et notification
// ---------------------------------------------------------------------------

fn config_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(name)),
        Err(e) => {
            log::warn!("mise à jour : dossier de configuration introuvable : {e}");
            None
        }
    }
}

fn write_file(path: &PathBuf, content: &str) {
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|_| fs::write(path, content));
    if let Err(e) = written {
        log::warn!("mise à jour : {} non écrit : {e}", path.display());
    }
}

fn write_restart_marker(app: &AppHandle, show_main: bool) {
    if let Some(path) = config_file(app, RESTART_MARKER_FILE) {
        let window = if show_main { "shown" } else { "hidden" };
        write_file(&path, &format!("{} {window}", now_ms()));
    }
}

fn remove_restart_marker(app: &AppHandle) {
    if let Some(path) = config_file(app, RESTART_MARKER_FILE) {
        let _ = fs::remove_file(path);
    }
}

/// Notification système si la version a monté depuis le dernier lancement, puis note la version.
fn notify_if_updated(app: &AppHandle, current: &str) {
    let Some(path) = config_file(app, LAST_VERSION_FILE) else {
        return;
    };
    let previous = fs::read_to_string(&path).ok();
    let previous = previous.as_deref().map(str::trim);
    if should_notify(previous, current) {
        log::info!(
            "mise à jour installée : {} vers {current}",
            previous.unwrap_or_default()
        );
        show_updated_notification(app, current);
    }
    if previous != Some(current) {
        write_file(&path, current);
    }
}

fn show_updated_notification(app: &AppHandle, version: &str) {
    notify(app, NOTIFICATION_TITLE, &format!("Version {version} installée."));
}

/// Notification système (demande l'autorisation la première fois).
fn notify(app: &AppHandle, title: &str, body: &str) {
    let notification = app.notification();
    let granted = match notification.permission_state() {
        Ok(PermissionState::Granted) => true,
        _ => matches!(notification.request_permission(), Ok(PermissionState::Granted)),
    };
    if !granted {
        log::info!("mise à jour : notifications refusées par le système");
        return;
    }
    if let Err(e) = notification.builder().title(title).body(body).show() {
        log::warn!("mise à jour : notification impossible : {e}");
    }
}

/// Notification après une recherche lancée depuis le menu ; None pendant l'installation (l'app
/// redémarre et dira « Sordulo OS est à jour »).
fn check_notification(status: &UpdateStatus) -> Option<(&'static str, String)> {
    let available = status.available.as_deref().unwrap_or(&status.current);
    match status.state {
        UpdateState::UpToDate => Some((
            NOTIFICATION_TITLE,
            format!("Version {}, la plus récente.", status.current),
        )),
        UpdateState::Ready => Some((
            "Mise à jour prête",
            format!(
                "Version {available} téléchargée. Menu du soleil > Installer la mise à jour, ou elle \
                 s'installera quand la fenêtre de Sordulo OS sera fermée."
            ),
        )),
        UpdateState::Error => Some((
            "Mise à jour impossible",
            status
                .message
                .clone()
                .unwrap_or_else(|| "La recherche a échoué. Nouvel essai plus tard.".into()),
        )),
        _ => None,
    }
}

/// Texte de l'action du menu : installer la version prête, sinon rechercher.
fn action_text(status: &UpdateStatus, enabled: bool) -> String {
    if !enabled {
        return "Rechercher une mise à jour (version installée)".into();
    }
    match (status.state, status.available.as_deref()) {
        (UpdateState::Ready, Some(version)) => {
            format!("Installer la mise à jour {version} et redémarrer")
        }
        _ => "Rechercher une mise à jour".into(),
    }
}

// ---------------------------------------------------------------------------
// Décisions (pures, testées)
// ---------------------------------------------------------------------------

/// Moment calme : personne ne regarde l'app et aucun appel n'est enregistré.
fn is_quiet_moment(main_visible: bool, recording: bool) -> bool {
    !main_visible && !recording
}

fn should_install(state: UpdateState, main_visible: bool, recording: bool) -> bool {
    state == UpdateState::Ready && is_quiet_moment(main_visible, recording)
}

/// Compare « X.Y.Z » comme `compareVersions` (`src/shared/desktop-version.ts`) : « v » initial et
/// suffixes (`-beta`, `+build`) ignorés, partie illisible = 0.
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn parse(v: &str) -> Vec<u64> {
        let v = v.trim();
        let v = v.strip_prefix('v').or_else(|| v.strip_prefix('V')).unwrap_or(v);
        let core = v.split(['-', '+']).next().unwrap_or_default();
        core.split('.')
            .map(|part| {
                let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
                digits.parse().unwrap_or(0)
            })
            .collect()
    }
    let (pa, pb) = (parse(a), parse(b));
    let len = pa.len().max(pb.len()).max(3);
    (0..len)
        .map(|i| {
            let x = pa.get(i).copied().unwrap_or(0);
            let y = pb.get(i).copied().unwrap_or(0);
            x.cmp(&y)
        })
        .find(|o| o.is_ne())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Notifier seulement après une vraie montée de version (pas au premier lancement).
fn should_notify(previous: Option<&str>, current: &str) -> bool {
    previous.is_some_and(|p| !p.is_empty() && compare_versions(p, current).is_lt())
}

/// `<epoch ms> shown|hidden` → fenêtre principale à rouvrir ou non ; `None` si illisible ou périmé.
fn parse_restart_marker(content: &str, now: u64) -> Option<bool> {
    let mut parts = content.split_whitespace();
    let at: u64 = parts.next()?.parse().ok()?;
    let show = match parts.next()? {
        "shown" => true,
        "hidden" => false,
        _ => return None,
    };
    (now.saturating_sub(at) <= RESTART_MARKER_MAX_AGE_MS && at <= now.saturating_add(60_000))
        .then_some(show)
}

/// Ligne d'état du menu du soleil.
fn status_line(status: &UpdateStatus) -> String {
    let current = &status.current;
    let available = status.available.as_deref().unwrap_or(current);
    match status.state {
        UpdateState::Disabled => format!("Version {current} (dev)"),
        UpdateState::Idle => format!("Version {current}"),
        UpdateState::Checking => format!("Version {current} · recherche…"),
        UpdateState::UpToDate => format!("Version {current} · à jour"),
        UpdateState::Downloading => format!("Mise à jour {available} en téléchargement…"),
        UpdateState::Ready => format!("Mise à jour {available} prête"),
        UpdateState::Installing => format!("Installation de la mise à jour {available}…"),
        UpdateState::Error => format!("Version {current} · échec de la mise à jour"),
    }
}

/// « Rechercher une mise à jour » est grisé en dev et pendant une opération en cours.
fn can_check(status: &UpdateStatus) -> bool {
    !matches!(
        status.state,
        UpdateState::Disabled
            | UpdateState::Checking
            | UpdateState::Downloading
            | UpdateState::Installing
    )
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::*;

    fn status(state: UpdateState, available: Option<&str>) -> UpdateStatus {
        UpdateStatus {
            current: "0.2.0".into(),
            state,
            available: available.map(Into::into),
            message: None,
        }
    }

    #[test]
    fn installs_only_when_ready_and_quiet() {
        assert!(should_install(UpdateState::Ready, false, false));
        assert!(!should_install(UpdateState::Ready, true, false));
        assert!(!should_install(UpdateState::Ready, false, true));
        assert!(!should_install(UpdateState::Ready, true, true));
        for state in [
            UpdateState::Disabled,
            UpdateState::Idle,
            UpdateState::Checking,
            UpdateState::UpToDate,
            UpdateState::Downloading,
            UpdateState::Installing,
            UpdateState::Error,
        ] {
            assert!(!should_install(state, false, false), "{state:?}");
        }
    }

    #[test]
    fn compares_versions_like_the_front() {
        assert_eq!(compare_versions("0.1.0", "0.2.0"), Ordering::Less);
        assert_eq!(compare_versions("0.10.0", "0.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("v1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_versions("1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.2.3-beta.1", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_versions("1.2.3+build", "1.2.4"), Ordering::Less);
        assert_eq!(compare_versions(" 2.0.0\n", "1.99.99"), Ordering::Greater);
        assert_eq!(compare_versions("abc", "0.0.0"), Ordering::Equal);
    }

    #[test]
    fn notifies_only_after_an_upgrade() {
        assert!(should_notify(Some("0.1.0"), "0.2.0"));
        assert!(!should_notify(None, "0.2.0"), "premier lancement");
        assert!(!should_notify(Some(""), "0.2.0"));
        assert!(!should_notify(Some("0.2.0"), "0.2.0"));
        assert!(!should_notify(Some("0.3.0"), "0.2.0"), "retour en arrière");
    }

    #[test]
    fn reads_the_restart_marker() {
        let now = 1_000_000_000;
        assert_eq!(parse_restart_marker("999999000 shown", now), Some(true));
        assert_eq!(parse_restart_marker("999999000 hidden\n", now), Some(false));
        let old = now - RESTART_MARKER_MAX_AGE_MS - 1;
        assert_eq!(parse_restart_marker(&format!("{old} shown"), now), None);
        assert_eq!(parse_restart_marker("999999000 maybe", now), None);
        assert_eq!(parse_restart_marker("shown", now), None);
        assert_eq!(parse_restart_marker("", now), None);
        let future = now + 3_600_000;
        assert_eq!(parse_restart_marker(&format!("{future} shown"), now), None);
    }

    #[test]
    fn menu_lines() {
        let line = |state, available| status_line(&status(state, available));
        assert_eq!(line(UpdateState::Disabled, None), "Version 0.2.0 (dev)");
        assert_eq!(line(UpdateState::Idle, None), "Version 0.2.0");
        assert_eq!(line(UpdateState::Checking, None), "Version 0.2.0 · recherche…");
        assert_eq!(line(UpdateState::UpToDate, None), "Version 0.2.0 · à jour");
        assert_eq!(
            line(UpdateState::Downloading, Some("0.3.0")),
            "Mise à jour 0.3.0 en téléchargement…"
        );
        assert_eq!(line(UpdateState::Ready, Some("0.3.0")), "Mise à jour 0.3.0 prête");
        assert!(!line(UpdateState::Error, None).contains('—'));
        assert!(can_check(&status(UpdateState::UpToDate, None)));
        assert!(can_check(&status(UpdateState::Ready, Some("0.3.0"))));
        assert!(can_check(&status(UpdateState::Error, None)));
        assert!(!can_check(&status(UpdateState::Disabled, None)));
        assert!(!can_check(&status(UpdateState::Downloading, Some("0.3.0"))));
    }

    #[test]
    fn menu_action_installs_a_ready_update() {
        let text = |state, available| action_text(&status(state, available), true);
        assert_eq!(text(UpdateState::UpToDate, None), "Rechercher une mise à jour");
        assert_eq!(text(UpdateState::Error, None), "Rechercher une mise à jour");
        assert_eq!(
            text(UpdateState::Ready, Some("0.3.0")),
            "Installer la mise à jour 0.3.0 et redémarrer"
        );
        assert_eq!(
            action_text(&status(UpdateState::Disabled, None), false),
            "Rechercher une mise à jour (version installée)"
        );
    }

    #[test]
    fn notifies_the_result_of_a_menu_check() {
        let note = |state, available| check_notification(&status(state, available));
        let (title, body) = note(UpdateState::UpToDate, None).unwrap();
        assert_eq!(title, "Sordulo OS est à jour");
        assert!(body.contains("0.2.0"));
        let (title, body) = note(UpdateState::Ready, Some("0.3.0")).unwrap();
        assert_eq!(title, "Mise à jour prête");
        assert!(body.contains("0.3.0"));
        assert!(note(UpdateState::Error, None).is_some());
        assert!(note(UpdateState::Installing, Some("0.3.0")).is_none());
        assert!(note(UpdateState::Checking, None).is_none());
        for state in [UpdateState::UpToDate, UpdateState::Ready, UpdateState::Error] {
            let (title, body) = note(state, Some("0.3.0")).unwrap();
            assert!(!title.contains('—') && !body.contains('—'));
        }
    }
}
