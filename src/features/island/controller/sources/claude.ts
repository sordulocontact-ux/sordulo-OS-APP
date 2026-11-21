/**
 * Source « Claude Code » : hooks relayés par l'app (desktop://claude) → sessions, activité Claude, demandes
 * d'autorisation et notifications. La logique des sessions est pure (../../claude, testée à part) ; ici on
 * applique ses effets à la coordination et on renvoie les décisions au relais.
 *
 * - Sessions : poussées au rendu (`view.sessions`). Une session → activité `agent` {sessionId} ; deux et
 *   plus → `multi` (sans `agent`) ; aucune, ou toutes inactives → aucune activité (l'île se repose).
 *   Une session seule avec des sous-agents → `multi` aussi (le jardin les montre), et elle y reste
 *   SUBAGENT_GARDEN_LINGER_MS après le dernier, pour ne pas faire changer l'île de taille entre deux
 *   sous-agents lancés l'un après l'autre.
 * - Demande d'autorisation (PermissionRequest) : `requestAsk`, minuteur jusqu'à `expiresAt` (60 s) puis
 *   `resolveAsk`. Fermée aussi par PermissionCancelled ou un événement qui prouve qu'elle est passée
 *   (PostToolUse du même outil, Stop, nouveau prompt, fin de session).
 * - Geste « Autoriser / Refuser / Plus tard » : `claudeAnswer` puis `resolveAsk`. « Plus tard » rend la main
 *   au terminal tout de suite (la session reste « à autoriser » jusqu'à ce que Claude Code reprenne).
 * - Geste « Répondre » (multiOpen) : montre la demande ouverte de cette session, devant les autres ; si elle
 *   a déjà été rendue au terminal, une notification le dit (« réponds dans le terminal »).
 * - Clic sur une session (agentOpen, multiOpen) ou sur une notification Claude (`openSession`) : la fenêtre
 *   VS Code (ou l'app) de la session passe au premier plan, sur son dossier (commande Rust
 *   `claude_open_session`, qui connaît le dossier et l'éditeur de chaque session).
 * - Action `showSessions` (« Voir » du conflit) : le rendu n'a pas de prop pour
 *   ouvrir agentOpen / multiOpen sans survol, donc on épingle l'activité Claude quand elle est dans
 *   `background` (elle passe devant, par exemple devant la musique), sauf pendant une activité exclusive
 *   (appel, import, analyse) ; si elle est déjà la principale, la fermeture de la notification suffit à la montrer.
 */
import { claudeAnswer, claudeOpenSession, onClaude } from '../../../../lib/desktop'
import {
  CLAUDE_PERMISSION_TIMEOUT_MS,
  type ClaudeDecision,
  type ClaudeRelayEvent,
} from '../../../../shared/desktop-contract'
import { createNotification } from '../../catalog'
import {
  claudeActivityFor,
  findRecord,
  soloWithSubagents,
  INITIAL_CLAUDE_STATE,
  pendingAskOf,
  reduceClaude,
  sessionsOf,
  type ClaudeEffect,
  type ClaudeInput,
  type ClaudeState,
} from '../../claude'
import type { TimerId } from '../../coordinator/clock'
import type { ClaudeSession, PermissionAsk } from '../../types'
import type { IslandSource, IslandSourceContext } from '../source'
import { listen } from './listen'

/** Id de l'activité d'une session seule. */
export const AGENT_ACTIVITY_ID = 'agent'
/** Id de l'activité de plusieurs sessions. */
export const MULTI_ACTIVITY_ID = 'multi'
/** Tant qu'il y a des sessions : on regarde toutes les 30 s lesquelles sont inactives ou oubliées. */
export const CLAUDE_TICK_MS = 30_000
/** Session seule : le jardin reste affiché ce temps après la fin de son dernier sous-agent. */
export const SUBAGENT_GARDEN_LINGER_MS = 8_000

/** Accès Tauri de la source (src/lib/desktop.ts), remplacés par des faux en test. */
export interface ClaudeSourceDeps {
  onClaude: (handler: (event: ClaudeRelayEvent) => void) => Promise<() => void>
  claudeAnswer: (args: { requestId: string; decision: ClaudeDecision; answers?: Record<string, string> }) => Promise<void>
  claudeOpenSession: (args: { sessionId: string }) => Promise<void>
}

