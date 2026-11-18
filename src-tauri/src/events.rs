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
