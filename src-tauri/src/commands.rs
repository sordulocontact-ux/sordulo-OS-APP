//! Commandes IPC : noms et arguments exactement comme `DESKTOP_COMMANDS` (arguments camelCase côté front,
//! convertis par Tauri en snake_case ici). Toutes les erreurs remontent en `String`, en français.

use tauri::ipc::Response;
use tauri::{AppHandle, State};

use crate::claude::{self, ClaudeConnection, ClaudeDecision};
use crate::dropped;
use crate::events::WINDOW_PROMPT;
use crate::recording;
use crate::state::{
    DesktopState, DesktopStatus, FocusModeState, IslandHitRects, IslandRect, PromptReason,
    RecordingResult, RecordingState,
};
use crate::tray;
use crate::windows_mgmt;

#[tauri::command]
pub fn get_status(state: State<'_, DesktopState>) -> DesktopStatus {
    state.status()
}

// Les commandes `async` tournent hors du thread principal : démarrer/arrêter la capture peut prendre
// un moment sans figer l'interface.

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    project_id: String,
    title: Option<String>,
) -> Result<RecordingState, String> {
    recording::start(&app, project_id, title)
}

#[tauri::command]
pub async fn stop_recording(app: AppHandle) -> Result<RecordingResult, String> {
    recording::stop(&app)
}

#[tauri::command]
pub async fn read_recording(app: AppHandle, path: String) -> Result<Response, String> {
    let file = recording::checked_recording_path(&app, &path)?;
    if recording::is_active_file(&app, &file) {
        return Err("Cet enregistrement est encore en cours.".into());
    }
    let bytes =
        std::fs::read(&file).map_err(|e| format!("Impossible de lire l'enregistrement : {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn delete_recording(app: AppHandle, path: String) -> Result<(), String> {
    let file = recording::checked_recording_path(&app, &path)?;
    if recording::is_active_file(&app, &file) {
        return Err("Impossible de supprimer un enregistrement en cours.".into());
    }
    std::fs::remove_file(&file)
        .map_err(|e| format!("Impossible de supprimer l'enregistrement : {e}"))?;
    log::info!("enregistrement supprimé : {}", file.display());
    Ok(())
}

/// La proposition est écartée ; l'île n'est plus cachée (c'est le front qui la ramène au repos).
#[tauri::command]
pub fn dismiss_prompt(state: State<'_, DesktopState>) {
    let mut shared = state.shared();
    // Écartée jusqu'à ce que le micro redevienne inactif ; si le micro est déjà inactif,
    // rien à retenir (sinon la prochaine activation serait ignorée).
    shared.prompt_dismissed = shared.mic.active;
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    windows_mgmt::show_main(&app);
}

#[tauri::command]
pub fn open_prompt(app: AppHandle, reason: String) -> Result<(), String> {
    if reason != PromptReason::ManualStart.as_str() {
        return Err(format!(
            "Raison « {reason} » refusée : seule « manual-start » est acceptée."
        ));
    }
    windows_mgmt::show_prompt(&app, PromptReason::ManualStart, true);
    Ok(())
}

/// Lien de connexion reçu (`sordulo://auth…`), rendu une seule fois. Réservé à la fenêtre principale.
#[tauri::command]
pub fn take_auth_callback(
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Option<String> {
    if window.label() != crate::events::WINDOW_MAIN {
        return None;
    }
    state.shared().pending_auth_url.take()
}

/// Zones cliquables de l'île (px CSS relatifs à sa fenêtre). Réservé à la fenêtre de l'île.
#[tauri::command]
pub fn island_set_hit_rects(
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
    rects: Vec<IslandRect>,
    drag_margin: f64,
) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule la fenêtre de l'île peut envoyer ses zones cliquables.".into());
    }
    *state.island_hits() = IslandHitRects::sanitized(rects, drag_margin);
    Ok(())
}

/// Octets d'un fichier audio déposé sur l'île (voir `dropped.rs` : extension audio, 500 Mo maximum).
/// Réservé à la fenêtre de l'île.
#[tauri::command]
pub async fn read_dropped_audio(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<Response, String> {
    dropped::check_window(window.label())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || dropped::read_dropped_audio(&path))
        .await
        .map_err(|e| format!("Impossible de lire ce fichier : {e}"))??;
    Ok(Response::new(bytes))
}

/// Texte maximal copiable : un chemin Windows tient dans 32 767 caractères.
const COPY_TEXT_MAX_CHARS: usize = 32_768;

/// Copie un texte dans le presse-papiers du système (le dépôt sur « Claude Code » copie le chemin du
/// fichier). Réservé à la fenêtre de l'île.
#[tauri::command]
pub fn copy_text(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule la fenêtre de l'île peut copier dans le presse-papiers.".into());
    }
    if text.is_empty() || text.chars().count() > COPY_TEXT_MAX_CHARS {
        return Err("Ce texte ne peut pas être copié.".into());
    }
    crate::platform::copy_text(&text)
        .map_err(|e| format!("Impossible de copier dans le presse-papiers : {e}"))
}

#[tauri::command]
pub fn open_main_at(app: AppHandle, route: String) -> Result<(), String> {
    windows_mgmt::open_main_at(&app, route)
}

#[tauri::command]
pub fn get_focus_mode(state: State<'_, DesktopState>) -> FocusModeState {
    state.focus_mode()
}

/// Met aussi à jour la case du menu du soleil et prévient l'île.
#[tauri::command]
pub fn set_focus_mode(app: AppHandle, on: bool) -> FocusModeState {
    tray::set_focus_mode(&app, on)
}

/// État de la connexion Claude Code (settings.json relu).
#[tauri::command]
pub fn claude_get_connection(app: AppHandle) -> ClaudeConnection {
    claude::connection(&app)
}

/// Réponse de l'île à un PermissionRequest en attente. Réservé à la fenêtre de l'île.
#[tauri::command]
pub fn claude_answer(
    window: tauri::WebviewWindow,
    app: AppHandle,
    request_id: String,
    decision: ClaudeDecision,
) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule l'île peut répondre à une demande d'autorisation.".into());
    }
    claude::answer(&app, &request_id, decision)
}
