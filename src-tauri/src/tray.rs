//! Icône soleil dans la zone de notification et son menu (dont les cases « Afficher l'île », voir
//! `island_window::set_hidden`, et « Replacer l'île en haut », voir `island_window::request_top`, « Mode concentration » et « Afficher la musique dans l'île », et « Connecter / Déconnecter Claude Code » avec sa ligne d'état,
//! voir `claude/`, la case « Lancer au démarrage », voir `autostart`, et la version avec « Rechercher une
//! mise à jour », voir `updater`).

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::autostart;
use crate::claude;
use crate::events::{EVENT_DEPLOYMENTS_ENABLED, EVENT_FOCUS_MODE, WINDOW_PROMPT};
use crate::island_window;
use crate::music;
use crate::recording;
use crate::state::{DeploymentsEnabledState, DesktopState, FocusModeState, PromptReason, RecordingStatus};
use crate::time::format_duration;
use crate::updater;
use crate::windows_mgmt;

const TRAY_ID: &str = "sordulo-tray";
const ID_OPEN: &str = "open";
const ID_STATUS: &str = "status";
const ID_TOGGLE: &str = "toggle-recording";
const ID_ISLAND: &str = "island";
const ID_ISLAND_TOP: &str = "island-top";
const ID_FOCUS: &str = "focus-mode";
const ID_MUSIC: &str = "music";
const ID_DEPLOYMENTS: &str = "deployments";
const ID_AUTOSTART: &str = "autostart";
const ID_UPDATE_STATUS: &str = "update-status";
const ID_UPDATE_CHECK: &str = "update-check";
const ID_CLAUDE_STATUS: &str = "claude-status";
const ID_CLAUDE_TOGGLE: &str = "claude-toggle";
const ID_QUIT: &str = "quit";

const LABEL_START: &str = "Démarrer l'enregistrement";
const LABEL_STOP: &str = "Arrêter l'enregistrement";

/// Éléments du menu mis à jour selon l'état (gardés dans l'état géré de Tauri).
pub struct TrayMenu {
    status: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    island: CheckMenuItem<Wry>,
    focus: CheckMenuItem<Wry>,
    music: CheckMenuItem<Wry>,
    deployments: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    update_status: MenuItem<Wry>,
    update_check: MenuItem<Wry>,
    claude_status: MenuItem<Wry>,
    claude_toggle: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let open = MenuItem::with_id(app, ID_OPEN, "Ouvrir Sordulo OS", true, None::<&str>)?;
    let status = MenuItem::with_id(app, ID_STATUS, "Micro : inactif", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, LABEL_START, true, None::<&str>)?;
    let island = CheckMenuItem::with_id(
        app,
        ID_ISLAND,
        "Afficher l'île",
        true,
        !island_window::is_hidden(),
        None::<&str>,
    )?;
    let island_top = MenuItem::with_id(
        app,
        ID_ISLAND_TOP,
        "Replacer l'île en haut",
        true,
        None::<&str>,
    )?;
    let focus = CheckMenuItem::with_id(
        app,
        ID_FOCUS,
        "Mode concentration",
        true,
        false,
        None::<&str>,
    )?;
    let music_on = app.state::<DesktopState>().shared().music_enabled;
    let music = CheckMenuItem::with_id(
        app,
        ID_MUSIC,
        "Afficher la musique dans l'île",
        true,
        music_on,
        None::<&str>,
    )?;
    let deployments_on = app.state::<DesktopState>().shared().deployments_enabled;
    let deployments = CheckMenuItem::with_id(
        app,
        ID_DEPLOYMENTS,
        "Afficher les déploiements dans l'île",
        true,
        deployments_on,
        None::<&str>,
    )?;
    // En dev, la case est grisée : seule la version installée peut se relancer seule (voir autostart).
    let autostart = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        if autostart::available() {
            "Lancer au démarrage"
        } else {
            "Lancer au démarrage (version installée)"
        },
        autostart::available(),
        autostart::is_enabled(app),
        None::<&str>,
    )?;
    // Ligne grisée « Version 0.2.0 · à jour » et vérification immédiate (grisée en dev).
    let (update_text, update_check_text, update_check_enabled) = updater::menu_texts(app);
    let update_status =
        MenuItem::with_id(app, ID_UPDATE_STATUS, update_text, false, None::<&str>)?;
    let update_check = MenuItem::with_id(
        app,
        ID_UPDATE_CHECK,
        update_check_text,
        update_check_enabled,
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
            &island,
            &island_top,
            &focus,
            &music,
            &deployments,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &update_status,
            &update_check,
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
        island,
        focus,
        music,
        deployments,
        autostart,
        update_status,
        update_check,
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
        ID_ISLAND => set_island_visible(app, island_window::is_hidden()),
        ID_ISLAND_TOP => {
            // En haut de l'écran principal avec le ressort, et réaffichée si elle était masquée.
            island_window::request_top();
            set_island_visible(app, true);
        }
        ID_FOCUS => {
            let on = !app.state::<DesktopState>().shared().focus_mode;
            set_focus_mode(app, on);
        }
        ID_MUSIC => {
            let on = !app.state::<DesktopState>().shared().music_enabled;
            set_music_enabled(app, on);
        }
        ID_DEPLOYMENTS => {
            let on = !app.state::<DesktopState>().shared().deployments_enabled;
            set_deployments_enabled(app, on);
        }
        ID_AUTOSTART => {
            let on = autostart::set_enabled(app, !autostart::is_enabled(app));
            // Resynchronise la case : le menu l'a déjà basculée, même si le système a refusé.
            if let Some(menu) = app.try_state::<TrayMenu>() {
                if let Err(e) = menu.autostart.set_checked(on) {
                    log::warn!("menu (lancement au démarrage) : {e}");
                }
            }
        }
        ID_UPDATE_CHECK => updater::menu_action(app),
        ID_CLAUDE_TOGGLE => claude::toggle_connection(app),
        ID_QUIT => {
            log::info!("« Quitter » depuis la zone de notification");
            recording::stop_before_exit(app);
            app.exit(0);
        }
        _ => {}
    }
}

