//! Icône soleil dans la zone de notification et son menu.

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::recording;
use crate::state::{DesktopState, PromptReason, RecordingStatus};
use crate::time::format_duration;
use crate::windows_mgmt;

const TRAY_ID: &str = "sordulo-tray";
const ID_OPEN: &str = "open";
const ID_STATUS: &str = "status";
const ID_TOGGLE: &str = "toggle-recording";
const ID_QUIT: &str = "quit";

const LABEL_START: &str = "Démarrer l'enregistrement";
const LABEL_STOP: &str = "Arrêter l'enregistrement";

/// Éléments du menu mis à jour selon l'état (gardés dans l'état géré de Tauri).
pub struct TrayMenu {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, ID_OPEN, "Ouvrir Sordulo OS", true, None::<&str>)?;
    let status = MenuItem::with_id(app, ID_STATUS, "Micro : inactif", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, LABEL_START, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &status,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Sordulo OS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            // Mémorise la position de l'icône pour placer la fenêtre prompt (Position::TrayBottomRight).
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows_mgmt::show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayMenu { status, toggle });
    refresh(app);
    log::info!("icône de la zone de notification créée");
    Ok(tray)
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => windows_mgmt::show_main(app),
        ID_TOGGLE => {
            let status = app
                .state::<DesktopState>()
                .shared()
                .session
                .as_ref()
                .map(|s| s.status);
            match status {
                None => windows_mgmt::show_prompt(app, PromptReason::ManualStart, true),
                Some(RecordingStatus::Recording) => {
                    windows_mgmt::show_prompt(app, PromptReason::ManualStop, true)
                }
                Some(_) => {} // arrêt déjà en cours
            }
        }
        ID_QUIT => {
            log::info!("« Quitter » depuis la zone de notification");
            recording::stop_before_exit(app);
            app.exit(0);
        }
        _ => {}
    }
}

/// Met à jour le libellé de statut et celui de démarrer/arrêter selon l'état courant.
pub fn refresh(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let state = app.state::<DesktopState>();
    let (mic, session) = {
        let shared = state.shared();
        (shared.mic.clone(), shared.session.clone())
    };
    let recording = state.recording_state_of(session.as_ref());

    let status_text = match recording.status {
        RecordingStatus::Recording => {
            format!(
                "Enregistrement : {}",
                format_duration(recording.elapsed_secs)
            )
        }
        RecordingStatus::Stopping => "Enregistrement : arrêt en cours…".to_string(),
        RecordingStatus::Idle if mic.active => format!("Micro : actif ({})", mic.app_names()),
        RecordingStatus::Idle => "Micro : inactif".to_string(),
    };
    let (toggle_text, toggle_enabled) = match recording.status {
        RecordingStatus::Idle => (LABEL_START, true),
        RecordingStatus::Recording => (LABEL_STOP, true),
        RecordingStatus::Stopping => (LABEL_STOP, false),
    };

    if let Err(e) = menu.status.set_text(status_text) {
        log::warn!("menu (statut) : {e}");
    }
    if let Err(e) = menu
        .toggle
        .set_text(toggle_text)
        .and_then(|_| menu.toggle.set_enabled(toggle_enabled))
    {
        log::warn!("menu (enregistrement) : {e}");
    }
}
