//! Icône soleil dans la zone de notification et son menu (dont la case « Mode concentration » et
//! « Connecter / Déconnecter Claude Code » avec sa ligne d'état, voir `claude/`).

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::claude;
use crate::events::{EVENT_FOCUS_MODE, WINDOW_PROMPT};
use crate::recording;
use crate::state::{DesktopState, FocusModeState, PromptReason, RecordingStatus};
use crate::time::format_duration;
use crate::windows_mgmt;

const TRAY_ID: &str = "sordulo-tray";
const ID_OPEN: &str = "open";
const ID_STATUS: &str = "status";
const ID_TOGGLE: &str = "toggle-recording";
const ID_FOCUS: &str = "focus-mode";
const ID_CLAUDE_STATUS: &str = "claude-status";
const ID_CLAUDE_TOGGLE: &str = "claude-toggle";
const ID_QUIT: &str = "quit";

const LABEL_START: &str = "Démarrer l'enregistrement";
const LABEL_STOP: &str = "Arrêter l'enregistrement";

/// Éléments du menu mis à jour selon l'état (gardés dans l'état géré de Tauri).
pub struct TrayMenu {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    focus: CheckMenuItem<Wry>,
    claude_status: MenuItem<Wry>,
    claude_toggle: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, ID_OPEN, "Ouvrir Sordulo OS", true, None::<&str>)?;
    let status = MenuItem::with_id(app, ID_STATUS, "Micro : inactif", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, LABEL_START, true, None::<&str>)?;
    let focus = CheckMenuItem::with_id(
        app,
        ID_FOCUS,
        "Mode concentration",
        true,
        false,
        None::<&str>,
    )?;
    let (claude_text, claude_toggle_text, claude_enabled) = claude::menu_texts(app);
    let claude_status = MenuItem::with_id(app, ID_CLAUDE_STATUS, claude_text, false, None::<&str>)?;
    let claude_toggle = MenuItem::with_id(
        app,
        ID_CLAUDE_TOGGLE,
        claude_toggle_text,
        claude_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &status,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &focus,
            &PredefinedMenuItem::separator(app)?,
            &claude_status,
            &claude_toggle,
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

    app.manage(TrayMenu {
        status,
        toggle,
        focus,
        claude_status,
        claude_toggle,
    });
    refresh(app);
    refresh_claude(app);
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
        ID_FOCUS => {
            let on = !app.state::<DesktopState>().shared().focus_mode;
            set_focus_mode(app, on);
        }
        ID_CLAUDE_TOGGLE => claude::toggle_connection(app),
        ID_QUIT => {
            log::info!("« Quitter » depuis la zone de notification");
            recording::stop_before_exit(app);
            app.exit(0);
        }
        _ => {}
    }
}

/// Active ou coupe le mode concentration : état partagé, case du menu, puis `desktop://focus-mode` à l'île.
pub fn set_focus_mode(app: &AppHandle, on: bool) -> FocusModeState {
    let state = app.state::<DesktopState>();
    let changed = {
        let mut shared = state.shared();
        let changed = shared.focus_mode != on;
        shared.focus_mode = on;
        changed
    };
    // Toujours resynchroniser la case : le menu l'a peut-être déjà basculée lui-même au clic.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        if let Err(e) = menu.focus.set_checked(on) {
            log::warn!("menu (mode concentration) : {e}");
        }
    }
    let focus = FocusModeState { on };
    if changed {
        log::info!(
            "mode concentration {}",
            if on { "activé" } else { "désactivé" }
        );
        if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_FOCUS_MODE, focus) {
            log::warn!("émission de {EVENT_FOCUS_MODE} impossible : {e}");
        }
    }
    focus
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

/// Met à jour la ligne d'état Claude Code et le bouton Connecter / Déconnecter.
pub fn refresh_claude(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let (status, toggle, enabled) = claude::menu_texts(app);
    if let Err(e) = menu.claude_status.set_text(status) {
        log::warn!("menu (Claude Code) : {e}");
    }
    if let Err(e) = menu
        .claude_toggle
        .set_text(toggle)
        .and_then(|_| menu.claude_toggle.set_enabled(enabled))
    {
        log::warn!("menu (Claude Code) : {e}");
    }
}
