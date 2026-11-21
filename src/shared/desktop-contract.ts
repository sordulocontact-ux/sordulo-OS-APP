/**
 * IPC contract between the Tauri shell (src-tauri/, Rust) and the front (src/).
 * Rust side mirrors these names and payloads exactly (serde camelCase).
 * Only used when the app runs inside Tauri; the web build never calls it.
 */

/** Window labels created by the Rust shell. */
export const DESKTOP_WINDOWS = {
  /** Main window: the regular app (closing it hides it in the tray). */
  main: 'main',
  /**
   * The island: transparent, borderless, always-on-top window glued to the top center of the primary screen,
   * route DESKTOP_PROMPT_ROUTE. Sized for the largest island state; clicks pass through everything outside
   * the hit rects sent with islandSetHitRects. Created at startup.
   */
  prompt: 'prompt',
} as const

/** Front route loaded by the prompt window (outside the regular app layout). */
export const DESKTOP_PROMPT_ROUTE = '/desktop/prompt'

/**
 * Where Supabase sends the email login link back when the login was requested from the desktop app.
 * Windows opens the app with this URL (scheme registered by Rust at startup). Must be in Supabase Redirect URLs.
 */
export const DESKTOP_AUTH_REDIRECT = 'sordulo://auth'

/**
 * Call service recognised by the Rust detector, from the app id (Discord.exe, MSTeams…) or, for a browser,
 * from the title of a visible window (« Meet – abc-defg-hij »). Drives the island's icon and colour.
 */
export type CallService =
  | 'meet'
  | 'teams'
  | 'zoom'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'webex'
  | 'skype'
  | 'signal'
  | 'telegram'
  | 'facetime'
  | 'whereby'
  | 'jitsi'

