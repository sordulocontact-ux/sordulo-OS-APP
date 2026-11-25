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
 * Edge of a screen the island is glued to, at the middle of that edge. `top` is the historical place (around
 * the camera notch on a notched Mac). `left` / `right`: vertical island (compact states stacked along the
 * edge, open states as a horizontal card coming out of the edge).
 *
 * The island window URL carries the starting placement: `?platform=mac|win&edge=top|bottom|left|right`
 * (`platform=mac` = notch variant, only with `edge=top` on a notched screen).
 */
export type IslandEdge = 'top' | 'bottom' | 'left' | 'right'

/**
 * Size of the island window (CSS / logical px), set by Rust from the edge: horizontal for top / bottom, vertical
 * for left / right (widest open card 440 + spring overshoot, along the edge the tallest card or stacked compact
 * state). Horizontal height: tallest open view (musicOpen on Mac with the "also running" list unfolded to
 * MEET_BACKGROUND.maxExpandedRows, 366) + spring overshoot. Must match `HORIZONTAL_SIZE` / `VERTICAL_SIZE` in
 * src-tauri/src/island_window/geometry.rs.
 */
export const ISLAND_WINDOW_SIZE = {
  horizontal: { width: 640, height: 420 },
  vertical: { width: 520, height: 480 },
} as const

/**
 * Diameter (CSS px) of the round drop the island becomes while it is dragged: the front morphs the shape into
 * it, Rust centres it under the cursor at the start of the drag and keeps its centre when the window is resized
 * for the target edge.
 */
export const ISLAND_DRAG_BLOB = 44

/**
 * Offset (CSS px) of the drop towards the inside of the window, away from the window side of its edge: the
 * drop (a puddle) stretches behind its motion, and against the window side it would be cut off. Rust centres
 * the drop at ISLAND_DRAG_BLOB / 2 + ISLAND_DRAG_INSET from the edge, under the cursor.
 */
export const ISLAND_DRAG_INSET = 48

/** Where the island sits (DESKTOP_EVENTS.islandPlacement, DESKTOP_COMMANDS.getIslandPlacement). */
export interface IslandPlacement {
  edge: IslandEdge
  /** The island surrounds the camera notch (top edge of a notched Mac screen): the front draws the `mac` variant. */
  notch: boolean
}

/**
 * Size of the island's black shape when the drag starts, in CSS px, measured in the edge's frame: `along`
 * the edge and `depth` away from it (top island 193 × 40 → along 193, depth 40). Sent with islandDragStart
 * (logged by Rust).
 */
export interface IslandDragStart {
  along: number
  depth: number
}

/**
 * Drag of the island, driven by Rust (the window follows the cursor at ~60 Hz while the left button is down,
 * then is thrown to an edge with a spring). `start`: the drag began (front keeps the island closed, no
 * hover). `end`: the thrown island is landing (a few px from its place, so the drop takes back the edge shape
 * as it lands), or the release found no place. The islandPlacement event comes at release (possibly the same).
 */
export interface IslandDrag {
  phase: 'start' | 'end'
}

/**
 * Velocity of the island window in CSS px / s, sent by Rust at ~60 Hz during a drag and the throw that follows
 * (until the drop lands, IslandDrag `end`). The puddle trails behind and stretches with it, then splats on the edge.
 */
export interface IslandMotion {
  vx: number
  vy: number
}

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

/**
 * What the computer is playing, read from the system player (Windows: Global System Media Transport Controls,
 * any player; macOS: Spotify and Music via AppleScript). Call apps (Teams, Zoom…) are never reported.
 * `null` in MusicChanged / getMusic: nothing is playing or paused, or music is turned off in the tray menu.
 */
export interface MusicState {
  /** Stable player id (Windows AppUserModelId, macOS bundle id). */
  appId: string
  /** Player name shown to the user (« Spotify », « Google Chrome », « Musique »). */
  appName: string
  title: string
  artist: string | null
  album: string | null
  /** false: paused (the island keeps it for a few seconds, then hides it). */
  playing: boolean
  /** Position in the track when it was read, in ms; null if the player does not give it. */
  positionMs: number | null
  /** Track length in ms; null if unknown. */
  durationMs: number | null
  /** Unix epoch in ms when positionMs was read (the front advances it while playing). */
  positionAt: number
  /** Changes with each new cover; null: no cover. Fetch the image bytes with getMusicArtwork. */
  artworkId: string | null
  /**
   * The island can send previous / play-pause / next. False: hide the buttons (Spotify on another device with a
   * free account: the Web API player commands need Spotify Premium). Absent: true.
   */
  canControl?: boolean
  /**
   * Tempo of the track in beats per minute, from Deezer's public API (looked up by artist and title, cached).
   * Absent: unknown or not found yet (a new MusicChanged follows when it arrives). The island uses it with the
   * position when the computer's sound is not analyzed (music on another device, macOS).
   */
  tempoBpm?: number
}

