//! Commandes IPC : noms et arguments exactement comme `DESKTOP_COMMANDS` (arguments camelCase côté front,
//! convertis par Tauri en snake_case ici). Toutes les erreurs remontent en `String`, en français.

use tauri::ipc::Response;
use tauri::{AppHandle, State};

use crate::recording;
use crate::state::{DesktopState, DesktopStatus, PromptReason, RecordingResult, RecordingState};
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

#[tauri::command]
pub fn dismiss_prompt(app: AppHandle, state: State<'_, DesktopState>) -> Result<(), String> {
    {
        let mut shared = state.shared();
        // Écartée jusqu'à ce que le micro redevienne inactif ; si le micro est déjà inactif,
        // rien à retenir (sinon la prochaine activation serait ignorée).
        shared.prompt_dismissed = shared.mic.active;
    }
    windows_mgmt::hide_prompt(&app).map_err(|e| format!("Impossible de cacher la fenêtre : {e}"))
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
