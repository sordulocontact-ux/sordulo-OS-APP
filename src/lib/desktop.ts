/**
 * Typed wrappers around the Tauri IPC (contract: src/shared/desktop-contract.ts).
 * Never call them outside Tauri: guard every call site with isDesktop().
 * Importing the Tauri modules has no side effect: nothing runs until a wrapper is called.
 */
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getVersion } from '@tauri-apps/api/app'
import { useSyncExternalStore } from 'react'
import {
  DESKTOP_COMMANDS,
  DESKTOP_EVENTS,
  type AudioLevel,
  type ClaudeConnection,
  type ClaudeDecision,
  type ClaudeRelayEvent,
  type DeploymentsEnabledState,
  type DesktopStatus,
  type FocusModeState,
  type IslandDrag,
  type IslandMotion,
  type IslandDragStart,
  type IslandHitRects,
  type IslandPlacement,
  type IslandPointer,
  type MicState,
  type MusicCommand,
  type MusicState,
  type GoogleAccess,
  type GoogleAuthorization,
  type GoogleService,
  type GoogleStatus,
  type RecordingMarkers,
  type SpotifyAuthorization,
  type SpotifyConnection,
  type SpotifyStatus,
  type SpotifyTokenChange,
  type MusicLevels,
  type NavigatePayload,
  type PromptPayload,
  type RecordingResult,
  type RecordingState,
  type UpdateStatus,
} from '../shared/desktop-contract'

