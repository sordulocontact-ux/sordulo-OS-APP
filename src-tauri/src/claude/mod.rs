//! Claude Code dans l'île : relais des hooks, demandes d'autorisation, Connecter / Déconnecter.
//!
//! Chaîne complète :
//! 1. Claude Code lance `sordulo-hook <EventName>` (binaire `src/bin/sordulo-hook.rs`) pour chacun de
//!    nos 9 hooks, installés dans `~/.claude/settings.json` (`settings.rs`).
//! 2. Le relais lit `claude-relay.json` (`app_data_dir()`, ex. `%APPDATA%\com.sordulo.os`) : port et
//!    jeton écrits ici au démarrage (jeton aléatoire régénéré à chaque lancement), fichier retiré à la
//!    sortie de l'app. Il POSTe le hook au serveur local (`server.rs`, 127.0.0.1 seulement).
//! 3. Le serveur construit un `ClaudeRelayEvent` (`event.rs`) et l'émet à l'île sur `desktop://claude`.
//!    PermissionRequest : la connexion reste ouverte, l'île répond avec `claude_answer`
//!    (allow / deny / later) ; 60 s sans réponse = pas de décision, Claude Code demande dans le terminal.
//!    Une demande terminée sans réponse de l'île (délai écoulé, relais qui raccroche) émet
//!    `PermissionCancelled` (même session, outil et requestId) ; rien après un `claude_answer`.
//! 4. `desktop://claude-connection` (`ClaudeConnection`) part à l'île à chaque changement de connexion
//!    et à chaque hook reçu (au plus une fois par seconde) ; le menu du soleil affiche le même état.
//!
//! Compilation du relais : `tauri dev` compile le relais par son `beforeDevCommand`
//! (`tauri.conf.json` : `cargo build --manifest-path src-tauri/Cargo.toml --bin sordulo-hook && npm run dev`),
//! puis lance `cargo run`, qui ne compile QUE le binaire par défaut (`default-run = "sordulo-os"`) ;
//! `cargo build` et `tauri build` compilent les deux binaires.
//! « Connecter Claude Code » copie `sordulo-hook(.exe)` depuis le dossier de l'exécutable courant
//! (`target/debug` en dev) vers `app_local_data_dir()/bin` (chemin stable, insensible aux
//! recompilations). Rattrapage en build de dev : si le relais manque malgré tout, l'app lance
//! elle-même `cargo build --bin sordulo-hook` sur le `Cargo.toml` de `src-tauri` (variable `CARGO`
//! posée par `cargo run`, sinon `cargo` du PATH). En cas d'échec : lancer cette commande à la main.
//! Au démarrage, si les hooks sont connectés, la copie est remise à jour si le relais a changé.

mod event;
mod server;
mod settings;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

pub use event::{ClaudeConnection, ClaudeDecision};
use event::{ClaudeHookEventName, ClaudeRelayEvent};
use server::{Pending, Relay};

use crate::events::{EVENT_CLAUDE, EVENT_CLAUDE_CONNECTION, WINDOW_PROMPT};
use crate::time::now_ms;
use crate::tray;

/// Fichier de découverte lu par le relais (même nom que dans `src/bin/sordulo-hook.rs`).
const RELAY_FILE_NAME: &str = "claude-relay.json";
/// Au plus une émission de `desktop://claude-connection` (et une mise à jour du menu) par seconde
/// pour les hooks reçus.
const CONNECTION_THROTTLE_MS: u64 = 1000;

#[derive(Debug, Default)]
struct Inner {
    /// Nos 9 hooks sont dans settings.json (relu au démarrage, après Connecter / Déconnecter et à
    /// chaque `claude_get_connection`).
    connected: bool,
    last_event_at: Option<u64>,
    /// Heure locale `HH:MM` du dernier hook, pour le menu du soleil.
    last_event_clock: Option<String>,
    last_emit_at: u64,
    /// Connecter / Déconnecter en cours.
    busy: bool,
    /// Dernier échec de Connecter / Déconnecter, affiché dans le menu jusqu'au prochain essai.
    last_error: Option<String>,
}

