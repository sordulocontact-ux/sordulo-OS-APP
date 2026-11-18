/**
 * IPC contract between the Tauri shell (src-tauri/, Rust) and the front (src/).
 * Rust side mirrors these names and payloads exactly (serde camelCase).
 * Only used when the app runs inside Tauri; the web build never calls it.
 */

/** Window labels created by the Rust shell. */
export const DESKTOP_WINDOWS = {
  /** Main window: the regular app (closing it hides it in the tray). */
  main: 'main',
  /** Small always-on-top window near the tray, route DESKTOP_PROMPT_ROUTE. Created hidden at startup. */
  prompt: 'prompt',
} as const

/** Front route loaded by the prompt window (outside the regular app layout). */
export const DESKTOP_PROMPT_ROUTE = '/desktop/prompt'

/** An app that currently uses the microphone (Sordulo OS itself excluded). */
export interface MicApp {
  id: string
  displayName: string
}

export interface MicState {
  active: boolean
  apps: MicApp[]
}

export type RecordingStatus = 'idle' | 'recording' | 'stopping'

export interface RecordingState {
  status: RecordingStatus
  /** Project chosen when the recording started. */
  projectId: string | null
  title: string | null
  /** Unix epoch in ms. */
  startedAt: number | null
  elapsedSecs: number
}

/** Returned by stop_recording. The file stays on disk until delete_recording. */
export interface RecordingResult {
  path: string
  durationSecs: number
  sizeBytes: number
  /** e.g. "audio/mpeg" */
  mimeType: string
  projectId: string
  title: string | null
}

export interface DesktopStatus {
  mic: MicState
  recording: RecordingState
}

/** Why the prompt window is shown. */
export type PromptReason =
  /** The mic just became active while nothing is recorded: "Transcrire cet appel ?" */
  | 'mic-active'
  /** The mic became inactive while recording: "L'appel semble terminé. Arrêter ?" */
  | 'mic-inactive'
  /** The user clicked "Démarrer l'enregistrement" in the tray: choose a project. */
  | 'manual-start'
  /** The user clicked "Arrêter l'enregistrement" in the tray: stop then upload. */
  | 'manual-stop'

export interface PromptPayload {
  reason: PromptReason
  mic: MicState
  recording: RecordingState
}

/** Events emitted by Rust (listen with @tauri-apps/api/event). */
export const DESKTOP_EVENTS = {
  /** Payload MicState, emitted on every change of the active-app set. */
  micState: 'desktop://mic-state',
  /** Payload RecordingState, emitted on start/stop and every second while recording. */
  recordingState: 'desktop://recording-state',
  /** Payload PromptPayload, emitted to the prompt window right before Rust shows it. */
  prompt: 'desktop://prompt',
} as const

/** Commands implemented in Rust (invoke from @tauri-apps/api/core). Arguments are camelCase. */
export const DESKTOP_COMMANDS = {
  /** () => DesktopStatus */
  getStatus: 'get_status',
  /** ({ projectId: string, title?: string | null }) => RecordingState */
  startRecording: 'start_recording',
  /** () => RecordingResult */
  stopRecording: 'stop_recording',
  /** ({ path: string }) => ArrayBuffer (raw bytes of the recording) */
  readRecording: 'read_recording',
  /** ({ path: string }) => void */
  deleteRecording: 'delete_recording',
  /** () => void — hides the prompt window; the mic-active prompt stays dismissed until the mic goes inactive. */
  dismissPrompt: 'dismiss_prompt',
  /** () => void — shows and focuses the main window. */
  showMainWindow: 'show_main_window',
} as const
