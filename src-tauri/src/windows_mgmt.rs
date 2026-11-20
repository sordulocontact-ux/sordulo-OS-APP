//! Fenêtres : `main` (déclarée dans tauri.conf.json) et `prompt`, l'île (créée et surveillée par
//! `island_window`, toujours visible).

use tauri::{AppHandle, Emitter, Manager};

use crate::events::{EVENT_NAVIGATE, EVENT_PROMPT, WINDOW_MAIN, WINDOW_PROMPT};
use crate::island_window;
use crate::state::{DesktopState, NavigatePayload, PromptReason};

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

/// Montre et focalise la fenêtre principale, puis lui demande d'aller à `route` (`desktop://navigate`).
pub fn open_main_at(app: &AppHandle, route: String) -> Result<(), String> {
    if !route.starts_with('/') {
        return Err(format!(
            "Route « {route} » refusée : elle doit commencer par « / »."
        ));
    }
    show_main(app);
    log::info!("fenêtre principale ouverte sur {route}");
    app.emit_to(WINDOW_MAIN, EVENT_NAVIGATE, NavigatePayload { route })
        .map_err(|e| format!("Impossible d'ouvrir la page demandée : {e}"))
}

/// Ne fait plus rien : l'île est toujours présente, elle n'est plus jamais cachée par l'app.
/// Gardée pour les appelants existants ; c'est le front qui ramène l'île au repos.
#[allow(dead_code)]
pub fn hide_prompt(app: &AppHandle) -> tauri::Result<()> {
    let _ = app;
    Ok(())
}

/// Émet `desktop://prompt` vers l'île et s'assure qu'elle est visible, sans la déplacer ni prendre le focus.
///
/// `focus` est ignoré : l'île ne vole jamais le focus (l'utilisateur est peut-être dans son appel) ;
/// un clic dans l'île lui donne le clavier.
pub fn show_prompt(app: &AppHandle, reason: PromptReason, focus: bool) {
    let _ = focus;
    let Some(window) = app.get_webview_window(WINDOW_PROMPT) else {
        log::warn!("fenêtre {WINDOW_PROMPT} introuvable");
        return;
    };
    let payload = app.state::<DesktopState>().prompt_payload(reason);
    match app.emit_to(WINDOW_PROMPT, EVENT_PROMPT, &payload) {
        Ok(()) => log::info!("proposition envoyée à l'île (raison {})", reason.as_str()),
        Err(e) => log::warn!("émission de {EVENT_PROMPT} impossible : {e}"),
    }
    island_window::ensure_visible(&window);
}
