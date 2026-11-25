import { describe, expect, it } from 'vitest'
import type { ClaudeHookEventName, ClaudeRelayEvent } from '../../../shared/desktop-contract'
import { CLAUDE_PERMISSION_TIMEOUT_MS } from '../../../shared/desktop-contract'
import {
  claudeActivityFor,
  soloWithSubagents,
  FORGET_AFTER_MS,
  INITIAL_CLAUDE_STATE,
  pendingAskOf,
  reduceClaude,
  sessionsOf,
  SLEEP_AFTER_MS,
  type ClaudeEffect,
  type ClaudeInput,
  type ClaudeState,
} from './sessions'
import { relayEvent, TEST_CWD } from './testEvents'

const T0 = 1_000_000
const OTHER_CWD = 'C:\\dev\\app-ibe'

function ev(name: ClaudeHookEventName, fields: Partial<Omit<ClaudeRelayEvent, 'event'>> = {}): ClaudeInput {
  return { type: 'event', event: relayEvent(name, fields) }
}

function run(inputs: ClaudeInput[], from: ClaudeState = INITIAL_CLAUDE_STATE) {
  let state = from
  const effects: ClaudeEffect[] = []
  for (const input of inputs) {
    const t = reduceClaude(state, input)
    state = t.state
    effects.push(...t.effects)
  }
  return { state, effects, sessions: sessionsOf(state) }
}

const notifs = (effects: ClaudeEffect[]) => effects.filter((e) => e.type === 'notify')