export function isDesktop(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

/** Constant for the whole session; handy in components. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    () => () => {},
    isDesktop,
    () => false,
  )
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args)
}

async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return listen<T>(event, (e) => handler(e.payload))
}

export const getStatus = () => call<DesktopStatus>(DESKTOP_COMMANDS.getStatus)

export const startRecording = (args: { projectId: string; title?: string | null }) =>
  call<RecordingState>(DESKTOP_COMMANDS.startRecording, args)

export const stopRecording = () => call<RecordingResult>(DESKTOP_COMMANDS.stopRecording)

/** Raw bytes returned by a Rust command (tauri::ipc::Response), whatever shape the IPC delivers them in. */
async function callBytes(command: string, args: Record<string, unknown>): Promise<ArrayBuffer> {
  const raw = await call<ArrayBuffer | number[] | Uint8Array>(command, args)
  if (raw instanceof ArrayBuffer) return raw
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const readRecording = (path: string) => callBytes(DESKTOP_COMMANDS.readRecording, { path })

export const deleteRecording = (path: string) => call<void>(DESKTOP_COMMANDS.deleteRecording, { path })

/** The mic-active prompt stays dismissed until the mic goes inactive. The island is not hidden. */
export const dismissPrompt = () => call<void>(DESKTOP_COMMANDS.dismissPrompt)

export const showMainWindow = () => call<void>(DESKTOP_COMMANDS.showMainWindow)

export const openPrompt = (args: { reason: 'manual-start' }) => call<void>(DESKTOP_COMMANDS.openPrompt, args)

export const takeAuthCallback = () => call<string | null>(DESKTOP_COMMANDS.takeAuthCallback)

/** Island window only: the black shapes (CSS px, relative to the window). The mouse passes through elsewhere. */
export const islandSetHitRects = (args: IslandHitRects) =>
  call<void>(DESKTOP_COMMANDS.islandSetHitRects, { rects: args.rects, dragMargin: args.dragMargin })

export const getIslandPlacement = () => call<IslandPlacement>(DESKTOP_COMMANDS.getIslandPlacement)

/** Island window: hands the drag over to Rust (left button held past the threshold). */
export const islandDragStart = (args: IslandDragStart) =>
  call<void>(DESKTOP_COMMANDS.islandDragStart, { along: args.along, depth: args.depth })

/** Shows and focuses the main window, then sends it DESKTOP_EVENTS.navigate (route must start with "/"). */
export const openMainAt = (args: NavigatePayload) => call<void>(DESKTOP_COMMANDS.openMainAt, { route: args.route })

export const getFocusMode = () => call<FocusModeState>(DESKTOP_COMMANDS.getFocusMode)
export const getDeploymentsEnabled = () => call<DeploymentsEnabledState>(DESKTOP_COMMANDS.getDeploymentsEnabled)

/** Also updates the tray menu check and emits DESKTOP_EVENTS.focusMode to the island. */
export const setFocusMode = (args: FocusModeState) =>
  call<FocusModeState>(DESKTOP_COMMANDS.setFocusMode, { on: args.on })

export const claudeGetConnection = () => call<ClaudeConnection>(DESKTOP_COMMANDS.claudeGetConnection)
/** Main window only: same work as the tray menu's « Connecter / Déconnecter Claude Code ». */
export const claudeConnect = () => call<ClaudeConnection>(DESKTOP_COMMANDS.claudeConnect)
export const claudeDisconnect = () => call<ClaudeConnection>(DESKTOP_COMMANDS.claudeDisconnect)

/** Answers a pending PermissionRequest (requestId from the ClaudeRelayEvent). */
/** `answers` (AskUserQuestion): question text → chosen label (several: « A, B »), sent with `allow`. */
export const claudeAnswer = (args: { requestId: string; decision: ClaudeDecision; answers?: Record<string, string> }) =>
  call<void>(DESKTOP_COMMANDS.claudeAnswer, args)

/** Brings the VS Code window (or app) running this Claude session to the front, on its folder. */
export const claudeOpenSession = (args: { sessionId: string }) =>
  call<void>(DESKTOP_COMMANDS.claudeOpenSession, args)

/**
 * Island window: saves a copy of a dropped file in the app's drop folder (50 MB max) and returns its absolute path.
 * The bytes travel as the raw IPC body, the original name in the `x-file-name` header (URI-encoded).
 */
export async function saveDroppedFile(file: File | Blob, name: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return invoke<string>(DESKTOP_COMMANDS.saveDroppedFile, bytes, { headers: { 'x-file-name': encodeURIComponent(name) } })
}

/** Island window: copies text to the system clipboard (no focus or user gesture needed). */
export const copyText = (text: string) => call<void>(DESKTOP_COMMANDS.copyText, { text })

/** Island window: what is playing now (null: nothing, or music turned off in the tray menu). Then onMusic. */
export const getMusic = () => call<MusicState | null>(DESKTOP_COMMANDS.getMusic)

/** Island window: raw bytes (PNG or JPEG) of the current cover. Rejects if artworkId is no longer the current one. */
export const getMusicArtwork = (args: { artworkId: string }) =>
  callBytes(DESKTOP_COMMANDS.getMusicArtwork, { artworkId: args.artworkId })

/** Island window: previous / play-pause / next, or `open` to bring the player's window to the front. */
export const musicCommand = (args: { command: MusicCommand }) =>
  call<void>(DESKTOP_COMMANDS.musicCommand, { command: args.command })

/** Spotify connection of this computer (the account row lives in Supabase: src/lib/spotify.ts). */
export const spotifyStatus = () => call<SpotifyStatus>(DESKTOP_COMMANDS.spotifyStatus)
/** Main window: authorizes the account in the browser with this Client ID; save the result on the account. */
export const spotifyConnect = (args: { clientId: string }) =>
  call<SpotifyAuthorization>(DESKTOP_COMMANDS.spotifyConnect, { clientId: args.clientId })
/** Main window: stops a connection waiting in the browser. */
export const spotifyCancelConnect = () => call<SpotifyStatus>(DESKTOP_COMMANDS.spotifyCancelConnect)
/** Island and main windows: the account row (null: no usable connection, or signed out). */
export const spotifySetConnection = (connection: SpotifyConnection | null) =>
  call<SpotifyStatus>(DESKTOP_COMMANDS.spotifySetConnection, { connection })

/** Marque un moment de l'enregistrement en cours (bouton « Marquer » de l'île). */
export const addRecordingMarker = () => call<RecordingMarkers>(DESKTOP_COMMANDS.addRecordingMarker)
/** Retire le dernier moment marqué (« Annuler »). */
export const removeLastRecordingMarker = () => call<RecordingMarkers>(DESKTOP_COMMANDS.removeLastRecordingMarker)

/** Connecteurs Google de l'ordinateur (les lignes du compte sont dans Supabase : src/lib/google.ts). */
export const googleStatus = () => call<GoogleStatus>(DESKTOP_COMMANDS.googleStatus)
export const googleConnect = (args: { service: GoogleService }) =>
  call<GoogleAuthorization>(DESKTOP_COMMANDS.googleConnect, { service: args.service })
export const googleCancelConnect = () => call<GoogleStatus>(DESKTOP_COMMANDS.googleCancelConnect)
export const googleAccessToken = (args: { service: GoogleService; refreshToken: string; forceRefresh?: boolean }) =>
  call<GoogleAccess>(DESKTOP_COMMANDS.googleAccessToken, {
    service: args.service,
    refreshToken: args.refreshToken,
    forceRefresh: args.forceRefresh ?? false,
  })

/** Version of the running app (Tauri config), e.g. "0.2.0". */
export const getAppVersion = () => getVersion()

export const getUpdateStatus = () => call<UpdateStatus>(DESKTOP_COMMANDS.getUpdateStatus)

/** Checks and downloads the newest version without installing it. Rejects with a French message in dev. */
export const checkUpdate = () => call<UpdateStatus>(DESKTOP_COMMANDS.checkUpdate)

/**
 * Checks, downloads and installs the newest version now (the app restarts). Rejects with a French message,
 * e.g. while a call is being recorded.
 */
export const installUpdateNow = () => call<UpdateStatus>(DESKTOP_COMMANDS.installUpdateNow)

/** Each returns a promise of the unsubscribe function. */
export const onPrompt = (handler: (payload: PromptPayload) => void) =>
  subscribe<PromptPayload>(DESKTOP_EVENTS.prompt, handler)

export const onRecordingState = (handler: (state: RecordingState) => void) =>
  subscribe<RecordingState>(DESKTOP_EVENTS.recordingState, handler)

export const onMicState = (handler: (state: MicState) => void) =>
  subscribe<MicState>(DESKTOP_EVENTS.micState, handler)

export const onAuthCallback = (handler: () => void) => subscribe<null>(DESKTOP_EVENTS.authCallback, () => handler())

export const onAudioLevel = (handler: (level: AudioLevel) => void) =>
  subscribe<AudioLevel>(DESKTOP_EVENTS.audioLevel, handler)

/** Island window: the mouse entered or left the hit rects (source of truth for the island hover). */
export const onIslandPointer = (handler: (pointer: IslandPointer) => void) =>
  subscribe<IslandPointer>(DESKTOP_EVENTS.islandPointer, handler)

/** Island window: the island moved to another edge or screen. */
export const onIslandPlacement = (handler: (placement: IslandPlacement) => void) =>
  subscribe<IslandPlacement>(DESKTOP_EVENTS.islandPlacement, handler)

/** Island window: a drag started or ended. */
export const onIslandDrag = (handler: (drag: IslandDrag) => void) => subscribe<IslandDrag>(DESKTOP_EVENTS.islandDrag, handler)

/** Island window: velocity of the window during a drag and its throw (~60 Hz). */
export const onIslandMotion = (handler: (motion: IslandMotion) => void) =>
  subscribe<IslandMotion>(DESKTOP_EVENTS.islandMotion, handler)


/** Main window: go to this route (sent by openMainAt). */
export const onNavigate = (handler: (payload: NavigatePayload) => void) =>
  subscribe<NavigatePayload>(DESKTOP_EVENTS.navigate, handler)

/** Island window: « Afficher les déploiements dans l’île » toggled in the tray menu. */
export const onDeploymentsEnabled = (handler: (state: DeploymentsEnabledState) => void) =>
  subscribe<DeploymentsEnabledState>(DESKTOP_EVENTS.deploymentsEnabled, handler)

export const onFocusMode = (handler: (state: FocusModeState) => void) =>
  subscribe<FocusModeState>(DESKTOP_EVENTS.focusMode, handler)

/** Island window: what is playing changed (sent on change only, not as a position ticker). */
export const onMusic = (handler: (state: MusicState | null) => void) =>
  subscribe<MusicState | null>(DESKTOP_EVENTS.music, handler)

export const onSpotify = (handler: (status: SpotifyStatus) => void) =>
  subscribe<SpotifyStatus>(DESKTOP_EVENTS.spotify, handler)

/** Island window: the refresh token rotated (save it on the account) or was refused (re-read the row). */
export const onSpotifyToken = (handler: (change: SpotifyTokenChange) => void) =>
  subscribe<SpotifyTokenChange>(DESKTOP_EVENTS.spotifyToken, handler)

export const onRecordingMarkers = (handler: (markers: RecordingMarkers) => void) =>
  subscribe<RecordingMarkers>(DESKTOP_EVENTS.recordingMarkers, handler)

export const onGoogle = (handler: (status: GoogleStatus) => void) =>
  subscribe<GoogleStatus>(DESKTOP_EVENTS.google, handler)

/** Island window: live bands and beat of the music played by this computer (Windows), ~30 per second. */
export const onMusicLevels = (handler: (levels: MusicLevels) => void) =>
  subscribe<MusicLevels>(DESKTOP_EVENTS.musicLevels, handler)

/** Main window: the update state changed. */
export const onUpdateStatus = (handler: (status: UpdateStatus) => void) =>
  subscribe<UpdateStatus>(DESKTOP_EVENTS.updateStatus, handler)

export const onClaude = (handler: (event: ClaudeRelayEvent) => void) =>
  subscribe<ClaudeRelayEvent>(DESKTOP_EVENTS.claude, handler)

export const onClaudeConnection = (handler: (connection: ClaudeConnection) => void) =>
  subscribe<ClaudeConnection>(DESKTOP_EVENTS.claudeConnection, handler)

/** Label of the window this code runs in (DESKTOP_WINDOWS). */
export function currentWindowLabel(): string {
  return getCurrentWindow().label
}
