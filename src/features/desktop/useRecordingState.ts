import { useEffect, useState } from 'react'
import { getStatus, isDesktop, onRecordingState } from '../../lib/desktop'
import type { RecordingState } from '../../shared/desktop-contract'

/** Live recording state from the Tauri shell; null outside Tauri or before the first answer. */
export function useRecordingState(): RecordingState | null {
  const [state, setState] = useState<RecordingState | null>(null)
  useEffect(() => {
    if (!isDesktop()) return
    let active = true
    let unlisten: (() => void) | null = null
    void onRecordingState((next) => active && setState(next)).then((off) => {
      if (active) unlisten = off
      else off()
    })
    void getStatus()
      .then((status) => active && setState((prev) => prev ?? status.recording))
      .catch(() => undefined)
    return () => {
      active = false
      unlisten?.()
    }
  }, [])
  return state
}

export function formatElapsed(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
