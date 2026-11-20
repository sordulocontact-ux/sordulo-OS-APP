/**
 * Typed wrappers around the Tauri IPC (contract: src/shared/desktop-contract.ts).
 * Never call them outside Tauri: guard every call site with isDesktop().
 * Importing the Tauri modules has no side effect: nothing runs until a wrapper is called.
 */
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSyncExternalStore } from 'react'
import {
  DESKTOP_COMMANDS,
  DESKTOP_EVENTS,
  type AudioLevel,
  type ClaudeConnection,
  type ClaudeDecision,
  type ClaudeRelayEvent,
  type DesktopStatus,
  type FocusModeState,
  type IslandHitRects,
  type IslandPointer,
  type MicState,
  type NavigatePayload,
  type PromptPayload,
  type RecordingResult,
  type RecordingState,
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

/** Shows and focuses the main window, then sends it DESKTOP_EVENTS.navigate (route must start with "/"). */
export const openMainAt = (args: NavigatePayload) => call<void>(DESKTOP_COMMANDS.openMainAt, { route: args.route })

export const getFocusMode = () => call<FocusModeState>(DESKTOP_COMMANDS.getFocusMode)

/** Also updates the tray menu check and emits DESKTOP_EVENTS.focusMode to the island. */
export const setFocusMode = (args: FocusModeState) =>
  call<FocusModeState>(DESKTOP_COMMANDS.setFocusMode, { on: args.on })

export const claudeGetConnection = () => call<ClaudeConnection>(DESKTOP_COMMANDS.claudeGetConnection)

/** Answers a pending PermissionRequest (requestId from the ClaudeRelayEvent). */
export const claudeAnswer = (args: { requestId: string; decision: ClaudeDecision }) =>
  call<void>(DESKTOP_COMMANDS.claudeAnswer, args)

/** Bytes of an audio file dropped on the island (audio extensions only). */
export const readDroppedAudio = (path: string) => callBytes(DESKTOP_COMMANDS.readDroppedAudio, { path })

/** Island window: copies text to the system clipboard (no focus or user gesture needed). */
export const copyText = (text: string) => call<void>(DESKTOP_COMMANDS.copyText, { text })

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

/** Main window: go to this route (sent by openMainAt). */
export const onNavigate = (handler: (payload: NavigatePayload) => void) =>
  subscribe<NavigatePayload>(DESKTOP_EVENTS.navigate, handler)

export const onFocusMode = (handler: (state: FocusModeState) => void) =>
  subscribe<FocusModeState>(DESKTOP_EVENTS.focusMode, handler)

export const onClaude = (handler: (event: ClaudeRelayEvent) => void) =>
  subscribe<ClaudeRelayEvent>(DESKTOP_EVENTS.claude, handler)

export const onClaudeConnection = (handler: (connection: ClaudeConnection) => void) =>
  subscribe<ClaudeConnection>(DESKTOP_EVENTS.claudeConnection, handler)

/** Label of the window this code runs in (DESKTOP_WINDOWS). */
export function currentWindowLabel(): string {
  return getCurrentWindow().label
}
