//! Coque Tauri 2 de Sordulo OS : fenêtres (dont l'île), zone de notification, détection du micro,
//! musique en cours (`music.rs`, avec Spotify sur un autre appareil : `spotify/` ; vrai son analysé en
//! direct : `music_levels/`), relais Claude Code
//! (`claude/`), commandes IPC.
//! Contrat avec le front : `src/shared/desktop-contract.ts`. Fonctions système : `platform/` uniquement.

mod auth_link;
mod call_apps;
mod claude;
mod commands;
mod editor_windows;
mod dropped;
mod events;
mod island_window;
mod logging;
mod monitor;
mod music;
mod music_levels;
mod platform;
mod recording;
mod spotify;
mod state;
mod time;
mod tray;
mod windows_mgmt;

use tauri::{Manager, WindowEvent};

use crate::events::{WINDOW_MAIN, WINDOW_PROMPT};
use crate::state::DesktopState;

pub fn run() {
    logging::init();
    log::info!("démarrage de Sordulo OS {}", env!("CARGO_PKG_VERSION"));

    let app = tauri::Builder::default()
        // En premier : un second lancement montre la fenêtre de l'instance déjà ouverte.
        // Un clic sur le lien de connexion relance l'exécutable avec `sordulo://auth…` en argument.
        .plugin(tauri_plugin_single_instance::init(
            |app, args, _cwd| match auth_link::find_in_args(&args) {
                Some(url) => auth_link::deliver(app, url),
                None => {
                    log::info!("second lancement : affichage de la fenêtre principale");
                    windows_mgmt::show_main(app);
                }
            },
        ))
        .manage(DesktopState::new())
        .manage(spotify::SpotifyState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            auth_link::register();
            // App lancée par le lien de connexion alors qu'elle était fermée.
            let args: Vec<String> = std::env::args().collect();
            if let Some(url) = auth_link::find_in_args(&args) {
                handle.state::<DesktopState>().shared().pending_auth_url = Some(url);
            }
            island_window::create(&handle)?;
            claude::start(&handle);
            tray::create(&handle)?;
            match recording::recordings_dir(&handle) {
                Ok(dir) => log::info!("dossier des enregistrements : {}", dir.display()),
                Err(e) => log::warn!("{e}"),
            }
            island_window::spawn_pointer_loop(handle.clone());
            monitor::spawn_mic_loop(handle.clone());
            spotify::start(&handle);
            music::spawn_music_loop(handle.clone());
            monitor::spawn_recording_ticker(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenêtre principale la cache : l'app reste dans la zone de notification.
            // L'île ne se ferme ni ne se cache jamais (Alt+F4 compris).
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    WINDOW_MAIN => {
                        api.prevent_close();
                        if let Err(e) = window.hide() {
                            log::warn!("impossible de cacher la fenêtre {WINDOW_MAIN} : {e}");
                        }
                    }
                    WINDOW_PROMPT => api.prevent_close(),
                    _ => {}
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
            commands::take_auth_callback,
            commands::island_set_hit_rects,
            commands::open_main_at,
            commands::get_focus_mode,
            commands::set_focus_mode,
            commands::claude_get_connection,
            commands::claude_answer,
            commands::claude_open_session,
            commands::save_dropped_file,
            commands::copy_text,
            commands::get_music,
            commands::get_music_artwork,
            commands::music_command,
            commands::spotify_status,
            commands::spotify_connect,
            commands::spotify_disconnect,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de Sordulo OS");

    app.run(|app, event| match event {
        tauri::RunEvent::Exit => {
            // Filet de sécurité (ex. arrêt de session Windows) : ne pas perdre un appel en cours.
            recording::stop_before_exit(app);
            claude::shutdown(app);
            log::info!("Sordulo OS s'arrête");
        }
        // macOS : le lien de connexion arrive par un événement, pas en argument (voir auth_link).
        // Seule exception à « pas de cfg hors de platform/ » : la variante n'existe que sur macOS.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            if let Some(url) = auth_link::from_opened(&urls) {
                auth_link::deliver(app, url);
            }
        }
        _ => {}
    });
}