describe('sessions Claude Code', () => {
  it('naît à SessionStart, disparaît à SessionEnd', () => {
    const started = run([ev('SessionStart')])
    expect(started.sessions).toHaveLength(1)
    expect(started.sessions[0]).toMatchObject({
      id: 's-1',
      projectName: 'sordulo-OS',
      projectId: null,
      cwd: TEST_CWD,
      branch: 'feature/ile',
      status: 'idle',
      task: null,
      step: null,
      startedAt: T0,
    })
    expect(run([ev('SessionEnd')], started.state).sessions).toHaveLength(0)
  })

  it('naît au premier événement d’une session inconnue ; SessionEnd d’une inconnue ne crée rien', () => {
    expect(run([ev('PreToolUse', { toolName: 'Read', toolSummary: 'CLAUDE.md' })]).sessions[0]).toMatchObject({
      status: 'working',
      step: 'Lit CLAUDE.md',
    })
    expect(run([ev('SessionEnd')]).sessions).toHaveLength(0)
  })

  it('nom du projet Sordulo OS correspondant au dossier, mis à jour avec la liste des projets', () => {
    const { state } = run([ev('SessionStart')])
    const linked = run([{ type: 'projects', projects: [{ id: 'p-9', name: 'Sordulo OS' }] }], state)
    expect(linked.sessions[0]).toMatchObject({ projectName: 'Sordulo OS', projectId: 'p-9' })
  })

  it('tâche = début du premier prompt ; étape = dernier outil ; temps écoulé depuis le prompt', () => {
    const { sessions } = run([
      ev('SessionStart'),
      ev('UserPromptSubmit', { message: 'Corrige le bouton Valider de l’écran de validation', at: T0 + 1000 }),
      ev('PreToolUse', { toolName: 'Edit', toolSummary: 'src/features/review/ReviewPage.tsx', at: T0 + 2000 }),
      ev('UserPromptSubmit', { message: 'Autre chose', at: T0 + 5000 }),
      ev('PreToolUse', { toolName: 'Bash', toolSummary: 'npm run typecheck', at: T0 + 6000 }),
    ])
    expect(sessions[0]).toMatchObject({
      task: 'Corrige le bouton Valider de l’écran de validation',
      step: 'Lance npm run typecheck',
      status: 'working',
      startedAt: T0 + 5000,
    })
  })

  it('Stop d’une session seule : « Claude a terminé », N fichiers modifiés pendant le tour', () => {
    const write = (path: string, tool = 'Edit') =>
      ev('PostToolUse', { toolName: tool, toolSummary: path, filePath: `${TEST_CWD}\\${path}` })
    const { sessions, effects } = run([
      ev('UserPromptSubmit', { message: 'x' }),
      write('a.ts'),
      write('b.ts', 'Write'),
      write('a.ts', 'MultiEdit'),
      ev('PostToolUse', { toolName: 'Read', toolSummary: 'c.ts', filePath: null }),
      ev('Stop'),
    ])
    expect(sessions[0]).toMatchObject({ status: 'done', step: null })
    expect(notifs(effects)).toEqual([
      { type: 'notify', kind: 'claudeDone', sessionId: 's-1', projectName: 'sordulo-OS', detail: '2 fichiers modifiés' },
    ])
  })

  it('Stop parmi plusieurs sessions : « Une session a terminé » avec la tâche', () => {
    const { effects } = run([
      ev('UserPromptSubmit', { message: 'Hooks Claude Code' }),
      ev('UserPromptSubmit', { sessionId: 's-2', cwd: OTHER_CWD, message: 'Page d’accueil' }),
      ev('Stop', { sessionId: 's-2', cwd: OTHER_CWD }),
    ])
    expect(notifs(effects)).toEqual([
      { type: 'notify', kind: 'multiDone', sessionId: 's-2', projectName: 'app-ibe', detail: 'Page d’accueil' },
    ])
  })

  it('activité du Claude de l’île : outil en cours, réflexion entre deux outils, rien après le tour', () => {
    const prompt = run([ev('UserPromptSubmit', { message: 'Corrige le bug' })])
    expect(prompt.sessions[0]?.activity).toBe('think')
    const reading = run([ev('PreToolUse', { toolName: 'Read', toolSummary: 'CLAUDE.md' })], prompt.state)
    expect(reading.sessions[0]?.activity).toBe('read')
    const searching = run([ev('PreToolUse', { toolName: 'Grep', toolSummary: 'dots' })], reading.state)
    expect(searching.sessions[0]?.activity).toBe('search')
    const after = run([ev('PostToolUse', { toolName: 'Grep' })], searching.state)
    expect(after.sessions[0]?.activity).toBe('think')
    expect(run([ev('Stop')], after.state).sessions[0]?.activity).toBeNull()
  })

  it('sous-agents comptés', () => {
    const { sessions } = run([
      ev('PreToolUse', { toolName: 'Task', toolSummary: 'Explorer' }),
      ev('PreToolUse', { toolName: 'Agent', toolSummary: 'Relire' }),
      ev('SubagentStop'),
    ])
    expect(sessions[0]?.subagents).toBe(1)
    expect(run([ev('SubagentStop'), ev('SubagentStop')]).sessions[0]?.subagents).toBe(0)
  })

  it('shell en arrière-plan : Stop → « patiente », sans « Claude a terminé » ; réveil puis vrai Stop', () => {
    const shell = ev('PreToolUse', { toolName: 'Bash', toolSummary: 'npm run dev', background: true })
    const launched = run([ev('UserPromptSubmit', { message: 'Lance le serveur' }), shell])
    expect(launched.sessions[0]).toMatchObject({ status: 'working', step: 'Lance en arrière-plan : npm run dev' })
    const patient = run([ev('PostToolUse', { toolName: 'Bash' }), ev('Stop')], launched.state)
    expect(patient.sessions[0]).toMatchObject({ status: 'background', step: 'Patiente : npm run dev' })
    expect(notifs(patient.effects)).toEqual([])
    expect(claudeActivityFor(patient.sessions)).toEqual({ kind: 'agent', sessionId: 's-1' })
    // Le shell a fini, Claude est réveillé : il travaille, puis son Stop est un vrai « terminé ».
    const woken = run([ev('PreToolUse', { toolName: 'Read', toolSummary: 'log.txt' }), ev('Stop')], patient.state)
    expect(woken.sessions[0]?.status).toBe('done')
    expect(notifs(woken.effects).map((e) => e.type === 'notify' && e.kind)).toEqual(['claudeDone'])
  })

  it('arrière-plan : compte shells et sous-agents, KillShell en retire un, un nouveau prompt oublie les shells', () => {
    const { sessions, state } = run([
      ev('UserPromptSubmit', { message: 'x' }),
      ev('PreToolUse', { toolName: 'Bash', toolSummary: 'npm run dev', background: true }),
      ev('PreToolUse', { toolName: 'Bash', toolSummary: 'npm test -- --watch', background: true }),
      ev('PreToolUse', { toolName: 'Agent', toolSummary: 'Explorer', background: true }),
      ev('PreToolUse', { toolName: 'KillShell' }),
      ev('PreToolUse', { toolName: 'Bash', toolSummary: 'ls' }),
      ev('Stop'),
    ])
    expect(sessions[0]).toMatchObject({ status: 'background', step: 'Patiente : un shell et un sous-agent en cours' })
    // Le sous-agent n'a pas annoncé sa fin : Claude patiente encore ; les shells sont oubliés.
    const again = run([ev('UserPromptSubmit', { message: 'y' }), ev('Stop')], state)
    expect(again.sessions[0]).toMatchObject({ status: 'background', step: 'Patiente : un sous-agent en cours', subagents: 1 })
    const finished = run([ev('SubagentStop'), ev('UserPromptSubmit', { message: 'z' }), ev('Stop')], again.state)
    expect(finished.sessions[0]?.status).toBe('done')
  })

  it('Claude qui attend ses sous-agents d’arrière-plan : on les voit toujours, même après un réveil', () => {
    const agent = (name: string) => ev('PreToolUse', { toolName: 'Agent', toolSummary: name, background: true })
    const patient = run([ev('UserPromptSubmit', { message: 'x' }), agent('A'), agent('B'), agent('C'), ev('Stop')])
    expect(patient.sessions[0]).toMatchObject({ status: 'background', subagents: 3, step: 'Patiente : 3 sous-agents en cours' })
    expect(claudeActivityFor(patient.sessions)).toEqual({ kind: 'multi' })
    // Un sous-agent finit : il quitte le jardin, Claude est réveillé puis repatiente pour les deux autres.
    const one = run([ev('SubagentStop')], patient.state)
    expect(one.sessions[0]).toMatchObject({ status: 'background', subagents: 2, step: 'Patiente : 2 sous-agents en cours' })
    const woken = run([ev('PreToolUse', { toolName: 'Read', toolSummary: 'rapport.md' }), ev('Stop')], one.state)
    expect(woken.sessions[0]).toMatchObject({ status: 'background', subagents: 2 })
    expect(notifs(woken.effects)).toEqual([])
    expect(claudeActivityFor(woken.sessions)).toEqual({ kind: 'multi' })
    const all = run([ev('SubagentStop'), ev('SubagentStop'), ev('PreToolUse', { toolName: 'Read', toolSummary: 'x' }), ev('Stop')], woken.state)
    expect(all.sessions[0]).toMatchObject({ status: 'done', subagents: 0 })
  })

  it('sous-agent d’arrière-plan fini pendant le tour : le Stop dit « terminé »', () => {
    const { sessions } = run([
      ev('UserPromptSubmit', { message: 'x' }),
      ev('PreToolUse', { toolName: 'Agent', toolSummary: 'Explorer', background: true }),
      ev('SubagentStop'),
      ev('Stop'),
    ])
    expect(sessions[0]?.status).toBe('done')
  })

    it('Notification « attend tes consignes » : une fois par tour ; les autorisations sont ignorées', () => {
    const { effects } = run([
      ev('UserPromptSubmit', { message: 'x' }),
      ev('Stop'),
      ev('Notification', { message: 'Claude needs your permission to use Bash' }),
      ev('Notification', { message: 'Claude is waiting for your input' }),
      ev('Notification', { message: 'Claude is waiting for your input' }),
    ])
    expect(notifs(effects).filter((e) => e.kind === 'claudeStop')).toEqual([
      { type: 'notify', kind: 'claudeStop', sessionId: 's-1', projectName: 'sordulo-OS', detail: '' },
    ])
  })

  it('inactive après 15 min sans événement, oubliée après 3 h', () => {
    const { state } = run([ev('UserPromptSubmit', { message: 'x' })])
    expect(run([{ type: 'tick', at: T0 + SLEEP_AFTER_MS - 1 }], state).sessions[0]?.status).toBe('working')
    const asleep = run([{ type: 'tick', at: T0 + SLEEP_AFTER_MS }], state)
    expect(asleep.sessions[0]?.status).toBe('sleep')
    expect(run([ev('PreToolUse', { toolName: 'Read', at: T0 + SLEEP_AFTER_MS + 5 })], asleep.state).sessions[0]?.status).toBe('working')
    expect(run([{ type: 'tick', at: T0 + FORGET_AFTER_MS }], state).sessions).toHaveLength(0)
  })
})

