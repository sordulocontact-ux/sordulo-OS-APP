/**
 * Sessions Claude Code de l'île, à partir des hooks relayés par l'app (ClaudeRelayEvent, voir
 * src/shared/desktop-contract.ts). Pur : ni React ni Tauri ; testé dans sessions.test.ts.
 *
 * `reduceClaude(state, input)` renvoie le nouvel état et des **effets** que la source du contrôleur
 * (controller/sources/claude.ts) applique : demande d'autorisation à montrer ou à fermer, notification.
 *
 * Règles
 * - Une session naît à SessionStart, ou au premier événement d'une session inconnue ; elle disparaît à
 *   SessionEnd, ou après FORGET_AFTER_MS sans aucun événement (terminal fermé sans SessionEnd).
 * - Projet : projet Sordulo OS dont le nom correspond au dossier (./projects.ts), sinon le nom du dossier.
 * - Tâche : début du premier prompt (UserPromptSubmit). Étape : dernier outil, en français (./steps.ts).
 * - `startedAt` : début du tour en cours (dernier prompt), sinon de la session ; le temps écoulé en part.
 * - Statut : `working` pendant le travail ; `waiting` pendant une demande d'autorisation (et après « Plus
 *   tard » ou un délai écoulé, tant que Claude Code attend la réponse dans le terminal) ; `done` après Stop ;
 *   `idle` (« En pause ») après un refus, et pour une session qui vient de démarrer sans prompt ; `sleep`
 *   (« Inactive ») après SLEEP_AFTER_MS sans événement. `error` : commande refusée (le relais ne dit pas
 *   quand un outil échoue : PostToolUse n'arrive qu'en cas de succès et le contrat ne porte pas l'erreur).
 * - Sous-agents : PreToolUse Task / Agent → +1, SubagentStop → -1, Stop → 0.
 * - Fichiers modifiés : chemins distincts écrits (PostToolUse Edit / Write / MultiEdit / NotebookEdit)
 *   pendant le tour, du prompt au Stop (« Claude a terminé : N fichiers modifiés »).
 * - Conflit : deux sessions éveillées, chacune en plein tour (depuis son dernier prompt, avant son Stop), ont
 *   écrit le même fichier → `conflict` sur les deux et une notification par paire et par fichier.
 * - Notifications : Stop → « Claude a terminé » (une seule session) ou « Une session a terminé » (plusieurs) ;
 *   Notification de Claude Code qui attend une consigne → « Claude attend tes consignes » (une fois par tour) ;
 *   refus depuis l'île d'une session seule → « Claude attend tes consignes », « Commande refusée : … ».
 */
import type { ClaudeRelayEvent } from '../../../shared/desktop-contract'
import { CLAUDE_PERMISSION_TIMEOUT_MS } from '../../../shared/desktop-contract'
import type { ClaudeSession, PermissionAsk, PermissionDecision } from '../types'
import { matchProject, type ClaudeProjectRef } from './projects'
import {
  askSummary,
  askTitle,
  describeStep,
  fileName,
  filesModifiedLabel,
  isSubagentTool,
  isWaitingForInput,
  isWriteTool,
  refusalLabel,
  TASK_MAX_CHARS,
  truncate,
} from './steps'

/** Sans événement depuis 15 min, une session passe « Inactive » (pause café, réunion, terminal oublié). */
export const SLEEP_AFTER_MS = 15 * 60_000
/** Sans événement depuis 3 h, la session est oubliée (fermée sans SessionEnd : terminal tué, plantage). */
export const FORGET_AFTER_MS = 3 * 60 * 60_000

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

export interface ClaudeSessionRecord {
  /** Ce que lit le rendu. Nouvel objet seulement quand un champ change. */
  readonly session: ClaudeSession
  /** Dernier hook reçu de cette session (epoch ms). */
  readonly lastEventAt: number
  /** Fichiers écrits pendant le tour : clé normalisée → chemin reçu. */
  readonly turnFiles: ReadonlyMap<string, string>
  /** Entre le prompt (ou le premier outil) et le Stop. */
  readonly inTurn: boolean
  /** Demandes d'autorisation encore ouvertes côté relais (réponse possible depuis l'île). */
  readonly pending: readonly PermissionAsk[]
  /** Une demande a été rendue au terminal (« Plus tard », délai écoulé) et Claude Code n'a pas repris. */
  readonly handedToTerminal: boolean
  /** « Claude attend tes consignes » déjà montré pendant ce tour. */
  readonly idleNotified: boolean
}

