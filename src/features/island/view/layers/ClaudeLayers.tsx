/**
 * Couches Claude Code : session (agent, agentOpen), demande d'autorisation (agentAsk, agentAskCall),
 * plusieurs sessions (multi, multiOpen). L'icône Claude, les points, le temps écoulé et les pastilles sont
 * des éléments partagés (SharedElements).
 */
import { useState } from 'react'
import { MAX_SESSION_ROWS } from '../../geometry'
import type { ClaudeSession, PermissionAsk, PermissionDecision, QuestionAnswers } from '../../types'
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
    case 'background':
      return 'Claude patiente'
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

/** Nom accessible d'un clic qui ouvre la fenêtre VS Code d'une session. */
function openLabel(session: ClaudeSession): string {
  return `Ouvrir ${session.projectName} dans son éditeur`
}

export function AgentLayer({
  session,
  open,
  onOpenSession,
  onAnswerSession,
  ...base
}: BaseLayerProps & {
  session: ClaudeSession | null
  open: boolean
  onOpenSession: (sessionId: string) => void
  onAnswerSession: (sessionId: string) => void
}) {
  const shown = useLastNonNull(session)
  // Session qui attend une réponse (demande mise de côté au bout de 10 s) : le clic remontre la demande.
  const waiting = shown?.status === 'waiting'
  return (
    <Layer {...base} state="agent" open={open} label="Session Claude en cours">
      {/* Toute la session est cliquable : sa fenêtre VS Code passe au premier plan, ou sa demande revient. */}
      <button
        type="button"
        className={cx(styles.detail, styles.openArea)}
        onClick={() => shown && (waiting ? onAnswerSession(shown.id) : onOpenSession(shown.id))}
        aria-label={shown ? (waiting ? `Répondre à la session ${shown.projectName}` : openLabel(shown)) : undefined}
      >
        <span className={styles.headText}>
          <strong>{agentTitle(shown)}</strong>
          <small>{projectLine(shown)}</small>
        </span>
        <span className={styles.step}>
          {shown?.status === 'working' ? <i className={styles.spin} aria-hidden="true" /> : null}
          <span>{shown?.step ?? shown?.task ?? 'Session en cours'}</span>
        </span>
      </button>
    </Layer>
  )
}

/**
 * Questions à choix de Claude (AskUserQuestion) : une question à la fois, ses choix en boutons. Choix
 * simple : un clic répond. Choix multiple : on coche, puis « Valider ». La dernière réponse envoie tout
 * (« allow » + réponses). « Dans le terminal » rend la main à Claude Code, qui pose alors sa question.
 */
function QuestionForm({
  ask,
  onAnswer,
  onLater,
}: {
  ask: PermissionAsk
  onAnswer: (answers: QuestionAnswers) => void
  onLater: () => void
}) {
  const questions = ask.questions ?? []
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<QuestionAnswers>({})
  const [picked, setPicked] = useState<readonly string[]>([])
  const q = questions[Math.min(step, questions.length - 1)]
  if (!q) return null

  const answer = (value: string) => {
    const next = { ...answers, [q.question]: value }
    if (step + 1 < questions.length) {
      setAnswers(next)
      setStep(step + 1)
      setPicked([])
    } else {
      onAnswer(next)
    }
  }
  const toggle = (label: string) =>
    setPicked((current) => (current.includes(label) ? current.filter((l) => l !== label) : [...current, label]))
  const position = questions.length > 1 ? ` (${step + 1} sur ${questions.length})` : ''

  return (
    <>
      <div className={styles.headText}>
        <strong>{q.header ?? 'Claude te pose une question'}</strong>
        <small title={q.question}>
          {q.question}
          {position}
        </small>
      </div>
      <div className={styles.choices} role="group" aria-label={q.question}>
        {q.options.map((option) => {
          const on = picked.includes(option.label)
          return (
            <button
              key={option.label}
              type="button"
              className={cx(styles.btn, styles.btnSm, on ? styles.btnMain : styles.btnGhost)}
              title={option.description ?? undefined}
              aria-pressed={q.multiSelect ? on : undefined}
              onClick={() => (q.multiSelect ? toggle(option.label) : answer(option.label))}
            >
              {option.label}
            </button>
          )
        })}
        <button type="button" className={cx(styles.btn, styles.btnSm, styles.btnQuiet)} onClick={onLater}>
          Dans le terminal
        </button>
        {q.multiSelect && (
          <button
            type="button"
            className={cx(styles.btn, styles.btnSm, styles.btnMain)}
            disabled={picked.length === 0}
            onClick={() => answer(picked.join(', '))}
          >
            Valider
          </button>
        )}
      </div>
    </>
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
  onAskDecision: (decision: PermissionDecision, ask: PermissionAsk, answers?: QuestionAnswers) => void
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
      // Taille de la couche : la haute (celle de l'appel) pour une question, comme la forme (Island.tsx).
      withCall={base.withCall || Boolean(shown?.questions)}
      state="agentAsk"
      className={cx(styles.layerAsk, base.withCall && styles.withCall)}
      role="dialog"
      label={shown?.questions ? 'Claude te pose une question' : 'Claude demande l’autorisation'}
    >
      <span className={styles.notifCall} aria-hidden="true" />
      {shown?.questions ? (
        // La clé repart de la première question à chaque nouvelle demande.
        <QuestionForm
          key={shown.id}
          ask={shown}
          onAnswer={(answers) => onAskDecision('allow', shown, answers)}
          onLater={() => decide('later')}
        />
      ) : (
        <>
          <div className={styles.headText}>
            <strong>Claude demande l’autorisation</strong>
            <small>{sub}</small>
          </div>
          <div className={styles.code} title={shown?.summary}>
            <span>{shown?.summary}</span>
          </div>
        </>
      )}
      <div className={cx(styles.askRow, shown?.questions && styles.askRowHidden)}>
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
  if (status === 'background') return <span className={styles.st}>Patiente</span>
  if (status === 'done') return <span className={cx(styles.st, styles.stDone)}>Terminé</span>
  if (status === 'idle') return <span className={styles.st}>En pause</span>
  return <span className={styles.st}>Inactive</span>
}

export function MultiLayer({
  sessions,
  open,
  onAnswerSession,
  onOpenSession,
  elapsedRef,
  ...base
}: BaseLayerProps & {
  sessions: readonly ClaudeSession[]
  open: boolean
  onAnswerSession: (sessionId: string) => void
  onOpenSession: (sessionId: string) => void
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
              {/* Nom et tâche : ouvrent la fenêtre VS Code de la session (« Répondre » reste à part). */}
              <button type="button" className={styles.rowOpen} onClick={() => onOpenSession(s.id)} aria-label={openLabel(s)}>
                <b>{s.projectName}</b>
                <span className={styles.task}>{s.task ?? s.step ?? ''}</span>
              </button>
              <SessionStatus session={s} onAnswerSession={onAnswerSession} elapsedRef={elapsedRef} />
            </div>
          ))}
        </div>
      </div>
    </Layer>
  )
}