describe('demandes d’autorisation', () => {
  const ask = ev('PermissionRequest', { toolName: 'Bash', toolSummary: 'npm run build', requestId: 'r-1', at: T0 + 10 })

  it('question à choix de Claude (AskUserQuestion) : la demande porte les questions', () => {
    const questions = [
      {
        question: 'Quelle approche ?',
        header: 'Approche',
        multiSelect: false,
        options: [
          { label: 'Simple', description: null },
          { label: 'Complète', description: 'Plus long' },
        ],
      },
    ]
    const { effects } = run([
      ev('PermissionRequest', { toolName: 'AskUserQuestion', toolSummary: null, requestId: 'r-q', questions, at: T0 + 10 }),
    ])
    expect(effects).toEqual([
      { type: 'requestAsk', ask: expect.objectContaining({ id: 'r-q', title: 'Question de Claude dans sordulo-OS', questions }) },
    ])
  })

  it('PermissionRequest : session « à autoriser » et demande à montrer', () => {
    const { sessions, effects, state } = run([ev('UserPromptSubmit', { message: 'x' }), ask])
    expect(sessions[0]?.status).toBe('waiting')
    expect(effects).toEqual([
      {
        type: 'requestAsk',
        ask: {
          id: 'r-1',
          sessionId: 's-1',
          toolName: 'Bash',
          summary: 'npm run build',
          title: 'Lancer une commande dans sordulo-OS',
          receivedAt: T0 + 10,
          expiresAt: T0 + 10 + CLAUDE_PERMISSION_TIMEOUT_MS,
          questions: null,
        },
      },
    ])
    expect(pendingAskOf(state, 's-1')?.id).toBe('r-1')
    // Le même requestId deux fois ne crée pas deux demandes.
    expect(run([ask], state).effects).toEqual([])
  })

  it('Autoriser : la session reprend', () => {
    const { state } = run([ask])
    const t = run([{ type: 'decision', requestId: 'r-1', decision: 'allow' }], state)
    expect(t.sessions[0]?.status).toBe('working')
    expect(t.effects).toEqual([{ type: 'resolveAsk', requestId: 'r-1' }])
  })

  it('Refuser, session seule : « En pause » et « Commande refusée : … »', () => {
    const { state } = run([ask])
    const t = run([{ type: 'decision', requestId: 'r-1', decision: 'deny' }], state)
    expect(t.sessions[0]).toMatchObject({ status: 'idle', error: true, step: 'Commande refusée : npm run build' })
    expect(t.effects).toEqual([
      { type: 'resolveAsk', requestId: 'r-1' },
      {
        type: 'notify',
        kind: 'claudeStop',
        sessionId: 's-1',
        projectName: 'sordulo-OS',
        detail: 'Commande refusée : npm run build',
        subtitle: 'Commande refusée : npm run build',
      },
    ])
  })

  it('Refuser parmi plusieurs sessions : « En pause » sans notification (prototype)', () => {
    const { state } = run([ev('SessionStart', { sessionId: 's-2', cwd: OTHER_CWD }), ask])
    const t = run([{ type: 'decision', requestId: 'r-1', decision: 'deny' }], state)
    expect(notifs(t.effects)).toEqual([])
  })

  it('Plus tard : rendue au terminal, la session reste « à autoriser »', () => {
    const { state } = run([ask])
    const t = run([{ type: 'decision', requestId: 'r-1', decision: 'later' }], state)
    expect(t.sessions[0]?.status).toBe('waiting')
    expect(pendingAskOf(t.state, 's-1')).toBeNull()
    expect(t.state.records[0]?.handedToTerminal).toBe(true)
  })

  it('fermée par PermissionCancelled, le délai local, PostToolUse du même outil, Stop, SessionEnd', () => {
    const { state } = run([ask])
    const closers: ClaudeInput[] = [
      ev('PermissionCancelled', { requestId: 'r-1', toolName: 'Bash' }),
      { type: 'askExpired', requestId: 'r-1' },
      ev('PostToolUse', { toolName: 'Bash', toolSummary: 'npm run build' }),
      ev('Stop'),
      ev('SessionEnd'),
      ev('UserPromptSubmit', { message: 'autre chose' }),
    ]
    for (const closer of closers) {
      expect(run([closer], state).effects).toContainEqual({ type: 'resolveAsk', requestId: 'r-1' })
    }
    // Un autre outil ne la ferme pas.
    const other = run([ev('PostToolUse', { toolName: 'Read', toolSummary: 'a.ts' })], state)
    expect(other.effects).not.toContainEqual({ type: 'resolveAsk', requestId: 'r-1' })
    expect(other.sessions[0]?.status).toBe('waiting')
  })

  it('une décision pour une demande déjà fermée ne fait rien', () => {
    const { state } = run([ask, { type: 'askExpired', requestId: 'r-1' }])
    expect(run([{ type: 'decision', requestId: 'r-1', decision: 'allow' }], state).effects).toEqual([])
  })
})

