//! État partagé de l'app bureau et types échangés avec le front.
//!
//! Les types sérialisés reflètent exactement `src/shared/desktop-contract.ts` (camelCase).
//!
//! Verrous : `shared` (métadonnées) et `recorder` (enregistreur). Seul `start_recording` tient les deux
//! en même temps, toujours dans l'ordre `shared` puis `recorder`. L'arrêt relâche `shared` avant de
//! prendre `recorder` (la finalisation du fichier peut durer), donc pas d'interblocage.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;

use crate::platform::{self, MicApp as PlatformMicApp, Recorder, RecordingInfo};
use crate::time::now_ms;

// ---------------------------------------------------------------------------
// Types du contrat IPC
// ---------------------------------------------------------------------------

/// `MicApp` du contrat. `platform::MicApp` n'a pas `rename_all = "camelCase"`, d'où cette copie.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicApp {
    pub id: String,
    pub display_name: String,
}

impl From<PlatformMicApp> for MicApp {
    fn from(app: PlatformMicApp) -> Self {
        Self {
            id: app.id,
            display_name: app.display_name,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicState {
    pub active: bool,
    pub apps: Vec<MicApp>,
}

impl MicState {
    /// État calculé à partir de la liste du détecteur (triée par id pour comparer sans faux changement).
    pub fn from_apps(apps: Vec<PlatformMicApp>) -> Self {
        let mut apps: Vec<MicApp> = apps.into_iter().map(MicApp::from).collect();
        apps.sort_by(|a, b| a.id.cmp(&b.id));
        apps.dedup_by(|a, b| a.id == b.id);
        Self {
            active: !apps.is_empty(),
            apps,
        }
    }

    /// Noms lisibles séparés par des virgules (« chrome.exe, Teams »).
    pub fn app_names(&self) -> String {
        self.apps
            .iter()
            .map(|a| a.display_name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingStatus {
    #[default]
    Idle,
    Recording,
    Stopping,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingState {
    pub status: RecordingStatus,
    pub project_id: Option<String>,
    pub title: Option<String>,
    /// Epoch Unix en ms.
    pub started_at: Option<u64>,
    pub elapsed_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    #[serde(flatten)]
    pub info: RecordingInfo,
    pub project_id: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub mic: MicState,
    pub recording: RecordingState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptReason {
    MicActive,
    MicInactive,
    ManualStart,
    ManualStop,
}

impl PromptReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MicActive => "mic-active",
            Self::MicInactive => "mic-inactive",
            Self::ManualStart => "manual-start",
            Self::ManualStop => "manual-stop",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPayload {
    pub reason: PromptReason,
    pub mic: MicState,
    pub recording: RecordingState,
}

// ---------------------------------------------------------------------------
// État interne
// ---------------------------------------------------------------------------

/// Enregistrement en cours (ou en cours d'arrêt).
#[derive(Debug, Clone)]
pub struct Session {
    pub status: RecordingStatus,
    pub project_id: String,
    pub title: Option<String>,
    pub started_at: u64,
    pub path: PathBuf,
}

#[derive(Debug, Default)]
pub struct Shared {
    /// `None` = idle.
    pub session: Option<Session>,
    /// Dernier état connu du micro (mis à jour par la boucle de détection).
    pub mic: MicState,
    /// L'utilisateur a écarté la proposition « mic-active » : rien de neuf tant que le micro reste actif.
    pub prompt_dismissed: bool,
    /// Lien de connexion reçu (`sordulo://auth…`), en attente de lecture par la fenêtre principale.
    pub pending_auth_url: Option<String>,
}

pub struct DesktopState {
    pub shared: Mutex<Shared>,
    pub recorder: Mutex<Box<dyn Recorder>>,
}

impl DesktopState {
    pub fn new() -> Self {
        Self {
            shared: Mutex::new(Shared::default()),
            recorder: Mutex::new(platform::recorder()),
        }
    }

    pub fn shared(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn recorder(&self) -> MutexGuard<'_, Box<dyn Recorder>> {
        self.recorder.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Secondes enregistrées : celles de l'enregistreur si son verrou est libre, sinon l'horloge murale
    /// (pendant un arrêt, l'enregistreur est occupé à finaliser le fichier).
    fn elapsed_secs(&self, session: &Session) -> u64 {
        let wall = now_ms().saturating_sub(session.started_at) / 1000;
        match self.recorder.try_lock() {
            Ok(recorder) if recorder.is_recording() => recorder.elapsed_secs().max(0.0) as u64,
            _ => wall,
        }
    }

    /// `RecordingState` à partir d'une session (à appeler SANS tenir le verrou `recorder`).
    pub fn recording_state_of(&self, session: Option<&Session>) -> RecordingState {
        match session {
            None => RecordingState::default(),
            Some(s) => RecordingState {
                status: s.status,
                project_id: Some(s.project_id.clone()),
                title: s.title.clone(),
                started_at: Some(s.started_at),
                elapsed_secs: self.elapsed_secs(s),
            },
        }
    }

    pub fn recording_state(&self) -> RecordingState {
        let session = self.shared().session.clone();
        self.recording_state_of(session.as_ref())
    }

    pub fn status(&self) -> DesktopStatus {
        let (mic, session) = {
            let shared = self.shared();
            (shared.mic.clone(), shared.session.clone())
        };
        DesktopStatus {
            mic,
            recording: self.recording_state_of(session.as_ref()),
        }
    }

    pub fn prompt_payload(&self, reason: PromptReason) -> PromptPayload {
        let status = self.status();
        PromptPayload {
            reason,
            mic: status.mic,
            recording: status.recording,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_like_the_ts_contract() {
        let mic = MicState::from_apps(vec![PlatformMicApp {
            id: "chrome".into(),
            display_name: "chrome.exe".into(),
        }]);
        let payload = PromptPayload {
            reason: PromptReason::MicActive,
            mic,
            recording: RecordingState::default(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["reason"], "mic-active");
        assert_eq!(json["mic"]["active"], true);
        assert_eq!(json["mic"]["apps"][0]["displayName"], "chrome.exe");
        assert_eq!(json["recording"]["status"], "idle");
        assert!(json["recording"]["projectId"].is_null());
        assert!(json["recording"]["startedAt"].is_null());
        assert_eq!(json["recording"]["elapsedSecs"], 0);

        let result = RecordingResult {
            info: RecordingInfo {
                path: PathBuf::from("a.mp3"),
                duration_secs: 1.5,
                size_bytes: 10,
                mime_type: "audio/mpeg".into(),
            },
            project_id: "p".into(),
            title: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        for key in [
            "path",
            "durationSecs",
            "sizeBytes",
            "mimeType",
            "projectId",
            "title",
        ] {
            assert!(json.get(key).is_some(), "champ manquant : {key}");
        }
    }

    #[test]
    fn mic_state_sorted_and_deduped() {
        let a = MicState::from_apps(vec![
            PlatformMicApp {
                id: "b".into(),
                display_name: "B".into(),
            },
            PlatformMicApp {
                id: "a".into(),
                display_name: "A".into(),
            },
            PlatformMicApp {
                id: "a".into(),
                display_name: "A".into(),
            },
        ]);
        assert_eq!(a.app_names(), "A, B");
        assert!(a.active);
        assert!(!MicState::from_apps(vec![]).active);
    }
}
