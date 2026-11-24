import { useCallback, useEffect, useState } from 'react'
import { claudeConnect, claudeDisconnect, claudeGetConnection, isDesktop, onClaudeConnection } from '../../lib/desktop'
import type { ClaudeConnection } from '../../shared/desktop-contract'
import { describeClaudeCode, type ClaudeCodeAction, type ClaudeCodeView } from './claudeCode'

export interface ClaudeCodeConnector {
  view: ClaudeCodeView
  /** Erreur du dernier appel (connexion, déconnexion, lecture). */
  error: string | null
  run: (kind: ClaudeCodeAction) => void
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return text ? `Claude Code : ${text}` : 'Claude Code : l’opération a échoué. Réessayez.'
}

/** État vivant du relais Claude Code de cet ordinateur (app de bureau seulement). */
export function useClaudeCode(): ClaudeCodeConnector {
  const desktop = isDesktop()
  const [connection, setConnection] = useState<ClaudeConnection | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    let unlisten: (() => void) | undefined
    claudeGetConnection().then(
      (c) => alive && setConnection(c),
      (e: unknown) => alive && setError(message(e)),
    )
    onClaudeConnection((c) => {
      if (alive) {
        setConnection(c)
        setError(null)
      }
    }).then(
      (off) => (alive ? (unlisten = off) : off()),
      () => undefined,
    )
    return () => {
      alive = false
      unlisten?.()
    }
  }, [desktop])

  const run = useCallback((kind: ClaudeCodeAction) => {
    setError(null)
    setBusy(true)
    const call = kind === 'disconnect' ? claudeDisconnect() : claudeConnect()
    call.then(setConnection, (e: unknown) => setError(message(e))).finally(() => setBusy(false))
  }, [])

  return { view: describeClaudeCode(connection, { desktop, busy }), error, run }
}