describe('conflits', () => {
  const editA = (sessionId: string, path: string, cwd = TEST_CWD) =>
    ev('PostToolUse', { sessionId, cwd, toolName: 'Edit', toolSummary: path, filePath: `${cwd}\\${path}` })

  it('deux sessions en plein tour modifient le même fichier : conflit et une notification par paire et fichier', () => {
    const { sessions, effects, state } = run([
      ev('UserPromptSubmit', { sessionId: 's-1', message: 'a' }),
      ev('UserPromptSubmit', { sessionId: 's-2', message: 'b' }),
      editA('s-1', 'src\\Island.tsx'),
      editA('s-2', 'SRC\\island.tsx'),
      editA('s-2', 'src\\Island.tsx'),
    ])
    expect(sessions.map((s) => s.conflict)).toEqual([true, true])
    expect(notifs(effects)).toEqual([
      {
        type: 'notify',
        kind: 'conflict',
        sessionId: 's-1',
        projectName: 'sordulo-OS',
        detail: 'Island.tsx modifié par les sessions 1 et 2',
      },
    ])
    // Encore une modification : pas de nouvelle notification.
    expect(notifs(run([editA('s-1', 'src\\Island.tsx')], state).effects)).toEqual([])
    // Le Stop de l'une lève le conflit.
    expect(run([ev('Stop', { sessionId: 's-1' })], state).sessions.map((s) => s.conflict)).toEqual([false, false])
  })

  it('pas de conflit si l’une a terminé son tour avant que l’autre modifie le fichier', () => {
    const { sessions, effects } = run([
      ev('UserPromptSubmit', { sessionId: 's-1', message: 'a' }),
      ev('UserPromptSubmit', { sessionId: 's-2', message: 'b' }),
      editA('s-1', 'a.ts'),
      ev('Stop', { sessionId: 's-1' }),
      editA('s-2', 'a.ts'),
    ])
    expect(sessions.map((s) => s.conflict)).toEqual([false, false])
    expect(notifs(effects).filter((e) => e.kind === 'conflict')).toEqual([])
  })

  it('une session qui disparaît libère son conflit', () => {
    const { state } = run([editA('s-1', 'a.ts'), editA('s-2', 'a.ts')])
    const t = run([ev('SessionEnd', { sessionId: 's-2' })], state)
    expect(t.sessions.map((s) => s.conflict)).toEqual([false])
    expect(t.state.notifiedConflicts.size).toBe(0)
  })
})