/** An app that currently uses the microphone (Sordulo OS itself excluded). */
export interface MicApp {
  id: string
  /** Human name: the call service when known (« Discord », « Google Meet »), else the app name. */
  displayName: string
  /** Recognised call service, null when unknown (generic call icon and colour). */
  service: CallService | null
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

/** Live sound level while recording (mic + computer sound mixed), emitted about every 90 ms. */
export interface AudioLevel {
  /** 0..1, already scaled for display (0 = silence). */
  level: number
  /** Unix epoch in ms. */
  at: number
}

/** A rectangle of the island window that must receive the mouse, in CSS px relative to the window's top-left corner. */
export interface IslandRect {
  x: number
  y: number
  width: number
  height: number
}

export interface IslandHitRects {
  /** The black shapes (island + secondary bubble). Clicks pass through everything else. */
  rects: IslandRect[]
  /**
   * Extra margin (CSS px) around the rects where a file drag held with the left button wakes the island
   * (24 in the ticket). 0 disables it.
   */
  dragMargin: number
}

/** Whether the mouse is over one of the hit rects (margin excluded). Source of truth for the island hover. */
export interface IslandPointer {
  inside: boolean
}

export interface FocusModeState {
  on: boolean
}

export interface NavigatePayload {
  /** Route of the main window, e.g. /projects/:projectId/inputs/:inputId/review */
  route: string
}

/** Claude Code hooks relayed to the island. */
export type ClaudeHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop'
  | 'SessionEnd'
  /**
   * Emitted by the app itself (not a Claude Code hook): a PermissionRequest ended without an answer from the
   * island (60 s timeout, or the relay hung up because Claude Code moved on). Carries the requestId.
   */
  | 'PermissionCancelled'

export interface ClaudeRelayEvent {
  event: ClaudeHookEventName
  /** session_id from Claude Code. */
  sessionId: string
  /** Working directory of the session. */
  cwd: string | null
  /** Current git branch of cwd, read by the app (null outside a repo). */
  branch: string | null
  toolName: string | null
  /** Human summary of the tool input: command, file path, pattern… Never file contents. */
  toolSummary: string | null
  /** Absolute path of the file written by Edit / Write / MultiEdit / NotebookEdit, to detect conflicts. */
  filePath: string | null
  /** PermissionRequest only: send it back with claudeAnswer. */
  requestId: string | null
  /** Notification: Claude Code message. UserPromptSubmit: start of the prompt. Stop / SessionEnd: reason if any. */
  message: string | null
  /** PermissionRequest of the AskUserQuestion tool: Claude's multiple-choice questions, answered from the island. */
  questions?: ClaudeQuestion[]
  /**
   * Shell (Bash, PowerShell) or subagent (Agent, Task) started with `run_in_background: true`: Claude will end
   * its turn but keeps waiting for it. Absent (false) otherwise.
   */
  background?: boolean
  /** Unix epoch in ms. */
  at: number
}

/** A multiple-choice question asked by Claude (AskUserQuestion tool). */
export interface ClaudeQuestion {
  /** Exact text: key of the answer sent back to Claude Code. */
  question: string
  /** Short tag (« Approche », « Format »). */
  header: string | null
  multiSelect: boolean
  options: { label: string; description: string | null }[]
}

export interface ClaudeConnection {
  /** Sordulo OS hooks are present in ~/.claude/settings.json. */
  connected: boolean
  /** Unix epoch in ms of the last hook received, null if none since launch. */
  lastEventAt: number | null
}

/** How long the relay waits for the island's answer to a PermissionRequest before handing back to the terminal. */
export const CLAUDE_PERMISSION_TIMEOUT_MS = 60_000

/** Answer to a PermissionRequest. `later` hands the decision back to the terminal right away. */
export type ClaudeDecision = 'allow' | 'deny' | 'later'

/** Events emitted by Rust (listen with @tauri-apps/api/event). */
export const DESKTOP_EVENTS = {
  /** Payload MicState, emitted on every change of the active-app set. */
  micState: 'desktop://mic-state',
  /** Payload RecordingState, emitted on start/stop and every second while recording. */
  recordingState: 'desktop://recording-state',
  /** Payload PromptPayload, emitted to the prompt window right before Rust shows it. */
  prompt: 'desktop://prompt',
  /** No payload, main window only: a login link arrived, read it with takeAuthCallback. */
  authCallback: 'desktop://auth-callback',
  /** Payload AudioLevel, island window, about every 90 ms while recording. */
  audioLevel: 'desktop://audio-level',
  /** Payload IslandPointer, island window: the mouse entered or left the hit rects (polled by Rust). */
  islandPointer: 'desktop://island-pointer',
  /** Payload NavigatePayload, main window: go to this route (sent by openMainAt). */
  navigate: 'desktop://navigate',
  /** Payload FocusModeState, island window: focus mode toggled in the tray menu. */
  focusMode: 'desktop://focus-mode',
  /** Payload ClaudeRelayEvent, island window: a Claude Code hook arrived. */
  claude: 'desktop://claude',
  /** Payload ClaudeConnection, island window: hooks connected / disconnected, or a hook arrived. */
  claudeConnection: 'desktop://claude-connection',
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
  /** ({ reason: 'manual-start' }) => void — emits a PromptPayload to the prompt window and shows it (header "Enregistrer un appel" button). */
  openPrompt: 'open_prompt',
  /** () => string | null — the pending `sordulo://auth…` login link, returned once (main window only). */
  takeAuthCallback: 'take_auth_callback',
  /** (IslandHitRects) => void — island window: where the black shapes are; the mouse passes through elsewhere. */
  islandSetHitRects: 'island_set_hit_rects',
  /** ({ route: string }) => void — shows and focuses the main window, then emits DESKTOP_EVENTS.navigate to it. */
  openMainAt: 'open_main_at',
  /** () => FocusModeState */
  getFocusMode: 'get_focus_mode',
  /** ({ on: boolean }) => FocusModeState — also updates the tray menu check. */
  setFocusMode: 'set_focus_mode',
  /** () => ClaudeConnection */
  claudeGetConnection: 'claude_get_connection',
  /** ({ requestId: string, decision: ClaudeDecision }) => void — answers a pending PermissionRequest. */
  claudeAnswer: 'claude_answer',
  /** Île : met au premier plan la fenêtre VS Code (ou l'app) d'une session Claude, sur son dossier. */
  claudeOpenSession: 'claude_open_session',
  /**
   * Raw body = file bytes, header `x-file-name` = original file name (URI-encoded) => string, the absolute path
   * of a copy saved in the app's drop folder. Island window only. Used by the « Claude Code » drop zone, because
   * an HTML5 drop gives the file contents but not its original path.
   */
  saveDroppedFile: 'save_dropped_file',
  /** ({ text: string }) => void — island window: copies text to the system clipboard (works without focus, unlike navigator.clipboard). */
  copyText: 'copy_text',
} as const