/// État du relais (géré par Tauri).
pub struct ClaudeState {
    token: String,
    /// `~/.claude/settings.json` (ou `$CLAUDE_CONFIG_DIR/settings.json`).
    settings_path: Option<PathBuf>,
    /// `app_local_data_dir()/bin` : copie stable du relais.
    relay_dir: Option<PathBuf>,
    /// `app_data_dir()/claude-relay.json`.
    relay_file: Option<PathBuf>,
    inner: Mutex<Inner>,
    /// Demandes d'autorisation en attente (partagées avec le serveur).
    pending: Arc<Pending>,
}

impl ClaudeState {
    fn data(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn connection(&self) -> ClaudeConnection {
        let inner = self.data();
        ClaudeConnection {
            connected: inner.connected,
            last_event_at: inner.last_event_at,
        }
    }
}

/// Identifiant d'une demande d'autorisation.
fn new_request_id() -> String {
    random_hex(12).unwrap_or_else(|| format!("req-{}", now_ms()))
}

/// `n` octets aléatoires en hexadécimal.
fn random_hex(n: usize) -> Option<String> {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// `~/.claude/settings.json` (Claude Code respecte aussi `CLAUDE_CONFIG_DIR`).
fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir).join("settings.json"));
    }
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".claude").join("settings.json"))
}

/// Démarre le relais : état géré, serveur local, fichier de découverte. Ne fait jamais échouer l'app.
pub fn start(app: &AppHandle) {
    let token = random_hex(32).unwrap_or_default();
    let settings_path = settings_path(app);
    let relay_dir = app.path().app_local_data_dir().ok().map(|d| d.join("bin"));
    let relay_file = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(RELAY_FILE_NAME));
    let connected = settings_path
        .as_deref()
        .is_some_and(settings::read_connected);
    let pending = Arc::new(Pending::default());
    app.manage(ClaudeState {
        token: token.clone(),
        settings_path,
        relay_dir,
        relay_file: relay_file.clone(),
        inner: Mutex::new(Inner {
            connected,
            ..Inner::default()
        }),
        pending: pending.clone(),
    });
    log::info!(
        "Claude Code : {}",
        if connected {
            "connecté"
        } else {
            "non connecté"
        }
    );

    if token.is_empty() {
        log::error!("relais Claude : aléa indisponible, serveur non démarré");
    } else {
        let hook_app = app.clone();
        let relay = Relay::new(
            token.clone(),
            pending,
            new_request_id,
            Box::new(move |event, input, request_id| on_hook(&hook_app, event, input, request_id)),
        );
        match server::spawn(Arc::new(relay)) {
            Ok(port) => match relay_file {
                Some(path) => match write_relay_file(&path, port, &token) {
                    Ok(()) => log::info!("relais Claude : 127.0.0.1:{port} ({})", path.display()),
                    Err(e) => log::error!("{e}"),
                },
                None => log::error!("relais Claude : dossier de données introuvable"),
            },
            Err(e) => log::error!("relais Claude : écoute impossible sur 127.0.0.1 : {e}"),
        }
    }

    if connected {
        // Garder la copie du relais à jour après une recompilation (sans lancer cargo).
        let app = app.clone();
        std::thread::spawn(move || {
            let state = app.state::<ClaudeState>();
            if let (Some(dir), Ok(exe)) = (state.relay_dir.as_deref(), std::env::current_exe()) {
                if let Some(source) = exe.parent() {
                    if let Err(e) = settings::install_relay(source, dir, now_ms()) {
                        log::warn!("relais Claude : {e}");
                    }
                }
            }
        });
    }
    tray::refresh_claude(app);
}

/// Écriture atomique de `{ port, token }`.
fn write_relay_file(path: &Path, port: u16, token: &str) -> Result<(), String> {
    let error = |e: std::io::Error| {
        format!(
            "relais Claude : écriture de {} impossible : {e}",
            path.display()
        )
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(error)?;
    }
    let content = serde_json::json!({ "port": port, "token": token, "pid": std::process::id() });
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content.to_string()).map_err(error)?;
    std::fs::rename(&tmp, path).map_err(error)
}

/// À la sortie de l'app : retire `claude-relay.json` s'il est toujours le nôtre.
pub fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<ClaudeState>() else {
        return;
    };
    let Some(path) = state.relay_file.as_deref() else {
        return;
    };
    let ours = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|v| v.get("token").and_then(Value::as_str) == Some(state.token.as_str()));
    if ours && std::fs::remove_file(path).is_ok() {
        log::info!("relais Claude : {} retiré", path.display());
    }
}

