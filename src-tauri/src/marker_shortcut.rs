//! Raccourci global « marquer un moment » (Ctrl+Alt+M sous Windows, Control+Command+M sous macOS, voir
//! `platform::marker_shortcuts`), même code pour les deux systèmes : extension tauri-plugin-global-shortcut
//! (RegisterHotKey sous Windows, Carbon sous macOS, aucune autorisation à demander), utilisée seulement depuis
//! Rust (aucune permission côté JS).
//!
//! Enregistré au démarrage d'un enregistrement et retiré à son arrêt (`recording.rs`) : le reste du temps,
//! la combinaison reste aux autres apps. S'il est déjà pris par une autre app, l'enregistrement continue
//! (log seulement) ; le bouton « Marquer » de l'île reste disponible. L'appui (pas le relâchement) pose un
//! repère, sur un thread à part : le gestionnaire est appelé sur le thread principal.
//!
//! Sur macOS, l'extension fait chaque enregistrement sur le thread principal et attend qu'il soit fait :
//! jamais appeler `register` / `unregister` en tenant un verrou de `DesktopState`.

use std::str::FromStr;

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Wry};
use tauri_plugin_global_shortcut::{Builder, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::platform;
use crate::recording;

/// Raccourcis de ce système (lus une fois les chaînes de `platform` validées par les tests).
fn shortcuts() -> Vec<Shortcut> {
    platform::marker_shortcuts()
        .iter()
        .filter_map(|text| match Shortcut::from_str(text) {
            Ok(shortcut) => Some(shortcut),
            Err(e) => {
                log::error!("raccourci de repère « {text} » illisible : {e}");
                None
            }
        })
        .collect()
}

fn is_marker(shortcut: &Shortcut) -> bool {
    shortcuts().iter().any(|s| s.id() == shortcut.id())
}

/// L'extension, avec le gestionnaire des appuis (à ajouter au `tauri::Builder`).
pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed || !is_marker(shortcut) {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(e) = recording::add_marker(&app) {
                    log::debug!("raccourci de repère ignoré : {e}");
                }
            });
        })
        .build()
}

/// Prend le raccourci (début d'un enregistrement). Échec : log seulement.
pub fn register(app: &AppHandle) {
    let manager = app.global_shortcut();
    for shortcut in shortcuts() {
        if manager.is_registered(shortcut) {
            continue;
        }
        match manager.register(shortcut) {
            Ok(()) => log::info!("raccourci de repère pris : {shortcut}"),
            Err(e) => log::warn!(
                "raccourci de repère {shortcut} indisponible (pris par une autre app ?) : {e} ; \
                 le bouton « Marquer » de l'île reste disponible"
            ),
        }
    }
}

/// Rend le raccourci (fin d'un enregistrement).
pub fn unregister(app: &AppHandle) {
    let manager = app.global_shortcut();
    for shortcut in shortcuts() {
        if !manager.is_registered(shortcut) {
            continue;
        }
        match manager.unregister(shortcut) {
            Ok(()) => log::info!("raccourci de repère rendu : {shortcut}"),
            Err(e) => log::warn!("raccourci de repère {shortcut} non rendu : {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn raccourcis_de_windows_et_de_macos() {
        let parse = |text: &str| Shortcut::from_str(text).unwrap();
        assert_eq!(
            platform::MARKER_SHORTCUTS_WINDOWS
                .iter()
                .map(|t| parse(t))
                .collect::<Vec<_>>(),
            vec![Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::KeyM
            )]
        );
        let control_command = Some(Modifiers::CONTROL | Modifiers::SUPER);
        assert_eq!(
            platform::MARKER_SHORTCUTS_MACOS
                .iter()
                .map(|t| parse(t))
                .collect::<Vec<_>>(),
            vec![
                Shortcut::new(control_command, Code::KeyM),
                Shortcut::new(control_command, Code::Semicolon)
            ]
        );
        // Ceux du système compilé sont reconnus par le gestionnaire.
        assert_eq!(shortcuts().len(), platform::marker_shortcuts().len());
        assert!(shortcuts().iter().all(is_marker));
        assert!(!is_marker(&Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT),
            Code::KeyM
        )));
    }
}