describe('activité Claude de l’île', () => {
  it('une session → agent, plusieurs → multi ; rien tant qu’aucune ne travaille ni n’attend', () => {
    const prompt = (sessionId: string) => ev('UserPromptSubmit', { sessionId, message: 'x' })
    expect(claudeActivityFor(run([ev('SessionStart')]).sessions)).toBeNull()
    const one = run([ev('SessionStart'), prompt('s-1')]).sessions
    expect(claudeActivityFor(one)).toEqual({ kind: 'agent', sessionId: 's-1' })
    const two = run([ev('SessionStart'), ev('SessionStart', { sessionId: 's-2' }), prompt('s-2')]).sessions
    expect(claudeActivityFor(two)).toEqual({ kind: 'multi' })
    const finished = run([ev('SessionStart'), prompt('s-1'), ev('Stop')]).sessions
    expect(claudeActivityFor(finished)).toBeNull()
    const asking = run([prompt('s-1'), ev('PermissionRequest', { requestId: 'r-1', toolName: 'Bash' })]).sessions
    expect(claudeActivityFor(asking)).toEqual({ kind: 'agent', sessionId: 's-1' })
    expect(claudeActivityFor([])).toBeNull()
  })

  it('une session seule avec des sous-agents → multi (le jardin les montre), ou si on garde le jardin', () => {
    const prompt = ev('UserPromptSubmit', { message: 'x' })
    const crew = run([prompt, ev('PreToolUse', { toolName: 'Agent', toolSummary: 'Explorer' })]).sessions
    expect(soloWithSubagents(crew)).toBe(true)
    expect(claudeActivityFor(crew)).toEqual({ kind: 'multi' })
    const back = run([prompt, ev('PreToolUse', { toolName: 'Agent' }), ev('SubagentStop')]).sessions
    expect(soloWithSubagents(back)).toBe(false)
    expect(claudeActivityFor(back)).toEqual({ kind: 'agent', sessionId: 's-1' })
    expect(claudeActivityFor(back, true)).toEqual({ kind: 'multi' })
  })
})
