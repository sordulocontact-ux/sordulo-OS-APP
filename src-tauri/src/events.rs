//! Noms partagés avec le front : copie exacte de `src/shared/desktop-contract.ts`.

/// `DESKTOP_WINDOWS.main`
pub const WINDOW_MAIN: &str = "main";
/// `DESKTOP_WINDOWS.prompt`
pub const WINDOW_PROMPT: &str = "prompt";
/// `DESKTOP_PROMPT_ROUTE`
pub const PROMPT_ROUTE: &str = "/desktop/prompt";

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
/// `DESKTOP_EVENTS.claude` (payload `ClaudeRelayEvent`), fenêtre de l'île.
pub const EVENT_CLAUDE: &str = "desktop://claude";
/// `DESKTOP_EVENTS.claudeConnection` (payload `ClaudeConnection`), fenêtre de l'île.
pub const EVENT_CLAUDE_CONNECTION: &str = "desktop://claude-connection";
/// `DESKTOP_EVENTS.music` (payload `MusicState | null`), fenêtre de l'île, seulement quand ça change.
pub const EVENT_MUSIC: &str = "desktop://music";
/// `CLAUDE_PERMISSION_TIMEOUT_MS` : attente maximale d'une réponse de l'île à un PermissionRequest.
pub const CLAUDE_PERMISSION_TIMEOUT_MS: u64 = 60_000;
/// Schéma de `DESKTOP_AUTH_REDIRECT` (`sordulo://auth`).
pub const URL_SCHEME: &str = "sordulo";
