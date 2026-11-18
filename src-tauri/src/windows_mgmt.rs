//! Fenêtres : `main` (déclarée dans tauri.conf.json) et `prompt` (créée ici, cachée, au démarrage).

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Wry,
};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::events::{EVENT_PROMPT, PROMPT_ROUTE, WINDOW_MAIN, WINDOW_PROMPT};
use crate::state::{DesktopState, PromptReason};

/// Taille de la fenêtre prompt (pixels logiques) : une barre horizontale, sans défilement.
const PROMPT_WIDTH: f64 = 620.0;
const PROMPT_HEIGHT: f64 = 64.0;
/// Marge avec le haut de l'écran.
const SCREEN_MARGIN: i32 = 12;

/// Crée la fenêtre prompt, cachée. Appelé une fois dans `setup`.
pub fn create_prompt_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, WINDOW_PROMPT, WebviewUrl::App(PROMPT_ROUTE.into()))
        .title("Sordulo OS")
        .inner_size(PROMPT_WIDTH, PROMPT_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .shadow(true)
        .build()
}

/// Montre et focalise la fenêtre principale.
pub fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_MAIN) else {
        log::warn!("fenêtre {WINDOW_MAIN} introuvable");
        return;
    };
    if let Err(e) = window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
    {
        log::warn!("impossible d'afficher la fenêtre principale : {e}");
    }
}

/// Cache la fenêtre prompt.
pub fn hide_prompt(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview_window(WINDOW_PROMPT) {
        Some(window) => window.hide(),
        None => Ok(()),
    }
}

/// Émet `desktop://prompt` vers la fenêtre prompt, la place près de la zone de notification et la montre.
///
/// `focus = false` : la fenêtre apparaît sans prendre le focus (l'utilisateur est dans son appel).
pub fn show_prompt(app: &AppHandle, reason: PromptReason, focus: bool) {
    let Some(window) = app.get_webview_window(WINDOW_PROMPT) else {
        log::warn!("fenêtre {WINDOW_PROMPT} introuvable");
        return;
    };
    let payload = app.state::<DesktopState>().prompt_payload(reason);
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_PROMPT, &payload) {
        log::warn!("émission de {EVENT_PROMPT} impossible : {e}");
    }
    place_top_center(&window);

    let shown = if focus {
        window.show().and_then(|_| window.set_focus())
    } else {
        // Le temps de l'affichage, la fenêtre n'est pas activable (WS_EX_NOACTIVATE sous Windows) :
        // elle apparaît au-dessus sans voler le focus, puis redevient cliquable normalement.
        let _ = window.set_focusable(false);
        let shown = window.show();
        let _ = window.set_focusable(true);
        shown
    };
    match shown {
        Ok(()) => log::info!("fenêtre prompt affichée (raison {})", reason.as_str()),
        Err(e) => log::warn!("impossible d'afficher la fenêtre prompt : {e}"),
    }
}

/// En haut au centre de la zone de travail de l'écran principal (hors barre des tâches).
fn place_top_center(window: &WebviewWindow<Wry>) {
    if let Err(e) = place_top_center_of_work_area(window) {
        log::debug!("position en haut au centre impossible ({e}), repli du positioner");
        if let Err(e) = window.move_window(Position::TopCenter) {
            log::warn!("impossible de placer la fenêtre prompt : {e}");
        }
    }
}

fn place_top_center_of_work_area(window: &WebviewWindow<Wry>) -> tauri::Result<()> {
    let monitor = window
        .primary_monitor()?
        .or(window.current_monitor()?)
        .ok_or_else(|| tauri::Error::Io(std::io::Error::other("aucun écran détecté")))?;
    let area = monitor.work_area();
    let size = window.outer_size()?;
    let margin = (f64::from(SCREEN_MARGIN) * monitor.scale_factor()).round() as i32;
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + margin;
    window.set_position(PhysicalPosition::new(x, y))
}