function syncActivity(ctx: IslandSourceContext, sessions: readonly ClaudeSession[], keepGarden: boolean): void {
  const { coordinator } = ctx
  const target = claudeActivityFor(sessions, keepGarden)
  if (target?.kind !== 'agent') coordinator.removeActivity(AGENT_ACTIVITY_ID)
  if (target?.kind !== 'multi') coordinator.removeActivity(MULTI_ACTIVITY_ID)
  if (target?.kind === 'agent') {
    const existing = coordinator.getActivity(AGENT_ACTIVITY_ID)
    if (!existing) coordinator.addActivity({ id: AGENT_ACTIVITY_ID, kind: 'agent', sessionId: target.sessionId })
    else if (existing.kind === 'agent' && existing.sessionId !== target.sessionId) {
      coordinator.updateActivity(AGENT_ACTIVITY_ID, { sessionId: target.sessionId })
    }
  } else if (target?.kind === 'multi' && !coordinator.getActivity(MULTI_ACTIVITY_ID)) {
    coordinator.addActivity({ id: MULTI_ACTIVITY_ID, kind: 'multi' })
  }
}

export function createClaudeSource(deps: ClaudeSourceDeps): IslandSource {
  return {
    id: 'claude',
    start(ctx) {
      let state: ClaudeState = INITIAL_CLAUDE_STATE
      let shown: readonly ClaudeSession[] = []
      const askTimers = new Map<string, TimerId>()
      let tickTimer: TimerId | null = null
      // Session seule avec sous-agents : jardin jusqu'à `gardenUntil` après le dernier (0 : pas de délai).
      let soloCrew = false
      let gardenUntil = 0
      let lingerTimer: TimerId | null = null

      function clearLinger(): void {
        if (lingerTimer !== null) ctx.clock.clearTimeout(lingerTimer)
        lingerTimer = null
      }

      /** Jardin gardé pour une session seule dont les sous-agents viennent de finir ; minuteur de retour. */
      function keepGardenFor(sessions: readonly ClaudeSession[]): boolean {
        const now = ctx.clock.now()
        const crew = soloWithSubagents(sessions)
        if (soloCrew && !crew) gardenUntil = now + SUBAGENT_GARDEN_LINGER_MS
        if (crew) gardenUntil = 0
        soloCrew = crew
        const keep = !crew && sessions.length === 1 && now < gardenUntil
        if (!keep) clearLinger()
        else if (lingerTimer === null) {
          lingerTimer = ctx.clock.setTimeout(() => {
            lingerTimer = null
            if (!ctx.isDisposed()) publish()
          }, gardenUntil - now)
        }
        return keep
      }

      function publish(): void {
        const sessions = sessionsOf(state)
        const same = sessions.length === shown.length && sessions.every((s, i) => s === shown[i])
        if (!same) {
          shown = sessions
          ctx.view.patch({ sessions })
        }
        syncActivity(ctx, sessions, keepGardenFor(sessions))
      }

      function clearAskTimer(requestId: string): void {
        const timer = askTimers.get(requestId)
        if (timer === undefined) return
        ctx.clock.clearTimeout(timer)
        askTimers.delete(requestId)
      }

      function apply(effect: ClaudeEffect): void {
        switch (effect.type) {
          case 'requestAsk': {
            const { ask } = effect
            ctx.coordinator.requestAsk(ask)
            clearAskTimer(ask.id)
            const delay = Math.min(CLAUDE_PERMISSION_TIMEOUT_MS, Math.max(0, ask.expiresAt - ctx.clock.now()))
            askTimers.set(
              ask.id,
              ctx.clock.setTimeout(() => {
                askTimers.delete(ask.id)
                dispatch({ type: 'askExpired', requestId: ask.id })
              }, delay),
            )
            break
          }
          case 'resolveAsk':
            clearAskTimer(effect.requestId)
            ctx.coordinator.resolveAsk(effect.requestId)
            break
          case 'notify': {
            const notification = createNotification(effect.kind, {
              projectName: effect.projectName,
              detail: effect.detail,
              sessionId: effect.sessionId,
            })
            ctx.coordinator.notify(effect.subtitle ? { ...notification, subtitle: effect.subtitle } : notification)
            break
          }
        }
      }

      function scheduleTick(): void {
        if (tickTimer !== null || state.records.length === 0 || ctx.isDisposed()) return
        tickTimer = ctx.clock.setTimeout(() => {
          tickTimer = null
          dispatch({ type: 'tick', at: ctx.clock.now() })
        }, CLAUDE_TICK_MS)
      }

      function dispatch(input: ClaudeInput): void {
        if (ctx.isDisposed()) return
        const transition = reduceClaude(state, input)
        state = transition.state
        // Sessions et activité d'abord : la demande ou la notification s'affiche par-dessus.
        publish()
        for (const effect of transition.effects) apply(effect)
        scheduleTick()
      }

      /** Fenêtre VS Code (ou app) de la session au premier plan, sur son dossier. */
      function openSession(sessionId: string): void {
        deps.claudeOpenSession({ sessionId }).catch((e: unknown) => console.warn('[île] ouverture de la session :', e))
      }

      /** Montre la demande ouverte de cette session devant les autres demandes en attente. */
      function showAskOf(sessionId: string): boolean {
        const target = pendingAskOf(state, sessionId)
        if (!target) return false
        const displayed = ctx.coordinator.getSnapshot().ask
        if (displayed?.id === target.id) return true
        const others: PermissionAsk[] = state.records
          .flatMap((record) => record.pending)
          .filter((ask) => ask.id !== target.id && ask.id !== displayed?.id)
        for (const ask of others) ctx.coordinator.resolveAsk(ask.id)
        ctx.coordinator.resolveAsk(target.id)
        ctx.coordinator.requestAsk(target)
        for (const ask of others) ctx.coordinator.requestAsk(ask)
        return true
      }

      const stopEvents = listen(ctx, deps.onClaude, (event) => dispatch({ type: 'event', event }))
      const initialProjects = ctx.projects.get()
      if (initialProjects.length > 0) dispatch({ type: 'projects', projects: initialProjects })
      const stopProjects = ctx.projects.subscribe(() => dispatch({ type: 'projects', projects: ctx.projects.get() }))

      return {
        dispose() {
          stopEvents()
          stopProjects()
          for (const timer of askTimers.values()) ctx.clock.clearTimeout(timer)
          askTimers.clear()
          if (tickTimer !== null) ctx.clock.clearTimeout(tickTimer)
          tickTimer = null
          clearLinger()
        },
        actions: {
          openSession(action) {
            openSession(action.sessionId)
          },
          showSessions() {
            const claude = ctx.coordinator
              .getSnapshot()
              .background.find((activity) => activity.id === AGENT_ACTIVITY_ID || activity.id === MULTI_ACTIVITY_ID)
            if (claude) ctx.coordinator.pin(claude.id)
          },
        },
        gestures: {
          onOpenSession(sessionId) {
            openSession(sessionId)
          },
          onAskDecision(decision, ask, answers) {
            deps
              .claudeAnswer(answers ? { requestId: ask.id, decision, answers } : { requestId: ask.id, decision })
              .catch((e: unknown) => console.warn('[île] réponse à Claude Code :', e))
            dispatch({ type: 'decision', requestId: ask.id, decision })
            // Demande déjà oubliée par les sessions (délai écoulé entre-temps) : on la ferme quand même.
            ctx.coordinator.resolveAsk(ask.id)
            clearAskTimer(ask.id)
          },
          onAnswerSession(sessionId) {
            if (showAskOf(sessionId)) return
            const record = findRecord(state, sessionId)
            if (record?.session.status !== 'waiting') return
            // Demande rendue au terminal (« Plus tard », délai écoulé) : on ne peut plus répondre d'ici.
            ctx.coordinator.notify(
              createNotification('claudeStop', {
                projectName: record.session.projectName,
                detail: 'réponds dans le terminal',
                sessionId,
              }),
            )
          },
        },
      }
    },
  }
}

/** Source branchée sur Tauri (enregistrée par l'orchestrateur dans ./index.ts). */
export const claudeSource: IslandSource = createClaudeSource({ onClaude, claudeAnswer, claudeOpenSession })