/// Un hook est arrivé : événement à l'île, puis état de connexion (limité à une fois par seconde).
fn on_hook(app: &AppHandle, event: ClaudeHookEventName, input: &Value, request_id: Option<String>) {
    let at = now_ms();
    let branch = input
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
        .and_then(|cwd| event::git_branch(Path::new(cwd)));
    let relay_event: ClaudeRelayEvent = event::build_event(event, input, at, branch, request_id);
    log::debug!(
        "hook Claude {} ({})",
        event.as_str(),
        relay_event.session_id
    );
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_CLAUDE, &relay_event) {
        log::warn!("émission de {EVENT_CLAUDE} impossible : {e}");
    }
    // PermissionCancelled vient de l'app, pas d'un hook : pas de « dernier événement ».
    if event == ClaudeHookEventName::PermissionCancelled {
        return;
    }

    let state = app.state::<ClaudeState>();
    let emit = {
        let mut inner = state.data();
        inner.last_event_at = Some(at);
        inner.last_event_clock = Some(local_clock());
        let due = at.saturating_sub(inner.last_emit_at) >= CONNECTION_THROTTLE_MS;
        if due {
            inner.last_emit_at = at;
        }
        due
    };
    if emit {
        emit_connection(app);
        tray::refresh_claude(app);
    }
}

fn emit_connection(app: &AppHandle) {
    let connection = app.state::<ClaudeState>().connection();
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_CLAUDE_CONNECTION, connection) {
        log::warn!("émission de {EVENT_CLAUDE_CONNECTION} impossible : {e}");
    }
}

/// `claude_get_connection` : relit settings.json (l'utilisateur a pu le modifier à la main).
pub fn connection(app: &AppHandle) -> ClaudeConnection {
    let state = app.state::<ClaudeState>();
    let connected = state
        .settings_path
        .as_deref()
        .is_some_and(settings::read_connected);
    let changed = {
        let mut inner = state.data();
        let changed = inner.connected != connected;
        inner.connected = connected;
        changed
    };
    if changed {
        tray::refresh_claude(app);
    }
    state.connection()
}

/// `claude_answer` : transmet la décision de l'île au relais qui attend.
pub fn answer(app: &AppHandle, request_id: &str, decision: ClaudeDecision) -> Result<(), String> {
    let state = app.state::<ClaudeState>();
    if state.pending.answer(request_id, decision) {
        log::info!("relais Claude : demande {request_id} → {decision:?}");
        Ok(())
    } else {
        Err("Cette demande d'autorisation n'attend plus de réponse.".into())
    }
}

/// Textes du menu du soleil : (ligne d'état, bouton, bouton actif).
pub fn menu_texts(app: &AppHandle) -> (String, &'static str, bool) {
    let Some(state) = app.try_state::<ClaudeState>() else {
        return (
            "Claude Code : non connecté".into(),
            "Connecter Claude Code",
            false,
        );
    };
    let inner = state.data();
    let toggle = if inner.connected {
        "Déconnecter Claude Code"
    } else {
        "Connecter Claude Code"
    };
    let status = if inner.busy {
        "Claude Code : mise à jour…".to_string()
    } else if let Some(error) = &inner.last_error {
        format!("Claude Code : échec ({})", shorten(error, 70))
    } else if inner.connected {
        match &inner.last_event_clock {
            Some(clock) => format!("Claude Code : connecté, dernier événement à {clock}"),
            None => "Claude Code : connecté, aucun événement".to_string(),
        }
    } else {
        "Claude Code : non connecté".to_string()
    };
    (status, toggle, !inner.busy)
}

fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.push('…');
    out
}

/// Clic sur « Connecter / Déconnecter Claude Code » : travail hors du thread du menu.
pub fn toggle_connection(app: &AppHandle) {
    let state = app.state::<ClaudeState>();
    let connect = {
        let mut inner = state.data();
        if inner.busy {
            return;
        }
        inner.busy = true;
        inner.last_error = None;
        !inner.connected
    };
    tray::refresh_claude(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = if connect {
            connect_hooks(&app)
        } else {
            disconnect_hooks(&app)
        };
        let state = app.state::<ClaudeState>();
        let connected = state
            .settings_path
            .as_deref()
            .is_some_and(settings::read_connected);
        {
            let mut inner = state.data();
            inner.busy = false;
            inner.connected = connected;
            inner.last_error = result.as_ref().err().cloned();
        }
        match result {
            Ok(()) => log::info!(
                "Claude Code {}",
                if connected {
                    "connecté"
                } else {
                    "déconnecté"
                }
            ),
            Err(e) => log::error!("Claude Code : {e}"),
        }
        emit_connection(&app);
        tray::refresh_claude(&app);
    });
}

