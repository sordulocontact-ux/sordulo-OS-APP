import { describe, expect, it, vi } from 'vitest'
import type { ClaudeDecision, ClaudeHookEventName, ClaudeRelayEvent } from '../../../../shared/desktop-contract'
import { CLAUDE_PERMISSION_TIMEOUT_MS } from '../../../../shared/desktop-contract'
import { SLEEP_AFTER_MS } from '../../claude'
import { relayEvent } from '../../claude/testEvents'
import { ASK_IDLE_MS, NEXT_IN_QUEUE_DELAY_MS } from '../../coordinator'
import { fakeEvent, flush, setupRuntime } from '../testUtils'
import {
  AGENT_ACTIVITY_ID,
  CLAUDE_TICK_MS,
  createClaudeSource,
  MULTI_ACTIVITY_ID,
  SUBAGENT_GARDEN_LINGER_MS,
  type ClaudeSourceDeps,
} from './claude'

function setup(options: { projects?: { id: string; name: string }[] } = {}) {
  const claude = fakeEvent<ClaudeRelayEvent>()
  const deps = {
    onClaude: claude.subscribe,
    claudeAnswer: vi.fn(
      async (_args: { requestId: string; decision: ClaudeDecision; answers?: Record<string, string> }) => {},
    ),
    claudeOpenSession: vi.fn(async (_args: { sessionId: string }) => {}),
  } satisfies ClaudeSourceDeps
  const env = setupRuntime({ sources: [createClaudeSource(deps)], projects: options.projects })
  const emit = (name: ClaudeHookEventName, fields: Partial<Omit<ClaudeRelayEvent, 'event'>> = {}) =>
    claude.emit(relayEvent(name, { at: env.clock.now(), ...fields }))
  const sessions = () => env.runtime.view.get().sessions
  return { ...env, claude, deps, emit, sessions }
}

