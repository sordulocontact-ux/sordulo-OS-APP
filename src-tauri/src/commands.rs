//! Commandes IPC : noms et arguments exactement comme `DESKTOP_COMMANDS` (arguments camelCase côté front,
//! convertis par Tauri en snake_case ici). Toutes les erreurs remontent en `String`, en français.

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use crate::claude::{self, ClaudeConnection, ClaudeDecision};
use crate::dropped;
use crate::events::{WINDOW_MAIN, WINDOW_PROMPT};
use crate::music::{self, MusicState};
use crate::platform::MediaCommand;
use crate::recording;
use crate::spotify::{self, SpotifyStatus};
use crate::state::{
    DesktopState, DesktopStatus, FocusModeState, IslandHitRects, IslandRect, PromptReason,
    RecordingResult, RecordingState, UpdateStatus,
};
use crate::tray;
use crate::updater;
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

/// Copie dans `app_local_data_dir()/drops` le fichier déposé sur l'île et renvoie son chemin absolu (voir
/// `dropped.rs` : 50 Mo maximum, nom assaini, copies de plus de 7 jours supprimées). Corps brut = octets du
/// fichier, en-tête `x-file-name` = nom d'origine encodé en URI. Réservé à la fenêtre de l'île.
#[tauri::command]
pub async fn save_dropped_file(
    window: tauri::WebviewWindow,
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    dropped::check_window(window.label())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le contenu du fichier est manquant.".into());
    };
    dropped::check_size(bytes.len())?;
    let raw_name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .map(dropped::decode_file_name)
        .unwrap_or_default();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Dossier de l'application introuvable : {e}"))?
        .join("drops");
    let path = dropped::save_dropped_file(&dir, &raw_name, bytes, std::time::SystemTime::now())?;
    Ok(path.to_string_lossy().into_owned())
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

/// Morceau en cours (dernier état émis par `desktop://music`), `null` si rien ou si la musique est masquée.
#[tauri::command]
pub fn get_music(app: AppHandle) -> Option<MusicState> {
    music::current(&app)
}

/// Octets bruts (PNG ou JPEG) de la pochette `artworkId`. Erreur si ce n'est plus la pochette courante
/// (le morceau a changé entre-temps).
#[tauri::command]
pub async fn get_music_artwork(app: AppHandle, artwork_id: String) -> Result<Response, String> {
    let bytes = music::artwork(&app, &artwork_id)?;
    Ok(Response::new(bytes.to_vec()))
}

/// Précédent, lecture / pause, suivant, ou lecteur au premier plan. Réservé à la fenêtre de l'île.
/// Asynchrone : la commande au lecteur peut prendre quelques centaines de ms. L'île montre Spotify sur un
/// autre appareil : la commande part à l'API Web de Spotify (client bloquant, d'où `spawn_blocking`).
#[tauri::command]
pub async fn music_command(
    window: tauri::WebviewWindow,
    app: AppHandle,
    command: MediaCommand,
) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule l'île peut commander le lecteur de musique.".into());
    }
    if !app.state::<DesktopState>().shared().music_enabled {
        return Err("La musique est masquée dans le menu de Sordulo OS.".into());
    }
    let shows_spotify = music::current(&app).is_some_and(|m| m.app_id == spotify::APP_ID);
    if shows_spotify {
        return tauri::async_runtime::spawn_blocking(move || spotify::command(&app, command))
            .await
            .map_err(|e| format!("Commande Spotify interrompue : {e}"))?;
    }
    // Bloquant aussi : sur Mac, afficher l'onglet du navigateur qui joue passe par AppleScript (jusqu'à 20 s
    // si macOS demande l'autorisation « Automatisation »).
    tauri::async_runtime::spawn_blocking(move || crate::platform::media_command(command))
        .await
        .map_err(|e| format!("Commande du lecteur interrompue : {e}"))?
        .map_err(|e| format!("Commande du lecteur impossible : {e:#}"))
}

/// État de la connexion Spotify (page Connecteurs).
#[tauri::command]
pub fn spotify_status(app: AppHandle) -> SpotifyStatus {
    spotify::status(&app)
}

/// Connecte un compte Spotify : ouvre la page d'autorisation dans le navigateur par défaut et attend la
/// redirection (3 min au plus). Réservé à la fenêtre principale. Bloquant (serveur local, HTTP) : tourne
/// dans `spawn_blocking`, jamais sur un thread async.
#[tauri::command]
pub async fn spotify_connect(
    window: tauri::WebviewWindow,
    app: AppHandle,
    client_id: String,
) -> Result<SpotifyStatus, String> {
    if window.label() != WINDOW_MAIN {
        return Err("Seule la fenêtre principale peut connecter Spotify.".into());
    }
    tauri::async_runtime::spawn_blocking(move || spotify::connect(&app, &client_id))
        .await
        .map_err(|e| format!("Connexion à Spotify interrompue : {e}"))?
}

/// Déconnecte le compte Spotify (jetons oubliés, fichier supprimé). Réservé à la fenêtre principale.
#[tauri::command]
pub fn spotify_disconnect(
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<SpotifyStatus, String> {
    if window.label() != WINDOW_MAIN {
        return Err("Seule la fenêtre principale peut déconnecter Spotify.".into());
    }
    Ok(spotify::disconnect(&app))
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

/// Clic sur une session Claude ou sa notification dans l'île : met au premier plan la fenêtre VS Code
/// (ou l'app) où elle tourne, sur son dossier. Réservé à la fenêtre de l'île. Asynchrone : le lancement
/// de l'éditeur ne bloque pas le thread principal.
#[tauri::command]
pub async fn claude_open_session(
    window: tauri::WebviewWindow,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule l'île peut ouvrir une session.".into());
    }
    claude::open_session(&app, &session_id)
}

/// Réponse de l'île à un PermissionRequest en attente. Réservé à la fenêtre de l'île.
#[tauri::command]
pub fn claude_answer(
    window: tauri::WebviewWindow,
    app: AppHandle,
    request_id: String,
    decision: ClaudeDecision,
    // Questions à choix (AskUserQuestion) : texte de la question → choix (plusieurs : « A, B »).
    answers: Option<std::collections::BTreeMap<String, String>>,
) -> Result<(), String> {
    if window.label() != WINDOW_PROMPT {
        return Err("Seule l'île peut répondre à une demande d'autorisation.".into());
    }
    claude::answer(&app, &request_id, decision, answers)
}

/// État des mises à jour automatiques (`disabled` en dev).
#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateStatus {
    updater::status(&app)
}

/// Paramètres > Application de bureau : vérifie et télécharge la dernière version, sans l'installer
/// (réseau sur un thread bloquant). Refusé en dev.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateStatus, String> {
    tauri::async_runtime::spawn_blocking(move || updater::check_now(&app))
        .await
        .map_err(|e| format!("Recherche de mise à jour impossible : {e}"))?
}

/// Vérifie, télécharge et installe la dernière version tout de suite, même fenêtre ouverte (l'app
/// redémarre). Refusé pendant un enregistrement. Le travail (réseau, installation) tourne sur un
/// thread bloquant : l'installation macOS peut demander le thread principal.
#[tauri::command]
pub async fn install_update_now(app: AppHandle) -> Result<UpdateStatus, String> {
    tauri::async_runtime::spawn_blocking(move || updater::install_now(&app))
        .await
        .map_err(|e| format!("Mise à jour impossible : {e}"))?
}