export interface ClaudeState {
  /** Ordre d'arrivée : « session 1 », « session 2 »… dans les textes et les lignes de multiOpen. */
  readonly records: readonly ClaudeSessionRecord[]
  readonly projects: readonly ClaudeProjectRef[]
  /** Conflits déjà notifiés : « idA|idB|fichier ». */
  readonly notifiedConflicts: ReadonlySet<string>
}

export const INITIAL_CLAUDE_STATE: ClaudeState = {
  records: [],
  projects: [],
  notifiedConflicts: new Set(),
}

// ---------------------------------------------------------------------------
// Entrées et effets
// ---------------------------------------------------------------------------

export type ClaudeInput =
  /** Hook relayé (ou PermissionCancelled émis par l'app). */
  | { type: 'event'; event: ClaudeRelayEvent }
  /** Décision prise dans l'île (déjà renvoyée au relais par la source). */
  | { type: 'decision'; requestId: string; decision: PermissionDecision }
  /** Minuteur local de la demande échu (le relais a rendu la main au terminal). */
  | { type: 'askExpired'; requestId: string }
  /** Passage du temps (sessions inactives, oubliées). */
  | { type: 'tick'; at: number }
  /** Projets Sordulo OS visibles (connexion, changement de liste). */
  | { type: 'projects'; projects: readonly ClaudeProjectRef[] }

export type ClaudeNotificationKind = 'claudeDone' | 'claudeStop' | 'multiDone' | 'conflict'

export type ClaudeEffect =
  | { type: 'requestAsk'; ask: PermissionAsk }
  | { type: 'resolveAsk'; requestId: string }
  | {
      type: 'notify'
      kind: ClaudeNotificationKind
      /** Session concernée (clic : sa fenêtre VS Code). */
      sessionId: string
      projectName: string
      detail: string
      /** Remplace le sous-titre « projet : détail » du catalogue (refus : « Commande refusée : … »). */
      subtitle?: string
    }