describe('source « Claude Code »', () => {
  it('une session : sessions au rendu et activité agent ; deux : multi ; aucune : rien', async () => {
    const t = setup({ projects: [{ id: 'p-2', name: 'Sordulo OS' }] })
    await flush()
    t.emit('SessionStart')
    expect(t.sessions()).toHaveLength(1)
    expect(t.sessions()[0]).toMatchObject({ projectName: 'Sordulo OS', projectId: 'p-2' })
    // Une session qui ne travaille pas n'occupe pas l'île.
    expect(t.snap().primary).toBeNull()
    t.emit('UserPromptSubmit', { message: 'x' })
    expect(t.snap().primary).toMatchObject({ id: AGENT_ACTIVITY_ID, kind: 'agent', sessionId: 's-1' })
    expect(t.snap().state).toBe('agent')

    t.emit('SessionStart', { sessionId: 's-2', cwd: 'C:\\dev\\app-ibe' })
    expect(t.snap().primary).toMatchObject({ id: MULTI_ACTIVITY_ID, kind: 'multi' })
    expect(t.coordinator.getActivity(AGENT_ACTIVITY_ID)).toBeNull()
    expect(t.snap().state).toBe('multi')

    t.emit('SessionEnd', { sessionId: 's-2' })
    expect(t.snap().primary).toMatchObject({ id: AGENT_ACTIVITY_ID, sessionId: 's-1' })
    t.emit('Stop')
    expect(t.snap().primary).toBeNull()
    t.emit('SessionEnd')
    expect(t.snap().primary).toBeNull()
    expect(t.sessions()).toHaveLength(0)
  })

  it('session seule avec sous-agents : jardin (multi), gardé un moment après le dernier, puis agent', async () => {
    const t = setup()
    await flush()
    t.emit('UserPromptSubmit', { message: 'x' })
    expect(t.snap().state).toBe('agent')
    t.emit('PreToolUse', { toolName: 'Agent', toolSummary: 'Explorer' })
    expect(t.snap().primary).toMatchObject({ id: MULTI_ACTIVITY_ID, kind: 'multi' })
    expect(t.coordinator.getActivity(AGENT_ACTIVITY_ID)).toBeNull()
    t.emit('SubagentStop')
    // Un autre sous-agent peut suivre : l'île ne change pas de taille tout de suite.
    expect(t.snap().primary).toMatchObject({ id: MULTI_ACTIVITY_ID })
    t.clock.advance(SUBAGENT_GARDEN_LINGER_MS / 2)
    t.emit('PreToolUse', { toolName: 'Agent', toolSummary: 'Relire' })
    t.emit('SubagentStop')
    t.clock.advance(SUBAGENT_GARDEN_LINGER_MS - 1)
    expect(t.snap().primary).toMatchObject({ id: MULTI_ACTIVITY_ID })
    t.clock.advance(1)
    expect(t.snap().primary).toMatchObject({ id: AGENT_ACTIVITY_ID, kind: 'agent', sessionId: 's-1' })
  })

    it('l’étape suit le dernier outil sans recréer l’activité', async () => {
    const t = setup()
    await flush()
    t.emit('UserPromptSubmit', { message: 'Corrige le kanban' })
    const order = t.snap().primary?.order
    t.emit('PreToolUse', { toolName: 'Read', toolSummary: 'CLAUDE.md' })
    expect(t.sessions()[0]).toMatchObject({ step: 'Lit CLAUDE.md', task: 'Corrige le kanban', status: 'working' })
    expect(t.snap().primary?.order).toBe(order)
  })

  it('PermissionRequest → demande affichée ; Autoriser → réponse au relais et retour à agent', async () => {
    const t = setup()
    await flush()
    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-1' })
    const snap = t.snap()
    expect(snap.state).toBe('agentAsk')
    expect(snap.ask).toMatchObject({
      id: 'r-1',
      sessionId: 's-1',
      summary: 'npm run build',
      title: 'Lancer une commande dans sordulo-OS',
      expiresAt: t.clock.now() + CLAUDE_PERMISSION_TIMEOUT_MS,
    })
    expect(t.sessions()[0]?.status).toBe('waiting')

    t.runtime.gestures.onAskDecision('allow', snap.ask!)
    expect(t.deps.claudeAnswer).toHaveBeenCalledWith({ requestId: 'r-1', decision: 'allow' })
    expect(t.snap().state).toBe('agent')
    expect(t.sessions()[0]?.status).toBe('working')
    expect(t.clock.pendingTimers).toBeLessThanOrEqual(2) // file de la coordination + passage du temps
  })

  it('Refuser : « Claude attend tes consignes », « Commande refusée : … », session en pause', async () => {
    const t = setup()
    await flush()
    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-1' })
    t.runtime.gestures.onAskDecision('deny', t.snap().ask!)
    expect(t.deps.claudeAnswer).toHaveBeenCalledWith({ requestId: 'r-1', decision: 'deny' })
    expect(t.sessions()[0]).toMatchObject({ status: 'idle', error: true })
    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(t.snap().notification).toMatchObject({
      kind: 'claudeStop',
      title: 'Claude attend tes consignes',
      subtitle: 'Commande refusée : npm run build',
      action: { type: 'openSession', sessionId: 's-1' },
    })
  })

  it('Plus tard : rendue au terminal ; « Répondre » le rappelle par une notification', async () => {
    const t = setup()
    await flush()
    t.emit('SessionStart', { sessionId: 's-2', cwd: 'C:\\dev\\app-ibe' })
    t.emit('PermissionRequest', { toolName: 'Edit', toolSummary: 'src/a.ts', requestId: 'r-1' })
    t.runtime.gestures.onAskDecision('later', t.snap().ask!)
    expect(t.deps.claudeAnswer).toHaveBeenCalledWith({ requestId: 'r-1', decision: 'later' })
    expect(t.snap().state).toBe('multi')
    expect(t.sessions().find((s) => s.id === 's-1')?.status).toBe('waiting')

    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    t.runtime.gestures.onAnswerSession('s-1')
    expect(t.snap().notification).toMatchObject({ kind: 'claudeStop', subtitle: 'sordulo-OS : réponds dans le terminal' })
  })

  it('« Répondre » montre la demande ouverte de cette session devant les autres', async () => {
    const t = setup()
    await flush()
    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm test', requestId: 'r-1' })
    t.emit('PermissionRequest', { sessionId: 's-2', toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-2' })
    t.emit('PermissionRequest', { sessionId: 's-3', toolName: 'Bash', toolSummary: 'npm run lint', requestId: 'r-3' })
    expect(t.snap().ask?.id).toBe('r-1')
    expect(t.snap().askPosition).toEqual({ index: 1, total: 3 })
    // Fin de la première par le terminal (PostToolUse) : pendant les 450 ms, « Répondre » sur la session 3.
    t.emit('PostToolUse', { toolName: 'Bash', toolSummary: 'npm test' })
    expect(t.snap().ask).toBeNull()
    t.runtime.gestures.onAnswerSession('s-3')
    expect(t.snap().ask?.id).toBe('r-3')
    t.runtime.gestures.onAskDecision('allow', t.snap().ask!)
    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(t.snap().ask?.id).toBe('r-2')
  })

  it('délai de 60 s écoulé, ou PermissionCancelled : la demande se ferme', async () => {
    const t = setup()
    await flush()
    // Curseur sur l'île : sinon la demande est mise de côté au bout de 10 s (voir le test suivant).
    t.coordinator.setHover(true)
    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-1' })
    t.clock.advance(CLAUDE_PERMISSION_TIMEOUT_MS - 1)
    expect(t.snap().state).toBe('agentAsk')
    t.clock.advance(1)
    expect(t.snap().state).toBe('agent')
    expect(t.deps.claudeAnswer).not.toHaveBeenCalled()

    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-2' })
    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(t.snap().ask?.id).toBe('r-2')
    t.emit('PermissionCancelled', { requestId: 'r-2', toolName: 'Bash' })
    expect(t.snap().ask).toBeNull()
  })

  it('mise de côté sans le curseur (10 s) : la session attend toujours, « Répondre » remontre la demande', async () => {
    const t = setup()
    await flush()
    t.emit('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-1' })
    t.clock.advance(ASK_IDLE_MS)
    expect(t.snap()).toMatchObject({ state: 'agent', ask: null })
    expect(t.sessions()[0]?.status).toBe('waiting')
    expect(t.deps.claudeAnswer).not.toHaveBeenCalled()
    t.runtime.gestures.onAnswerSession(t.sessions()[0]!.id)
    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(t.snap().ask?.id).toBe('r-1')
  })

  it('Stop d’une session seule : « Claude a terminé » ; parmi plusieurs : « Une session a terminé »', async () => {
    const t = setup()
    await flush()
    t.emit('UserPromptSubmit', { message: 'Écran de validation' })
    t.emit('PostToolUse', { toolName: 'Edit', toolSummary: 'a.ts', filePath: 'C:\\x\\a.ts' })
    t.emit('Stop')
    expect(t.snap().notification).toMatchObject({ kind: 'claudeDone', subtitle: 'sordulo-OS : 1 fichier modifié' })
    expect(t.sessions()[0]?.status).toBe('done')
    t.runtime.runAction(t.snap().notification!)

    t.emit('UserPromptSubmit', { sessionId: 's-2', cwd: 'C:\\dev\\app-ibe', message: 'Page d’accueil' })
    t.emit('Stop', { sessionId: 's-2', cwd: 'C:\\dev\\app-ibe' })
    t.clock.advance(NEXT_IN_QUEUE_DELAY_MS)
    expect(t.snap().notification).toMatchObject({ kind: 'multiDone', subtitle: 'App Ibé : Page d’accueil' })
  })

  it('conflit : notification « Conflit entre deux sessions » une seule fois', async () => {
    const t = setup()
    await flush()
    const edit = (sessionId: string) =>
      t.emit('PostToolUse', { sessionId, toolName: 'Edit', toolSummary: 'src/Island.tsx', filePath: 'C:\\r\\src\\Island.tsx' })
    t.emit('UserPromptSubmit', { sessionId: 's-1', message: 'a' })
    t.emit('UserPromptSubmit', { sessionId: 's-2', message: 'b' })
    edit('s-1')
    edit('s-2')
    edit('s-2')
    expect(t.sessions().map((s) => s.conflict)).toEqual([true, true])
    expect(t.snap().notification).toMatchObject({
      kind: 'conflict',
      subtitle: 'sordulo-OS : Island.tsx modifié par les sessions 1 et 2',
    })
    const notify = vi.spyOn(t.coordinator, 'notify')
    edit('s-1')
    expect(notify).not.toHaveBeenCalled()
  })

  it('action showSessions (« Voir » d’un conflit) : l’activité Claude dans background est épinglée', async () => {
    const t = setup()
    await flush()
    // Une progression non exclusive (déploiement, prévu) : elle reste devant, Claude attend dans background.
    t.coordinator.addActivity({
      id: 'prog:deploy',
      kind: 'progress',
      stage: 'deploy',
      label: 'Déploiement en cours',
      fraction: null,
      startedAt: 0,
      estimatedMs: 10_000,
    })
    t.emit('UserPromptSubmit', { message: 'x' })
    t.emit('UserPromptSubmit', { sessionId: 's-2', message: 'y' })
    t.emit('Stop', { sessionId: 's-2' })
    expect(t.snap().secondary).toBeNull()
    expect(t.snap().background.map((a) => a.id)).toContain(MULTI_ACTIVITY_ID)
    const done = t.snap().notification!
    t.runtime.runAction({ ...done, action: { type: 'showSessions' } })
    expect(t.snap().pinnedId).toBe(MULTI_ACTIVITY_ID)
    expect(t.snap().primary?.id).toBe(MULTI_ACTIVITY_ID)
  })

  it('question à choix : les réponses choisies dans l’île partent avec « allow »', async () => {
    const t = setup()
    await flush()
    const questions = [
      { question: 'Quelle approche ?', header: null, multiSelect: false, options: [{ label: 'Simple', description: null }] },
    ]
    t.emit('PermissionRequest', { toolName: 'AskUserQuestion', toolSummary: null, requestId: 'r-q', questions })
    const ask = t.snap().ask!
    expect(ask.questions).toEqual(questions)
    t.runtime.gestures.onAskDecision('allow', ask, { 'Quelle approche ?': 'Simple' })
    expect(t.deps.claudeAnswer).toHaveBeenCalledWith({
      requestId: 'r-q',
      decision: 'allow',
      answers: { 'Quelle approche ?': 'Simple' },
    })
    expect(t.snap().ask).toBeNull()
  })

  it('clic sur « Une session a terminé » ou sur une session : sa fenêtre VS Code', async () => {
    const t = setup()
    await flush()
    t.emit('UserPromptSubmit', { message: 'x' })
    t.emit('UserPromptSubmit', { sessionId: 's-2', message: 'y' })
    t.emit('Stop', { sessionId: 's-2' })
    const done = t.snap().notification!
    expect(done).toMatchObject({ kind: 'multiDone', action: { type: 'openSession', sessionId: 's-2' } })
    t.runtime.runAction(done)
    expect(t.deps.claudeOpenSession).toHaveBeenCalledWith({ sessionId: 's-2' })
    t.runtime.gestures.onOpenSession('s-1')
    expect(t.deps.claudeOpenSession).toHaveBeenLastCalledWith({ sessionId: 's-1' })
  })

  it('pendant un appel : Claude au travail reste sous l’appel, sans bulle', async () => {
    const t = setup()
    await flush()
    t.coordinator.addActivity({ id: 'meet', kind: 'meet', appName: 'Discord', service: null, projectId: null, projectName: null, startedAt: 0 })
    t.emit('UserPromptSubmit', { message: 'x' })
    expect(t.snap()).toMatchObject({ state: 'meet', secondary: null })
    expect(t.snap().background.map((a) => a.id)).toEqual([AGENT_ACTIVITY_ID])
    t.emit('Stop')
    expect(t.snap().background).toEqual([])
  })

  it('session inactive après 15 min : l’île se repose, puis se réveille au prochain hook', async () => {
    const t = setup()
    await flush()
    t.emit('UserPromptSubmit', { message: 'x' })
    t.clock.advance(SLEEP_AFTER_MS + CLAUDE_TICK_MS)
    expect(t.sessions()[0]?.status).toBe('sleep')
    expect(t.snap().primary).toBeNull()
    t.emit('PreToolUse', { toolName: 'Read', toolSummary: 'a.ts' })
    expect(t.snap().primary).toMatchObject({ id: AGENT_ACTIVITY_ID })
  })

  it('arrêt : désabonnement et minuteurs arrêtés', async () => {
    const t = setup()
    await flush()
    expect(t.claude.listeners).toBe(1)
    t.emit('PermissionRequest', { toolName: 'Bash', requestId: 'r-1' })
    t.runtime.dispose()
    expect(t.claude.listeners).toBe(0)
    t.clock.advance(CLAUDE_PERMISSION_TIMEOUT_MS)
    expect(t.deps.claudeAnswer).not.toHaveBeenCalled()
  })
})
