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
  type DesktopStatus,
  type MicState,
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

export async function readRecording(path: string): Promise<ArrayBuffer> {
  const raw = await call<ArrayBuffer | number[] | Uint8Array>(DESKTOP_COMMANDS.readRecording, { path })
  if (raw instanceof ArrayBuffer) return raw
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const deleteRecording = (path: string) => call<void>(DESKTOP_COMMANDS.deleteRecording, { path })

export const dismissPrompt = () => call<void>(DESKTOP_COMMANDS.dismissPrompt)

export const showMainWindow = () => call<void>(DESKTOP_COMMANDS.showMainWindow)

export const openPrompt = (args: { reason: 'manual-start' }) => call<void>(DESKTOP_COMMANDS.openPrompt, args)

/** Each returns a promise of the unsubscribe function. */
export const onPrompt = (handler: (payload: PromptPayload) => void) =>
  subscribe<PromptPayload>(DESKTOP_EVENTS.prompt, handler)

export const onRecordingState = (handler: (state: RecordingState) => void) =>
  subscribe<RecordingState>(DESKTOP_EVENTS.recordingState, handler)

export const onMicState = (handler: (state: MicState) => void) =>
  subscribe<MicState>(DESKTOP_EVENTS.micState, handler)

/** Hides the window this code runs in (prompt window). */
export async function hideCurrentWindow(): Promise<void> {
  await getCurrentWindow().hide()
}
