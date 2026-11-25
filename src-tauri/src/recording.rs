//! Cycle d'un enregistrement (démarrer, arrêter, marquer un moment) et contrôle des chemins du dossier
//! `recordings`. Utilisé par les commandes IPC, le raccourci de repère (`marker_shortcut.rs`) et le menu de
//! la zone de notification (« Quitter »).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use crate::events::{EVENT_RECORDING_MARKERS, EVENT_RECORDING_STATE};
use crate::marker_shortcut;
use crate::markers::{self, Outcome};
use crate::platform::RECORDING_EXTENSION;
use crate::state::{
    DesktopState, RecordingMarkers, RecordingResult, RecordingState, RecordingStatus, Session, Shared,
};
use crate::time::{file_timestamp, now_ms};
use crate::tray;

/// `app_local_data_dir()/recordings`, créé si besoin.
pub fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Dossier de données de l'application introuvable : {e}"))?
        .join("recordings");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Impossible de créer le dossier des enregistrements : {e}"))?;
    Ok(dir)
}

/// Émet `desktop://recording-state` à toutes les fenêtres et met à jour le menu.
pub fn broadcast(app: &AppHandle) {
    let state = app.state::<DesktopState>().recording_state();
    if let Err(e) = app.emit(EVENT_RECORDING_STATE, &state) {
        log::warn!("émission de {EVENT_RECORDING_STATE} impossible : {e}");
    }
    tray::refresh(app);
}

pub fn start(
    app: &AppHandle,
    project_id: String,
    title: Option<String>,
) -> Result<RecordingState, String> {
    let project_id = project_id.trim().to_string();
    if project_id.is_empty() {
        return Err("Choisissez un projet avant de démarrer l'enregistrement.".into());
    }
    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let dir = recordings_dir(app)?;
    let started_at = now_ms();
    let path = dir.join(format!(
        "{}.{RECORDING_EXTENSION}",
        file_timestamp(started_at)
    ));

    let state = app.state::<DesktopState>();
    {
        // Ordre des verrous : shared puis recorder (voir state.rs).
        let mut shared = state.shared();
        if let Some(session) = &shared.session {
            return Err(match session.status {
                RecordingStatus::Stopping => {
                    "Un enregistrement est en cours d'arrêt, réessayez dans un instant.".into()
                }
                _ => "Un enregistrement est déjà en cours.".into(),
            });
        }
        state
            .recorder()
            .start(&path)
            .map_err(|e| format!("Impossible de démarrer l'enregistrement : {e:#}"))?;
        shared.session = Some(Session {
            status: RecordingStatus::Recording,
            project_id,
            title,
            started_at,
            path: path.clone(),
            markers: Vec::new(),
        });
    }
    log::info!("enregistrement démarré : {}", path.display());
    // Verrou `shared` relâché : sur macOS, l'enregistrement du raccourci passe par le thread principal.
    marker_shortcut::register(app);
    broadcast(app);
    Ok(state.recording_state())
}

pub fn stop(app: &AppHandle) -> Result<RecordingResult, String> {
    let state = app.state::<DesktopState>();
    let session = {
        let mut shared = state.shared();
        match shared.session.as_mut() {
            None => return Err("Aucun enregistrement en cours.".into()),
            Some(s) if s.status == RecordingStatus::Stopping => {
                return Err("L'enregistrement est déjà en cours d'arrêt.".into())
            }
            Some(s) => {
                s.status = RecordingStatus::Stopping;
                s.clone()
            }
        }
    };
    marker_shortcut::unregister(app);
    broadcast(app);

    // Verrou `shared` relâché : la finalisation du fichier peut prendre un moment.
    let result = state.recorder().stop();
    state.shared().session = None;
    broadcast(app);

    match result {
        Ok(info) => {
            log::info!(
                "enregistrement arrêté : {} ({:.0} s, {} octets)",
                info.path.display(),
                info.duration_secs,
                info.size_bytes
            );
            Ok(RecordingResult {
                info,
                project_id: session.project_id,
                title: session.title,
                markers: markers::for_result(&session.markers),
            })
        }
        Err(e) => {
            log::error!(
                "échec de l'arrêt de l'enregistrement {} : {e:#}",
                session.path.display()
            );
            Err(format!("Échec de l'arrêt de l'enregistrement : {e:#}"))
        }
    }
}

/// Session en cours d'enregistrement (pas en cours d'arrêt), pour poser ou retirer un repère.
fn recording_session<'a>(shared: &'a mut Shared, action: &str) -> Result<&'a mut Session, String> {
    match shared.session.as_mut() {
        Some(s) if s.status == RecordingStatus::Recording => Ok(s),
        Some(_) => Err(format!("L'enregistrement s'arrête : impossible de {action}.")),
        None => Err(format!("Aucun enregistrement en cours : impossible de {action}.")),
    }
}