export interface ClaudeTransition {
  state: ClaudeState
  effects: ClaudeEffect[]
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function sessionsOf(state: ClaudeState): ClaudeSession[] {
  return state.records.map((record) => record.session)
}

export function findRecord(state: ClaudeState, sessionId: string): ClaudeSessionRecord | null {
  return state.records.find((record) => record.session.id === sessionId) ?? null
}

/** Première demande encore ouverte d'une session (réponse possible depuis l'île). */
export function pendingAskOf(state: ClaudeState, sessionId: string): PermissionAsk | null {
  return findRecord(state, sessionId)?.pending[0] ?? null
}

export function findPendingAsk(state: ClaudeState, requestId: string): PermissionAsk | null {
  for (const record of state.records) {
    const ask = record.pending.find((p) => p.id === requestId)
    if (ask) return ask
  }
  return null
}

/**
 * Activité Claude de l'île : une session → `agent`, plusieurs → `multi`. Rien tant qu'aucune session ne
 * travaille ni n'attend de réponse (demande de Maël : rien ne tourne, rien dans l'île) ; la fin d'un tour
 * est annoncée par la notification « Claude a terminé ».
 *
 * Une session seule qui a des sous-agents passe aussi en `multi` : le jardin montre son personnage et ses
 * sous-agents qui se promènent (demande de Maël, 21/11). `keepGarden` : elle vient d'en avoir, on reste
 * dans le jardin un moment (la source gère le délai) pour ne pas faire changer l'île de taille entre deux
 * sous-agents lancés l'un après l'autre.
 */
export type ClaudeActivityTarget = { kind: 'agent'; sessionId: string } | { kind: 'multi' } | null

export function claudeActivityFor(sessions: readonly ClaudeSession[], keepGarden = false): ClaudeActivityTarget {
  if (!sessions.some((s) => s.status === 'working' || s.status === 'waiting')) return null
  const only = sessions.length === 1 ? sessions[0] : undefined
  if (only && only.subagents === 0 && !keepGarden) return { kind: 'agent', sessionId: only.id }
  return { kind: 'multi' }
}

/** Session seule qui a des sous-agents en cours (le jardin la montre avec eux). */
export function soloWithSubagents(sessions: readonly ClaudeSession[]): boolean {
  return sessions.length === 1 && (sessions[0]?.subagents ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Outils internes
// ---------------------------------------------------------------------------

/** Clé de comparaison d'un chemin (Windows : sans casse, barres obliques). */
export function fileKey(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function patchSession(session: ClaudeSession, patch: Partial<ClaudeSession>): ClaudeSession {
  const keys = Object.keys(patch) as (keyof ClaudeSession)[]
  if (keys.every((key) => Object.is(patch[key], session[key]))) return session
  return { ...session, ...patch }
}

function withSession(record: ClaudeSessionRecord, patch: Partial<ClaudeSession>): ClaudeSessionRecord {
  const session = patchSession(record.session, patch)
  return session === record.session ? record : { ...record, session }
}

function replaceRecord(state: ClaudeState, next: ClaudeSessionRecord): ClaudeState {
  const index = state.records.findIndex((r) => r.session.id === next.session.id)
  if (index < 0) return { ...state, records: [...state.records, next] }
  if (state.records[index] === next) return state
  const records = state.records.slice()
  records[index] = next
  return { ...state, records }
}

function removeRecord(state: ClaudeState, sessionId: string): ClaudeState {
  return { ...state, records: state.records.filter((r) => r.session.id !== sessionId) }
}

function resolveAll(record: ClaudeSessionRecord, effects: ClaudeEffect[]): void {
  for (const ask of record.pending) effects.push({ type: 'resolveAsk', requestId: ask.id })
}

function createRecord(event: ClaudeRelayEvent, projects: readonly ClaudeProjectRef[]): ClaudeSessionRecord {
  const { projectName, projectId } = matchProject(event.cwd, projects)
  return {
    session: {
      id: event.sessionId,
      projectName,
      projectId,
      cwd: event.cwd ?? '',
      branch: event.branch,
      task: null,
      step: null,
      status: 'idle',
      startedAt: event.at,
      conflict: false,
      error: false,
      subagents: 0,
    },
    lastEventAt: event.at,
    turnFiles: new Map(),
    inTurn: false,
    pending: [],
    handedToTerminal: false,
    idleNotified: false,
  }
}

/** Dossier, branche, heure du dernier événement ; le projet suit le dossier. */
function touch(record: ClaudeSessionRecord, event: ClaudeRelayEvent, projects: readonly ClaudeProjectRef[]) {
  const patch: Partial<ClaudeSession> = {}
  if (event.cwd && event.cwd !== record.session.cwd) {
    patch.cwd = event.cwd
    Object.assign(patch, matchProject(event.cwd, projects))
  }
  if (event.branch !== null) patch.branch = event.branch
  const next = withSession(record, patch)
  return { ...next, lastEventAt: Math.max(record.lastEventAt, event.at) }
}

function statusAfterAsks(pending: readonly PermissionAsk[]): ClaudeSession['status'] {
  return pending.length > 0 ? 'waiting' : 'working'
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

function onEvent(state: ClaudeState, event: ClaudeRelayEvent, effects: ClaudeEffect[]): ClaudeState {
  if (!event.sessionId) return state
  if (event.event === 'PermissionCancelled') {
    return event.requestId ? closeAsk(state, event.requestId, effects) : state
  }
  const existing = findRecord(state, event.sessionId)
  if (event.event === 'SessionEnd') {
    if (!existing) return state
    resolveAll(existing, effects)
    return removeRecord(state, event.sessionId)
  }

  let record = touch(existing ?? createRecord(event, state.projects), event, state.projects)
  const { session } = record

  switch (event.event) {
    case 'SessionStart':
      // Aussi envoyé à la reprise et après un compactage : le travail en cours ne change pas.
      if (session.status === 'sleep') record = withSession(record, { status: 'idle' })
      break

    case 'UserPromptSubmit':
      resolveAll(record, effects)
      record = {
        ...withSession(record, {
          status: 'working',
          task: session.task ?? (event.message ? truncate(event.message, TASK_MAX_CHARS) : null),
          step: null,
          startedAt: event.at,
          error: false,
        }),
        turnFiles: new Map(),
        inTurn: true,
        pending: [],
        handedToTerminal: false,
        idleNotified: false,
      }
      break

    case 'PreToolUse':
      record = {
        ...withSession(record, {
          status: statusAfterAsks(record.pending),
          step: describeStep(event.toolName, event.toolSummary, record.session.cwd || null) ?? session.step,
          error: false,
          subagents: session.subagents + (isSubagentTool(event.toolName) ? 1 : 0),
        }),
        inTurn: true,
        handedToTerminal: false,
      }
      break

    case 'PostToolUse': {
      // L'outil a tourné : une demande ouverte pour le même outil est passée (réponse dans le terminal).
      const done = record.pending.filter((ask) => ask.toolName === event.toolName)
      for (const ask of done) effects.push({ type: 'resolveAsk', requestId: ask.id })
      const pending = record.pending.filter((ask) => ask.toolName !== event.toolName)
      let turnFiles = record.turnFiles
      if (isWriteTool(event.toolName) && event.filePath) {
        const key = fileKey(event.filePath)
        if (!turnFiles.has(key)) turnFiles = new Map(turnFiles).set(key, event.filePath)
      }
      record = {
        ...withSession(record, { status: statusAfterAsks(pending), error: false }),
        pending,
        turnFiles,
        inTurn: true,
        handedToTerminal: false,
      }
      break
    }

    case 'PermissionRequest': {
      let pending = record.pending
      if (event.requestId && !pending.some((ask) => ask.id === event.requestId)) {
        const toolName = event.toolName ?? 'Outil'
        const ask: PermissionAsk = {
          id: event.requestId,
          sessionId: session.id,
          toolName,
          summary: askSummary(toolName, event.toolSummary, record.session.cwd || null),
          title: askTitle(toolName, record.session.projectName),
          receivedAt: event.at,
          expiresAt: event.at + CLAUDE_PERMISSION_TIMEOUT_MS,
          questions: event.questions && event.questions.length > 0 ? event.questions : null,
        }
        pending = [...pending, ask]
        effects.push({ type: 'requestAsk', ask })
      }
      record = { ...withSession(record, { status: 'waiting' }), pending, handedToTerminal: false }
      break
    }

    case 'Notification':
      if (isWaitingForInput(event.message) && !record.idleNotified) {
        effects.push({
          type: 'notify',
          kind: 'claudeStop',
          sessionId: record.session.id,
          projectName: record.session.projectName,
          detail: '',
        })
        record = { ...record, idleNotified: true }
      }
      break

    case 'Stop': {
      resolveAll(record, effects)
      const files = record.turnFiles.size
      record = {
        ...withSession(record, { status: 'done', step: null, subagents: 0, error: false }),
        pending: [],
        inTurn: false,
        handedToTerminal: false,
      }
      const alone = state.records.filter((r) => r.session.id !== session.id).length === 0
      const filesDetail = files > 0 ? filesModifiedLabel(files) : ''
      effects.push(
        alone
          ? {
              type: 'notify',
              kind: 'claudeDone',
              sessionId: record.session.id,
              projectName: record.session.projectName,
              detail: filesDetail,
            }
          : {
              type: 'notify',
              kind: 'multiDone',
              sessionId: record.session.id,
              projectName: record.session.projectName,
              detail: record.session.task ?? filesDetail,
            },
      )
      break
    }

    case 'SubagentStop':
      record = withSession(record, { subagents: Math.max(0, session.subagents - 1) })
      if (record.session.status === 'sleep') record = withSession(record, { status: 'working' })
      break
  }

  return replaceRecord(state, record)
}

/** Demande finie sans réponse de l'île (délai, relais qui raccroche) : Claude Code demande dans le terminal. */
function closeAsk(state: ClaudeState, requestId: string, effects: ClaudeEffect[]): ClaudeState {
  const record = state.records.find((r) => r.pending.some((ask) => ask.id === requestId))
  if (!record) return state
  effects.push({ type: 'resolveAsk', requestId })
  const pending = record.pending.filter((ask) => ask.id !== requestId)
  return replaceRecord(state, {
    ...record,
    pending,
    handedToTerminal: pending.length === 0 && record.session.status === 'waiting' ? true : record.handedToTerminal,
  })
}

function onDecision(
  state: ClaudeState,
  requestId: string,
  decision: PermissionDecision,
  effects: ClaudeEffect[],
): ClaudeState {
  const record = state.records.find((r) => r.pending.some((ask) => ask.id === requestId))
  const ask = record?.pending.find((p) => p.id === requestId)
  if (!record || !ask) return state
  effects.push({ type: 'resolveAsk', requestId })
  const pending = record.pending.filter((p) => p.id !== requestId)
  const base = { ...record, pending }
  switch (decision) {
    case 'allow':
      return replaceRecord(state, withSession(base, { status: statusAfterAsks(pending), error: false }))
    case 'later':
      return replaceRecord(state, {
        ...withSession(base, { status: 'waiting' }),
        handedToTerminal: pending.length === 0,
      })
    case 'deny': {
      const refusal = `${refusalLabel(ask.toolName)} : ${ask.summary}`
      if (state.records.length === 1) {
        effects.push({
          type: 'notify',
          kind: 'claudeStop',
          sessionId: record.session.id,
          projectName: record.session.projectName,
          detail: refusal,
          subtitle: refusal,
        })
      }
      return replaceRecord(
        state,
        withSession(base, { status: pending.length > 0 ? 'waiting' : 'idle', error: true, step: refusal }),
      )
    }
  }
}

function onTick(state: ClaudeState, at: number, effects: ClaudeEffect[]): ClaudeState {
  let next = state
  for (const record of state.records) {
    const quiet = at - record.lastEventAt
    if (quiet >= FORGET_AFTER_MS) {
      resolveAll(record, effects)
      next = removeRecord(next, record.session.id)
    } else if (quiet >= SLEEP_AFTER_MS && record.pending.length === 0 && record.session.status !== 'sleep') {
      next = replaceRecord(next, withSession(record, { status: 'sleep' }))
    }
  }
  return next
}

function onProjects(state: ClaudeState, projects: readonly ClaudeProjectRef[]): ClaudeState {
  let next: ClaudeState = { ...state, projects }
  for (const record of state.records) {
    next = replaceRecord(next, withSession(record, matchProject(record.session.cwd || null, projects)))
  }
  return next
}

// ---------------------------------------------------------------------------
// Conflits
// ---------------------------------------------------------------------------

function updateConflicts(state: ClaudeState, effects: ClaudeEffect[]): ClaudeState {
  const { records } = state
  const conflicted = new Set<string>()
  const ids = new Set(records.map((r) => r.session.id))
  // Oublie les conflits des sessions disparues.
  const notified = new Set(
    [...state.notifiedConflicts].filter((key) => {
      const [a, b] = key.split('|')
      return ids.has(a ?? '') && ids.has(b ?? '')
    }),
  )
  const active = (r: ClaudeSessionRecord) => r.inTurn && r.session.status !== 'sleep' && r.turnFiles.size > 0
  for (let i = 0; i < records.length; i++) {
    const a = records[i]
    if (!a || !active(a)) continue
    for (let j = i + 1; j < records.length; j++) {
      const b = records[j]
      if (!b || !active(b)) continue
      for (const [key, path] of a.turnFiles) {
        if (!b.turnFiles.has(key)) continue
        conflicted.add(a.session.id)
        conflicted.add(b.session.id)
        const id = `${a.session.id}|${b.session.id}|${key}`
        if (notified.has(id)) continue
        notified.add(id)
        effects.push({
          type: 'notify',
          kind: 'conflict',
          sessionId: a.session.id,
          projectName: a.session.projectName,
          detail: `${fileName(path)} modifié par les sessions ${i + 1} et ${j + 1}`,
        })
      }
    }
  }
  const same =
    notified.size === state.notifiedConflicts.size && [...notified].every((key) => state.notifiedConflicts.has(key))
  let next: ClaudeState = same ? state : { ...state, notifiedConflicts: notified }
  for (const record of records) {
    next = replaceRecord(next, withSession(record, { conflict: conflicted.has(record.session.id) }))
  }
  return next
}

// ---------------------------------------------------------------------------
// Réducteur
// ---------------------------------------------------------------------------

export function reduceClaude(state: ClaudeState, input: ClaudeInput): ClaudeTransition {
  const effects: ClaudeEffect[] = []
  let next: ClaudeState
  switch (input.type) {
    case 'event':
      next = onEvent(state, input.event, effects)
      break
    case 'decision':
      next = onDecision(state, input.requestId, input.decision, effects)
      break
    case 'askExpired':
      next = closeAsk(state, input.requestId, effects)
      break
    case 'tick':
      next = onTick(state, input.at, effects)
      break
    case 'projects':
      next = onProjects(state, input.projects)
      break
  }
  return { state: updateConflicts(next, effects), effects }
}