fn connect_hooks(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ClaudeState>();
    let settings_path = state
        .settings_path
        .as_deref()
        .ok_or("Dossier personnel introuvable.")?;
    let relay_dir = state
        .relay_dir
        .as_deref()
        .ok_or("Dossier de données de l'app introuvable.")?;
    let exe = std::env::current_exe().map_err(|e| format!("Exécutable introuvable : {e}"))?;
    let source_dir = exe.parent().ok_or("Dossier de l'exécutable introuvable.")?;
    #[cfg(debug_assertions)]
    build_relay_if_missing(source_dir);
    let relay = settings::install_relay(source_dir, relay_dir, now_ms())?;
    let quoted = settings::quoted_exe(&relay)?;
    if settings::connect_file(settings_path, &quoted, now_ms())? {
        log::info!("hooks ajoutés à {}", settings_path.display());
    }
    Ok(())
}

fn disconnect_hooks(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ClaudeState>();
    let settings_path = state
        .settings_path
        .as_deref()
        .ok_or("Dossier personnel introuvable.")?;
    if settings::disconnect_file(settings_path, now_ms())? {
        log::info!("hooks retirés de {}", settings_path.display());
    }
    Ok(())
}

/// Dev seulement, filet de sécurité si le `beforeDevCommand` n'a pas compilé le relais (`cargo run`
/// seul ne le compile pas) : on le compile à la demande.
#[cfg(debug_assertions)]
fn build_relay_if_missing(source_dir: &Path) {
    if source_dir.join(settings::RELAY_EXE).is_file() {
        return;
    }
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    log::info!(
        "relais absent de {} : cargo build --bin sordulo-hook",
        source_dir.display()
    );
    match std::process::Command::new(cargo)
        .arg("build")
        .arg("--bin")
        .arg("sordulo-hook")
        .arg("--manifest-path")
        .arg(&manifest)
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(status) => log::warn!("compilation du relais : {status}"),
        Err(e) => log::warn!("compilation du relais impossible : {e}"),
    }
}

/// Heure locale `HH:MM` (menu du soleil).
// TODO(platform) : à déplacer dans `platform/` (en cours de modification par un autre lot).
#[cfg(windows)]
fn local_clock() -> String {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    // SAFETY : GetLocalTime remplit la structure fournie, sans autre effet.
    let time = unsafe {
        let mut time = std::mem::zeroed();
        GetLocalTime(&mut time);
        time
    };
    format!("{:02}:{:02}", time.wHour, time.wMinute)
}

/// Heure locale `HH:MM` (macOS, Linux) par `localtime_r` ; UTC si l'heure locale est illisible.
#[cfg(not(windows))]
fn local_clock() -> String {
    /// `struct tm` de la libc (macOS, Linux 64 bits).
    #[repr(C)]
    struct Tm {
        sec: i32,
        min: i32,
        hour: i32,
        mday: i32,
        mon: i32,
        year: i32,
        wday: i32,
        yday: i32,
        isdst: i32,
        gmtoff: std::ffi::c_long,
        zone: *const std::ffi::c_char,
    }
    extern "C" {
        fn localtime_r(time: *const i64, out: *mut Tm) -> *mut Tm;
    }
    let seconds = (now_ms() / 1000) as i64;
    let mut tm = std::mem::MaybeUninit::<Tm>::uninit();
    // SAFETY : localtime_r remplit `tm` (réentrant) et rend NULL en cas d'échec.
    let ok = unsafe { !localtime_r(&seconds, tm.as_mut_ptr()).is_null() };
    if ok {
        // SAFETY : initialisée par localtime_r ci-dessus.
        let tm = unsafe { tm.assume_init() };
        return format!("{:02}:{:02}", tm.hour, tm.min);
    }
    let minutes = (now_ms() / 60_000) % (24 * 60);
    format!("{:02}:{:02} UTC", minutes / 60, minutes % 60)
}