/// Émet `desktop://recording-markers` à toutes les fenêtres, puis l'état (compteur `markerCount`).
fn broadcast_markers(app: &AppHandle, markers: &RecordingMarkers) {
    if let Err(e) = app.emit(EVENT_RECORDING_MARKERS, markers) {
        log::warn!("émission de {EVENT_RECORDING_MARKERS} impossible : {e}");
    }
    broadcast(app);
}

/// Marque un moment à la position actuelle de l'enregistrement (raccourci global ou bouton « Marquer »).
/// Un appui à moins d'une seconde d'un repère, ou au-delà de 100 repères, est ignoré : réponse avec
/// `added: false`, sans événement.
pub fn add_marker(app: &AppHandle) -> Result<RecordingMarkers, String> {
    let state = app.state::<DesktopState>();
    let (outcome, summary) = {
        let mut shared = state.shared();
        let session = recording_session(&mut shared, "marquer un moment")?;
        // Ordre des verrous : shared puis recorder (voir state.rs). Position dans le MP3.
        let at = state.recorder().elapsed_secs();
        let outcome = markers::add(&mut session.markers, at);
        let summary = markers::summary(&session.markers, outcome == Outcome::Added);
        (outcome, summary)
    };
    match outcome {
        Outcome::Added => {
            log::info!(
                "moment marqué à {:.1} s ({} repère(s))",
                summary.last_at_secs.unwrap_or_default(),
                summary.count
            );
            broadcast_markers(app, &summary);
        }
        Outcome::TooClose => log::debug!("repère ignoré : moins d'une seconde après un autre"),
        Outcome::Full => log::warn!("repère ignoré : {} repères au plus", markers::MAX_MARKERS),
    }
    Ok(summary)
}

/// Retire le repère le plus récent (« Annuler » de l'île). Sans repère : réponse inchangée, sans événement.
pub fn remove_last_marker(app: &AppHandle) -> Result<RecordingMarkers, String> {
    let state = app.state::<DesktopState>();
    let (removed, summary) = {
        let mut shared = state.shared();
        let session = recording_session(&mut shared, "retirer un repère")?;
        let removed = markers::remove_last(&mut session.markers);
        (removed, markers::summary(&session.markers, false))
    };
    if removed {
        log::info!("dernier repère retiré ({} repère(s))", summary.count);
        broadcast_markers(app, &summary);
    }
    Ok(summary)
}

/// Arrête proprement un enregistrement en cours avant de quitter. Le fichier reste sur le disque.
pub fn stop_before_exit(app: &AppHandle) {
    let recording = app.state::<DesktopState>().shared().session.is_some();
    if !recording {
        return;
    }
    match stop(app) {
        Ok(result) => log::info!(
            "enregistrement conservé avant de quitter : {}",
            result.info.path.display()
        ),
        Err(e) => log::error!("arrêt avant de quitter : {e}"),
    }
}

/// Chemin d'un fichier du dossier `recordings`. Refuse tout autre chemin (canonicalize + starts_with).
pub fn checked_recording_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = recordings_dir(app)?;
    let dir = dir
        .canonicalize()
        .map_err(|e| format!("Dossier des enregistrements inaccessible : {e}"))?;
    check_inside(&dir, Path::new(path))
}

fn check_inside(dir: &Path, path: &Path) -> Result<PathBuf, String> {
    const REFUSED: &str =
        "Chemin refusé : le fichier doit se trouver dans le dossier des enregistrements.";
    let file = path
        .canonicalize()
        .map_err(|_| "Enregistrement introuvable.".to_string())?;
    if !file.starts_with(dir) || file == dir || !file.is_file() {
        return Err(REFUSED.into());
    }
    let ext_ok = file
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(RECORDING_EXTENSION));
    if !ext_ok {
        return Err(REFUSED.into());
    }
    Ok(file)
}

/// Vrai si `path` (canonique) est le fichier en cours d'écriture.
pub fn is_active_file(app: &AppHandle, path: &Path) -> bool {
    let state = app.state::<DesktopState>();
    let shared = state.shared();
    shared
        .session
        .as_ref()
        .and_then(|s| s.path.canonicalize().ok())
        .is_some_and(|active| active == path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_paths_outside_recordings() {
        let root = std::env::temp_dir().join(format!("sordulo-test-{}", now_ms()));
        let dir = root.join("recordings");
        std::fs::create_dir_all(&dir).unwrap();
        let inside = dir.join("a.mp3");
        let outside = root.join("b.mp3");
        let wrong_ext = dir.join("c.txt");
        for f in [&inside, &outside, &wrong_ext] {
            std::fs::write(f, b"x").unwrap();
        }
        let dir = dir.canonicalize().unwrap();

        assert!(check_inside(&dir, &inside).is_ok());
        assert!(check_inside(&dir, &outside).is_err());
        assert!(check_inside(&dir, &wrong_ext).is_err());
        assert!(check_inside(&dir, &dir.join("..").join("b.mp3")).is_err());
        assert!(check_inside(&dir, &dir).is_err());
        assert!(check_inside(&dir, &dir.join("absent.mp3")).is_err());

        std::fs::remove_dir_all(&root).unwrap();
    }
}
