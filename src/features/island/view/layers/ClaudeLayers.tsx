/**
 * Couches Claude Code : session (agent, agentOpen), demande d'autorisation (agentAsk, agentAskCall),
 * plusieurs sessions (multi, multiOpen). L'icône Claude, les points, le temps écoulé et les pastilles sont
 * des éléments partagés (SharedElements).
 */
import { MAX_SESSION_ROWS } from '../../geometry'
import type { ClaudeSession, PermissionAsk, PermissionDecision } from '../../types'
import { cx } from '../cx'
import { useLastNonNull } from '../hooks'
import styles from '../Island.module.css'
import { sessionsSummary, sessionsTitle } from '../labels'
import { Layer } from '../Layer'
import type { BaseLayerProps } from './CallLayers'

function agentTitle(session: ClaudeSession | null): string {
  switch (session?.status) {
    case 'done':
      return 'Claude a terminé'
    case 'idle':
      return 'Claude attend tes consignes'
    case 'waiting':
      return 'Claude demande l’autorisation'
    case 'sleep':
      return 'Session inactive'
    default:
      return 'Claude travaille'
  }
}

function projectLine(session: ClaudeSession | null): string {
  if (!session) return ''
  return session.branch ? `${session.projectName}, branche ${session.branch}` : session.projectName
}

export function AgentLayer({ session, open, ...base }: BaseLayerProps & { session: ClaudeSession | null; open: boolean }) {
  const shown = useLastNonNull(session)
  return (
    <Layer {...base} state="agent" open={open} label="Session Claude en cours">
      <div className={styles.detail}>
        <div className={styles.headText}>
          <strong>{agentTitle(shown)}</strong>
          <small>{projectLine(shown)}</small>
        </div>
        <div className={styles.step}>
          {shown?.status === 'working' ? <i className={styles.spin} aria-hidden="true" /> : null}
          <span>{shown?.step ?? shown?.task ?? 'Session en cours'}</span>
        </div>
      </div>
    </Layer>
  )
}

export function AskLayer({
  ask,
  sessions,
  askPosition,
  onAskDecision,
  ...base
}: BaseLayerProps & {
  ask: PermissionAsk | null
  sessions: readonly ClaudeSession[]
  askPosition: { index: number; total: number } | null
  onAskDecision: (decision: PermissionDecision, ask: PermissionAsk) => void
}) {
  const shown = useLastNonNull(ask)
  const multiple = sessions.length > 1
  const idx = shown ? sessions.findIndex((s) => s.id === shown.sessionId) : -1
  const asking = idx >= 0 ? sessions[idx] : undefined
  // Prototype : « <projet>, session 3 sur 5 » quand plusieurs sessions tournent, puis « , 1 sur N » si d'autres attendent.
  let sub = multiple && asking ? `${asking.projectName}, session ${idx + 1} sur ${sessions.length}` : (shown?.title ?? '')
  if (askPosition && askPosition.total > 1) sub += `, ${askPosition.index} sur ${askPosition.total}`
  const decide = (decision: PermissionDecision) => {
    if (shown) onAskDecision(decision, shown)
  }
  return (
    <Layer
      {...base}
      state="agentAsk"
      className={cx(styles.layerAsk, base.withCall && styles.withCall)}
      role="dialog"
      label="Claude demande l’autorisation"
    >
      <span className={styles.notifCall} aria-hidden="true" />
      <div className={styles.headText}>
        <strong>Claude demande l’autorisation</strong>
        <small>{sub}</small>
      </div>
      <div className={styles.code} title={shown?.summary}>
        <span>{shown?.summary}</span>
      </div>
      <div className={styles.askRow}>
        {multiple && (
          <button type="button" className={cx(styles.btn, styles.btnGhost, styles.later)} onClick={() => decide('later')}>
            Plus tard
          </button>
        )}
        <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={() => decide('deny')}>
          Refuser
        </button>
        <button type="button" className={cx(styles.btn, styles.btnMain)} onClick={() => decide('allow')}>
          Autoriser
        </button>
      </div>
    </Layer>
  )
}

function SessionStatus({
  session,
  onAnswerSession,
  elapsedRef,
}: {
  session: ClaudeSession
  onAnswerSession: (sessionId: string) => void
  elapsedRef: (sessionId: string, el: HTMLElement | null) => void
}) {
  const { status } = session
  if (status === 'working' && session.conflict) return <span className={cx(styles.st, styles.stConflict)}>Conflit</span>
  if (status === 'working' && session.error) return <span className={cx(styles.st, styles.stError)}>Bloquée</span>
  if (status === 'working') {
    // Temps écoulé écrit par la boucle, React ne rend pas de texte ici.
    return <span key="elapsed" className={styles.st} ref={(el) => elapsedRef(session.id, el)} />
  }
  if (status === 'waiting') {
    return (
      <button
        type="button"
        className={cx(styles.btn, styles.btnMain, styles.btnSm, styles.rowBtn)}
        onClick={() => onAnswerSession(session.id)}
        aria-label={`Répondre à la session ${session.projectName}`}
      >
        Répondre
      </button>
    )
  }
  if (status === 'done') return <span className={cx(styles.st, styles.stDone)}>Terminé</span>
  if (status === 'idle') return <span className={styles.st}>En pause</span>
  return <span className={styles.st}>Inactive</span>
}

export function MultiLayer({
  sessions,
  open,
  onAnswerSession,
  elapsedRef,
  ...base
}: BaseLayerProps & {
  sessions: readonly ClaudeSession[]
  open: boolean
  onAnswerSession: (sessionId: string) => void
  elapsedRef: (sessionId: string, el: HTMLElement | null) => void
}) {
  const title = sessionsTitle(sessions.length)
  return (
    <Layer {...base} state="multi" open={open} label={title}>
      <div className={styles.detail}>
        <div className={styles.headText}>
          <strong>{title}</strong>
          <small>{sessionsSummary(sessions)}</small>
        </div>
        <div className={styles.rows}>
          {sessions.slice(0, MAX_SESSION_ROWS).map((s) => (
            <div key={s.id} className={styles.row}>
              <b>{s.projectName}</b>
              <span className={styles.task}>{s.task ?? s.step ?? ''}</span>
              <SessionStatus session={s} onAnswerSession={onAnswerSession} elapsedRef={elapsedRef} />
            </div>
          ))}
        </div>
      </div>
    </Layer>
  )
}
