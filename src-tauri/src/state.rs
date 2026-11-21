//! État partagé de l'app bureau et types échangés avec le front.
//!
//! Les types sérialisés reflètent exactement `src/shared/desktop-contract.ts` (camelCase).
//!
//! Verrous : `shared` (métadonnées), `recorder` (enregistreur), `island_hits` (zones cliquables de l'île,
//! lues ~60 fois par seconde, jamais pris avec un autre verrou) et `music` (dernier état de la musique et sa
//! pochette, voir `music.rs` : peut prendre `shared` ensuite, jamais l'inverse).
//! `shared` et `recorder` : seul `start_recording` tient les deux en même temps, toujours dans l'ordre
//! `shared` puis `recorder`. L'arrêt relâche `shared` avant de prendre `recorder` (la finalisation du
//! fichier peut durer), donc pas d'interblocage.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::call_apps::{self, CallService};
use crate::music::MusicHub;
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
    /// Nom du service d'appel s'il est reconnu (« Discord », « Google Meet »), sinon nom de l'app.
    pub display_name: String,
    /// Service d'appel reconnu (minuscules), `null` sinon : icône et couleur de l'île.
    pub service: Option<CallService>,
}

impl MicApp {
    /// `titles` : titres des fenêtres visibles, pour reconnaître le service d'un navigateur.
    fn recognized(app: PlatformMicApp, titles: &[String]) -> Self {
        let service = call_apps::recognize_service(&app.id, titles);
        Self {
            display_name: service.map_or(app.display_name, |s| s.display_name().to_owned()),
            id: app.id,
            service,
        }
    }
}

impl From<PlatformMicApp> for MicApp {
    fn from(app: PlatformMicApp) -> Self {
        Self::recognized(app, &[])
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
    #[cfg(test)]
    pub fn from_apps(apps: Vec<PlatformMicApp>) -> Self {
        Self::from_apps_with_titles(apps, &[])
    }

    /// Comme `from_apps`, avec les titres des fenêtres visibles pour reconnaître le service d'un navigateur.
    pub fn from_apps_with_titles(apps: Vec<PlatformMicApp>, titles: &[String]) -> Self {
        let mut apps: Vec<MicApp> = apps.into_iter().map(|a| MicApp::recognized(a, titles)).collect();
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

/// `IslandRect` du contrat : px CSS relatifs au coin haut-gauche de la fenêtre de l'île.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// `IslandHitRects` du contrat : formes noires de l'île + marge de réveil au glisser-déposer.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandHitRects {
    pub rects: Vec<IslandRect>,
    /// px CSS ; 0 désactive la marge.
    pub drag_margin: f64,
}

impl IslandHitRects {
    /// Écarte les valeurs inutilisables (non finies, tailles nulles ou négatives) envoyées par le front.
    pub fn sanitized(rects: Vec<IslandRect>, drag_margin: f64) -> Self {
        let finite = |v: f64| v.is_finite();
        Self {
            rects: rects
                .into_iter()
                .filter(|r| finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height))
                .filter(|r| r.width > 0.0 && r.height > 0.0)
                .collect(),
            drag_margin: if finite(drag_margin) {
                drag_margin.max(0.0)
            } else {
                0.0
            },
        }
    }
}

/// `IslandPointer` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct IslandPointer {
    pub inside: bool,
}

/// `FocusModeState` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FocusModeState {
    pub on: bool,
}

/// `NavigatePayload` du contrat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NavigatePayload {
    pub route: String,
}

/// `UpdateState` du contrat (voir `updater`) : `disabled` en dev, jamais de mise à jour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateState {
    Disabled,
    Idle,
    Checking,
    UpToDate,
    Downloading,
    Ready,
    Installing,
    Error,
}

/// `UpdateStatus` du contrat : état des mises à jour automatiques de la version installée.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// Version de l'app en cours d'exécution (« 0.2.0 »).
    pub current: String,
    pub state: UpdateState,
    /// Version plus récente trouvée sur le serveur des mises à jour, s'il y en a une.
    pub available: Option<String>,
    /// Message d'erreur en français quand `state` vaut `error`.
    pub message: Option<String>,
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
    /// Mode concentration (case du menu du soleil) : l'île garde les notifications pendant un appel.
    pub focus_mode: bool,
    /// Case « Afficher la musique dans l'île » du menu du soleil (cochée au démarrage). Décochée : plus
    /// aucun sondage du lecteur, l'île ne reçoit plus que `null`.
    pub music_enabled: bool,
}

