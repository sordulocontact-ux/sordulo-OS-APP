//! Lancement de Sordulo OS à l'ouverture de session (Windows et macOS), par `tauri-plugin-autostart` :
//! clé `HKCU\…\CurrentVersion\Run` sous Windows, LaunchAgent `~/Library/LaunchAgents` sous macOS.
//!
//! - Activé tout seul au premier lancement de la version installée (release), puis l'utilisateur garde
//!   la main par la case « Lancer au démarrage » du menu de la zone de notification. Le témoin
//!   `autostart-init` (`app_config_dir()`) évite de le réactiver après un refus.
//! - Jamais en dev : le binaire de `target/debug` charge le front sur le serveur Vite local, il
//!   s'ouvrirait sur une page blanche à l'ouverture de session.
//! - Lancé à l'ouverture de session (argument `--autostart`), l'app démarre discrète : île et icône
//!   de la zone de notification, sans la fenêtre principale.

use std::fs;

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

/// Argument ajouté à la commande enregistrée pour l'ouverture de session.
const ARG_AUTOSTART: &str = "--autostart";
/// Témoin du premier lancement de la version installée.
const INIT_MARKER: &str = "autostart-init";

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_autostart::Builder::new()
        .arg(ARG_AUTOSTART)
        .build()
}

/// Vrai pour la version installée : seule elle peut être relancée sans serveur de dev.
pub fn available() -> bool {
    !cfg!(debug_assertions)
}

/// Vrai si ce processus a été lancé par l'ouverture de session.
pub fn launched_at_login(args: &[String]) -> bool {
    args.iter().any(|a| a == ARG_AUTOSTART)
}

/// État réel de l'enregistrement auprès du système (faux en dev ou en cas d'erreur).
pub fn is_enabled(app: &AppHandle) -> bool {
    available()
        && app.autolaunch().is_enabled().unwrap_or_else(|e| {
            log::warn!("lancement au démarrage : état illisible : {e}");
            false
        })
}

/// Active ou coupe le lancement au démarrage. Renvoie l'état réel ensuite.
pub fn set_enabled(app: &AppHandle, on: bool) -> bool {
    if !available() {
        return false;
    }
    let manager = app.autolaunch();
    let result = if on { manager.enable() } else { manager.disable() };
    match result {
        Ok(()) => log::info!(
            "lancement au démarrage {}",
            if on { "activé" } else { "désactivé" }
        ),
        Err(e) => log::warn!("lancement au démarrage : modification impossible : {e}"),
    }
    is_enabled(app)
}

/// Au démarrage : active au premier lancement de la version installée, sinon remet à jour le chemin
/// enregistré (l'app a pu être réinstallée ailleurs) s'il est déjà actif.
pub fn init(app: &AppHandle) {
    if !available() {
        return;
    }
    let marker = match app.path().app_config_dir() {
        Ok(dir) => dir.join(INIT_MARKER),
        Err(e) => {
            log::warn!("lancement au démarrage : dossier de configuration introuvable : {e}");
            return;
        }
    };
    if !marker.exists() {
        set_enabled(app, true);
        let written = marker
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|_| fs::write(&marker, b""));
        if let Err(e) = written {
            log::warn!("lancement au démarrage : témoin {} non écrit : {e}", marker.display());
        }
    } else if is_enabled(app) {
        set_enabled(app, true);
    }
}