/// Affiche ou masque l'île (choix mémorisé, voir `island_window::set_hidden`) et resynchronise la case.
pub fn set_island_visible(app: &AppHandle, visible: bool) {
    if island_window::is_hidden() == visible {
        island_window::set_hidden(app, !visible);
    }
    // Toujours resynchroniser la case : le menu l'a peut-être déjà basculée lui-même au clic.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        if let Err(e) = menu.island.set_checked(visible) {
            log::warn!("menu (île) : {e}");
        }
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

/// Affiche ou masque la musique dans l'île : état partagé, case du menu ; masquée = `null` émis une fois à
/// l'île et plus aucun sondage du lecteur (voir `music.rs`). Non mémorisé, comme le mode concentration.
fn set_music_enabled(app: &AppHandle, on: bool) {
    let state = app.state::<DesktopState>();
    let changed = {
        let mut shared = state.shared();
        let changed = shared.music_enabled != on;
        shared.music_enabled = on;
        changed
    };
    // Toujours resynchroniser la case : le menu l'a peut-être déjà basculée lui-même au clic.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        if let Err(e) = menu.music.set_checked(on) {
            log::warn!("menu (musique) : {e}");
        }
    }
    if changed {
        log::info!(
            "musique dans l'île {}",
            if on { "affichée" } else { "masquée" }
        );
        if !on {
            music::clear(app);
        }
    }
}

/// Affiche ou masque les déploiements dans l'île : état partagé, case du menu, puis
/// `desktop://deployments-enabled` à l'île seulement si la valeur change. Non mémorisé, comme la musique.
fn set_deployments_enabled(app: &AppHandle, on: bool) {
    let state = app.state::<DesktopState>();
    let changed = {
        let mut shared = state.shared();
        let changed = shared.deployments_enabled != on;
        shared.deployments_enabled = on;
        changed
    };
    // Toujours resynchroniser la case : le menu l'a peut-être déjà basculée lui-même au clic.
    if let Some(menu) = app.try_state::<TrayMenu>() {
        if let Err(e) = menu.deployments.set_checked(on) {
            log::warn!("menu (déploiements) : {e}");
        }
    }
    if changed {
        log::info!(
            "déploiements dans l'île {}",
            if on { "affichés" } else { "masqués" }
        );
        let payload = DeploymentsEnabledState { on };
        if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_DEPLOYMENTS_ENABLED, payload) {
            log::warn!("émission de {EVENT_DEPLOYMENTS_ENABLED} impossible : {e}");
        }
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

/// Met à jour la ligne de version / mise à jour et « Rechercher une mise à jour » (voir `updater`).
pub fn refresh_update(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let (status, check, enabled) = updater::menu_texts(app);
    if let Err(e) = menu.update_status.set_text(status) {
        log::warn!("menu (mise à jour) : {e}");
    }
    if let Err(e) = menu
        .update_check
        .set_text(check)
        .and_then(|_| menu.update_check.set_enabled(enabled))
    {
        log::warn!("menu (mise à jour) : {e}");
    }
}