/**
 * Spotify connection used by this computer. The connection belongs to the Sordulo OS account, not to the
 * computer: each person pastes the Client ID of their own Spotify app (developer.spotify.com) in the Spotify
 * card, the desktop app authorizes the account (OAuth PKCE, no secret) and the refresh token is saved on the
 * account (table spotify_connections, migration 0009). The island window reads that row and sends it to Rust
 * (spotifySetConnection); Rust keeps everything in memory, nothing on disk. Lets the island show what plays on
 * any device of the account (phone, speaker), after the computer's own player.
 */
export interface SpotifyStatus {
  /** Rust has a usable connection (sent by the front and not refused by Spotify). */
  connected: boolean
  /** Spotify display name of the connected account; null when not connected. */
  account: string | null
  /** Premium account: the island can control playback on the other devices. */
  premium: boolean
  /**
   * Spotify refused the refresh token on this computer. Rust stopped using it and sent a SpotifyTokenChange
   * with refreshToken null: the island re-reads the account row (another computer may have rotated the token)
   * and sends it again, or marks the account « À reconnecter ». Cleared by the next connection sent.
   */
  needsReconnect: boolean
  /** A connection is waiting for the user in the browser. */
  connecting: boolean
}

/** Row of the Sordulo OS account sent to Rust by spotifySetConnection (only with a refresh token). */
export interface SpotifyConnection {
  /** Client ID of the person's Spotify app (not a secret with PKCE). */
  clientId: string
  refreshToken: string
  /** Display name saved on the account; Rust re-reads it from Spotify (its own value wins). */
  account: string | null
  premium: boolean
}

/** Result of spotifyConnect, saved on the Sordulo OS account by the front. */
export interface SpotifyAuthorization {
  refreshToken: string
  account: string
  premium: boolean
}

/**
 * DESKTOP_EVENTS.spotifyToken, island window. refreshToken set: Spotify rotated the refresh token, replace
 * previousRefreshToken by it on the account (only if the row still holds it). refreshToken null: Spotify refused
 * previousRefreshToken, re-read the row before marking the account « À reconnecter ». Repeated by Rust while the
 * row still holds previousRefreshToken.
 */
export interface SpotifyTokenChange {
  previousRefreshToken: string
  refreshToken: string | null
}

/**
 * Live analysis of the sound the computer is playing (Windows: loopback of the default output device; macOS:
 * not available, the island keeps its simulated equalizer). Sent about 30 times a second, only while music
 * plays on this computer and music is on in the tray menu. No event for a while (~400 ms): back to simulated.
 */
export interface MusicLevels {
  /** 8 bands from bass to treble, 0..1, automatic gain (same movement at low or high volume). All near 0: silence. */
  bands: number[]
  /** Estimated beat period in ms; null while no steady tempo is found. */
  beatPeriodMs: number | null
  /** Unix epoch in ms of the last detected beat; null if none yet. */
  lastBeatAt: number | null
  /** Unix epoch in ms of this analysis frame. */
  at: number
}

/** Player commands sent from the island (`open`: bring the player's window to the front). */
export type MusicCommand = 'previous' | 'playPause' | 'next' | 'open'

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

/** Tray menu check « Afficher les déploiements dans l'île » (not remembered between launches, like the music one). */
export interface DeploymentsEnabledState {
  on: boolean
}

/**
 * Automatic updates of the installed app (src-tauri/src/updater.rs). Dev builds never update:
 * `state` stays `disabled`.
 * - idle: nothing known yet; checking: asking the update server; up-to-date: no newer version;
 * - downloading: a newer version is being downloaded; ready: downloaded, waiting for a quiet moment
 *   (main window hidden, no recording) to install; installing: being installed, the app restarts;
 * - error: last check or install failed (`message`), retried at the next check.
 */
