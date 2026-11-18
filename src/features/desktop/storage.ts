import type { RecordingResult } from '../../shared/desktop-contract'

const LAST_PROJECT_KEY = 'sordulo.desktop.lastProjectId'
const PENDING_KEY = 'sordulo.desktop.pendingRecording'

export function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function writeLastProjectId(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
  } catch {
    // Storage unavailable: the default project just won't be remembered.
  }
}

/** A recording stopped but not yet sent (kept so a retry never loses the file). */
export function readPendingRecording(): RecordingResult | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RecordingResult> | null
    if (value && typeof value.path === 'string' && typeof value.projectId === 'string') {
      return value as RecordingResult
    }
    return null
  } catch {
    return null
  }
}

export function writePendingRecording(result: RecordingResult | null): void {
  try {
    if (result) localStorage.setItem(PENDING_KEY, JSON.stringify(result))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage unavailable: the retry still works while the window stays open.
  }
}
