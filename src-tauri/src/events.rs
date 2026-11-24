//! Noms partagés avec le front : copie exacte de `src/shared/desktop-contract.ts`.

/// `DESKTOP_WINDOWS.main`
pub const WINDOW_MAIN: &str = "main";
/// `DESKTOP_WINDOWS.prompt`
pub const WINDOW_PROMPT: &str = "prompt";
/// `DESKTOP_PROMPT_ROUTE`
pub const PROMPT_ROUTE: &str = "/desktop/prompt";
/// `DESKTOP_EVENTS.islandPlacement` (payload `IslandPlacement`), fenêtre de l'île.
pub const EVENT_ISLAND_PLACEMENT: &str = "desktop://island-placement";
/// `DESKTOP_EVENTS.islandDrag` (payload `IslandDrag`), fenêtre de l'île.
pub const EVENT_ISLAND_DRAG: &str = "desktop://island-drag";

/// `DESKTOP_EVENTS.micState` (payload `MicState`).
pub const EVENT_MIC_STATE: &str = "desktop://mic-state";
/// `DESKTOP_EVENTS.recordingState` (payload `RecordingState`).
pub const EVENT_RECORDING_STATE: &str = "desktop://recording-state";
/// `DESKTOP_EVENTS.prompt` (payload `PromptPayload`).
pub const EVENT_PROMPT: &str = "desktop://prompt";
/// `DESKTOP_EVENTS.authCallback` (sans payload) : un lien de connexion attend `take_auth_callback`.
pub const EVENT_AUTH_CALLBACK: &str = "desktop://auth-callback";
/// `DESKTOP_EVENTS.audioLevel` (payload `AudioLevel`), fenêtre de l'île, ~toutes les 90 ms pendant l'enregistrement.
pub const EVENT_AUDIO_LEVEL: &str = "desktop://audio-level";
/// `DESKTOP_EVENTS.islandPointer` (payload `IslandPointer`), fenêtre de l'île.
pub const EVENT_ISLAND_POINTER: &str = "desktop://island-pointer";
/// `DESKTOP_EVENTS.navigate` (payload `NavigatePayload`), fenêtre principale.
pub const EVENT_NAVIGATE: &str = "desktop://navigate";
/// `DESKTOP_EVENTS.focusMode` (payload `FocusModeState`), fenêtre de l'île.
pub const EVENT_FOCUS_MODE: &str = "desktop://focus-mode";
/// `DESKTOP_EVENTS.deploymentsEnabled` (payload `DeploymentsEnabledState`), fenêtre de l'île.
pub const EVENT_DEPLOYMENTS_ENABLED: &str = "desktop://deployments-enabled";
/// `DESKTOP_EVENTS.claude` (payload `ClaudeRelayEvent`), fenêtre de l'île.
pub const EVENT_CLAUDE: &str = "desktop://claude";
/// `DESKTOP_EVENTS.claudeConnection` (payload `ClaudeConnection`), fenêtre de l'île.
pub const EVENT_CLAUDE_CONNECTION: &str = "desktop://claude-connection";
/// `DESKTOP_EVENTS.music` (payload `MusicState | null`), fenêtre de l'île, seulement quand ça change.
pub const EVENT_MUSIC: &str = "desktop://music";
/// `DESKTOP_EVENTS.spotify` (payload `SpotifyStatus`), toutes les fenêtres : connexion Spotify changée.
pub const EVENT_SPOTIFY: &str = "desktop://spotify";
/// `DESKTOP_EVENTS.musicLevels` (payload `MusicLevels`), fenêtre de l'île, ~30 fois par seconde pendant
/// l'analyse du son de la musique jouée par l'ordinateur (Windows ; jamais sur macOS).
pub const EVENT_MUSIC_LEVELS: &str = "desktop://music-levels";
/// `DESKTOP_EVENTS.updateStatus` (payload `UpdateStatus`), fenêtre principale.
pub const EVENT_UPDATE_STATUS: &str = "desktop://update-status";
/// `CLAUDE_PERMISSION_TIMEOUT_MS` : attente maximale d'une réponse de l'île à un PermissionRequest.
pub const CLAUDE_PERMISSION_TIMEOUT_MS: u64 = 60_000;
/// Schéma de `DESKTOP_AUTH_REDIRECT` (`sordulo://auth`).
pub const URL_SCHEME: &str = "sordulo";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music_levels::MusicLevels;

    #[test]
    fn music_levels_a_la_forme_du_contrat() {
        assert_eq!(EVENT_MUSIC_LEVELS, "desktop://music-levels");
        let levels = MusicLevels {
            bands: [0.9, 0.7, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0],
            beat_period_ms: Some(500.0),
            last_beat_at: Some(1_790_000_000_000),
            at: 1_790_000_000_120,
        };
        // Tauri envoie `serde_json::to_string` du payload : même chemin ici.
        let text = serde_json::to_string(&levels).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["at", "bands", "beatPeriodMs", "lastBeatAt"]);
        let bands = json["bands"].as_array().unwrap();
        assert_eq!(bands.len(), 8);
        // f32 sérialisés sans bruit d'arrondi (0.7 et pas 0.699999988079071).
        assert_eq!(bands[1], serde_json::json!(0.7));
        assert_eq!(json["beatPeriodMs"], 500.0);
        assert_eq!(json["lastBeatAt"], 1_790_000_000_000u64);
        assert_eq!(json["at"], 1_790_000_000_120u64);
        // Pas de tempo stable ni de temps : null (jamais absents).
        let bare = MusicLevels {
            beat_period_ms: None,
            last_beat_at: None,
            ..levels
        };
        let json = serde_json::to_value(&bare).unwrap();
        assert!(json["beatPeriodMs"].is_null());
        assert!(json["lastBeatAt"].is_null());
    }
}