export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdateStatus {
  /** Version of the running app, e.g. "0.2.0". */
  current: string
  state: UpdateState
  /** Newer version found on the update server, when there is one. */
  available: string | null
  /** French error message when state is `error`. */
  message: string | null
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

/**
 * How long the relay waits for the island's answer to a PermissionRequest (10 min). Claude Code shows its own
 * prompt in the terminal meanwhile and moves on as soon as it is answered there, so a long wait blocks nothing.
 */
export const CLAUDE_PERMISSION_TIMEOUT_MS = 600_000

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
  /** Payload DeploymentsEnabledState, island window: « Afficher les déploiements dans l'île » toggled in the tray menu. */
  deploymentsEnabled: 'desktop://deployments-enabled',
  /** Payload ClaudeRelayEvent, island window: a Claude Code hook arrived. */
  claude: 'desktop://claude',
  /** Payload ClaudeConnection, island and main windows: hooks connected / disconnected, or a hook arrived. */
  claudeConnection: 'desktop://claude-connection',
  /**
   * Payload MusicState | null, island window: what is playing changed (track, play / pause, cover, position
   * jump, player). Sent on change only (polled by Rust about every second), not as a position ticker.
   */
  music: 'desktop://music',
  /** Payload SpotifyStatus, all windows: the Spotify connection changed (connected, disconnected, access lost). */
  spotify: 'desktop://spotify',
  /** Payload SpotifyTokenChange, island window: the refresh token rotated (save it) or was refused (re-read the row). */
  spotifyToken: 'desktop://spotify-token',
  /** Payload MusicLevels, island window: live bands and beat of the music played by the computer (Windows). */
  musicLevels: 'desktop://music-levels',
  /** Payload UpdateStatus, main window: the update state changed. */
  updateStatus: 'desktop://update-status',
  /**
   * Payload IslandPlacement, island window: the island moved to another edge or screen (end of a throw,
   * « Replacer l'île en haut » in the tray menu, screen removed). Also sent at the end of every drag.
   */
  islandPlacement: 'desktop://island-placement',
  /** Payload IslandDrag, island window: a drag started or ended. */
  islandDrag: 'desktop://island-drag',
  /** Payload IslandMotion, island window: velocity of the window during a drag and its throw. */
  islandMotion: 'desktop://island-motion',
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
  /** () => IslandPlacement */
  getIslandPlacement: 'get_island_placement',
  /**
   * (IslandDragStart) => void — island window only: the user pressed the island and moved past the drag
   * threshold with the left button still down. Rust takes over (window follows the cursor, then the throw).
   * Ignored if the button is already up.
   */
  islandDragStart: 'island_drag_start',
  /** ({ route: string }) => void — shows and focuses the main window, then emits DESKTOP_EVENTS.navigate to it. */
  openMainAt: 'open_main_at',
  /** () => FocusModeState */
  getFocusMode: 'get_focus_mode',
  /** ({ on: boolean }) => FocusModeState — also updates the tray menu check. */
  setFocusMode: 'set_focus_mode',
  /** () => DeploymentsEnabledState — island window: Vercel deployments shown in the island (tray menu check). */
  getDeploymentsEnabled: 'get_deployments_enabled',
  /** () => ClaudeConnection */
  claudeGetConnection: 'claude_get_connection',
  /** () => ClaudeConnection — main window only: writes the hooks in ~/.claude/settings.json (like the tray menu). */
  claudeConnect: 'claude_connect',
  /** () => ClaudeConnection — main window only: removes the hooks. */
  claudeDisconnect: 'claude_disconnect',
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
  /** () => MusicState | null — island window: what is playing now (initial read; then DESKTOP_EVENTS.music). */
  getMusic: 'get_music',
  /**
   * ({ artworkId: string }) => ArrayBuffer — island window: raw bytes of the current cover (PNG or JPEG).
   * Error if artworkId is no longer the current one (the track changed in between).
   */
  getMusicArtwork: 'get_music_artwork',
  /** ({ command: MusicCommand }) => void — island window: previous / play-pause / next / bring the player to the front. */
  musicCommand: 'music_command',
  /** () => SpotifyStatus */
  spotifyStatus: 'spotify_status',
  /**
   * ({ clientId: string }) => SpotifyAuthorization — main window only: opens the Spotify authorization page in
   * the default browser and waits (up to 3 minutes) for its redirect to http://127.0.0.1:43127/callback.
   * clientId: the Client ID saved on the account. The front saves the result on the account, then sends it with
   * spotifySetConnection.
   */
  spotifyConnect: 'spotify_connect',
  /** () => SpotifyStatus — main window only: stops a connection waiting in the browser. */
  spotifyCancelConnect: 'spotify_cancel_connect',
  /**
   * ({ connection: SpotifyConnection | null }) => SpotifyStatus — island and main windows: the account row (null:
   * no refresh token, no row, or signed out of Sordulo OS). Same token as Rust's: kept (access token, refusal).
   */
  spotifySetConnection: 'spotify_set_connection',
  /** () => UpdateStatus */
  getUpdateStatus: 'get_update_status',
  /**
   * () => UpdateStatus — checks and downloads the newest version without installing it (Settings > desktop app:
   * the user then chooses installUpdateNow). Refused in dev.
   */
  checkUpdate: 'check_update',
  /**
   * () => UpdateStatus — checks, downloads and installs the newest version now, even while the main window is
   * shown (the app restarts). Refused with a French message while a call is being recorded. Used when the API
   * requires a newer desktop version (DESKTOP_MIN_VERSION).
   */
  installUpdateNow: 'install_update_now',
} as const
