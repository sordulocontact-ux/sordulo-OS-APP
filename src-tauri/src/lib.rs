//! Coque Tauri 2 de Sordulo OS : fenêtres, zone de notification, détection du micro, commandes IPC.
//! Contrat avec le front : `src/shared/desktop-contract.ts`. Fonctions système : `platform/` uniquement.

mod commands;
mod events;
mod logging;
mod monitor;
mod platform;
mod recording;
mod state;
mod time;
mod tray;
mod windows_mgmt;

use tauri::WindowEvent;

use crate::events::{WINDOW_MAIN, WINDOW_PROMPT};
use crate::state::DesktopState;

pub fn run() {
    logging::init();
    log::info!("démarrage de Sordulo OS {}", env!("CARGO_PKG_VERSION"));

    let app = tauri::Builder::default()
        // En premier : un second lancement montre la fenêtre de l'instance déjà ouverte.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("second lancement : affichage de la fenêtre principale");
            windows_mgmt::show_main(app);
        }))
        .plugin(tauri_plugin_positioner::init())
        .manage(DesktopState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            windows_mgmt::create_prompt_window(&handle)?;
            tray::create(&handle)?;
            match recording::recordings_dir(&handle) {
                Ok(dir) => log::info!("dossier des enregistrements : {}", dir.display()),
                Err(e) => log::warn!("{e}"),
            }
            monitor::spawn_mic_loop(handle.clone());
            monitor::spawn_recording_ticker(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer une fenêtre la cache : l'app reste dans la zone de notification.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), WINDOW_MAIN | WINDOW_PROMPT) {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        log::warn!("impossible de cacher la fenêtre {} : {e}", window.label());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::start_recording,
            commands::stop_recording,
            commands::read_recording,
            commands::delete_recording,
            commands::dismiss_prompt,
            commands::show_main_window,
            commands::open_prompt,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de Sordulo OS");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            // Filet de sécurité (ex. arrêt de session Windows) : ne pas perdre un appel en cours.
            recording::stop_before_exit(app);
            log::info!("Sordulo OS s'arrête");
        }
    });
}