pub struct DesktopState {
    pub shared: Mutex<Shared>,
    pub recorder: Mutex<Box<dyn Recorder>>,
    /// Zones cliquables envoyées par l'île (`island_set_hit_rects`).
    pub island_hits: Mutex<IslandHitRects>,
    /// Dernier état de la musique émis à l'île et sa pochette (`get_music`, `get_music_artwork`).
    pub music: Mutex<MusicHub>,
}

impl DesktopState {
    pub fn new() -> Self {
        Self {
            shared: Mutex::new(Shared {
                music_enabled: true,
                ..Shared::default()
            }),
            recorder: Mutex::new(platform::recorder()),
            island_hits: Mutex::new(IslandHitRects::default()),
            music: Mutex::new(MusicHub::default()),
        }
    }

    pub fn shared(&self) -> MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn island_hits(&self) -> MutexGuard<'_, IslandHitRects> {
        self.island_hits.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn music(&self) -> MutexGuard<'_, MusicHub> {
        self.music.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn focus_mode(&self) -> FocusModeState {
        FocusModeState {
            on: self.shared().focus_mode,
        }
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
        assert!(json["mic"]["apps"][0]["service"].is_null());
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
    fn island_types_match_the_ts_contract() {
        let hits: IslandHitRects = serde_json::from_value(serde_json::json!({
            "rects": [{ "x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0 }],
            "dragMargin": 24.0
        }))
        .unwrap();
        assert_eq!(hits.drag_margin, 24.0);
        assert_eq!(hits.rects[0].height, 4.0);
        assert_eq!(
            serde_json::to_value(IslandPointer { inside: true }).unwrap(),
            serde_json::json!({ "inside": true })
        );
        assert_eq!(
            serde_json::to_value(FocusModeState { on: false }).unwrap(),
            serde_json::json!({ "on": false })
        );
        assert_eq!(
            serde_json::to_value(NavigatePayload { route: "/a".into() }).unwrap(),
            serde_json::json!({ "route": "/a" })
        );
    }

    #[test]
    fn update_status_matches_the_ts_contract() {
        let status = UpdateStatus {
            current: "0.2.0".into(),
            state: UpdateState::UpToDate,
            available: None,
            message: None,
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({
                "current": "0.2.0",
                "state": "up-to-date",
                "available": null,
                "message": null
            })
        );
        let states = [
            (UpdateState::Disabled, "disabled"),
            (UpdateState::Idle, "idle"),
            (UpdateState::Checking, "checking"),
            (UpdateState::UpToDate, "up-to-date"),
            (UpdateState::Downloading, "downloading"),
            (UpdateState::Ready, "ready"),
            (UpdateState::Installing, "installing"),
            (UpdateState::Error, "error"),
        ];
        for (state, name) in states {
            assert_eq!(serde_json::to_value(state).unwrap(), name);
        }
    }

    #[test]
    fn island_hits_sanitized() {
        let rect = |w: f64| IslandRect {
            x: 0.0,
            y: 0.0,
            width: w,
            height: 8.0,
        };
        let hits = IslandHitRects::sanitized(vec![rect(120.0), rect(0.0), rect(f64::NAN)], -3.0);
        assert_eq!(hits.rects, vec![rect(120.0)]);
        assert_eq!(hits.drag_margin, 0.0);
        assert_eq!(
            IslandHitRects::sanitized(vec![], f64::INFINITY).drag_margin,
            0.0
        );
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

    #[test]
    fn mic_apps_carry_the_recognized_service() {
        let apps = || {
            vec![
                PlatformMicApp {
                    id: "C:#Users#me#AppData#Local#Discord#Discord.exe".into(),
                    display_name: "Discord.exe".into(),
                },
                PlatformMicApp {
                    id: "C:#Program Files#Google#Chrome#Application#chrome.exe".into(),
                    display_name: "chrome.exe".into(),
                },
            ]
        };
        let titles = vec!["Meet – abc-defg-hij - Google Chrome".to_string()];
        let mic = MicState::from_apps_with_titles(apps(), &titles);
        let json = serde_json::to_value(&mic).unwrap();
        assert_eq!(json["apps"][0]["displayName"], "Google Meet");
        assert_eq!(json["apps"][0]["service"], "meet");
        assert_eq!(json["apps"][1]["displayName"], "Discord");
        assert_eq!(json["apps"][1]["service"], "discord");
        // Sans titre d'appel, le navigateur garde son nom.
        let mic = MicState::from_apps(apps());
        assert_eq!(mic.apps[0].display_name, "chrome.exe");
        assert_eq!(mic.apps[0].service, None);
    }
}
