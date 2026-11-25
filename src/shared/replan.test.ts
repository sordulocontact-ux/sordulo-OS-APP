import { describe, expect, it } from 'vitest'
import {
  analyzePlanning,
  availableHours,
  buildProposals,
  dailyCapacity,
  formatShortDate,
  operationsSignature,
  planningWeek,
  ruleCovers,
  type ReplanInput,
  type ReplanMember,
  type ReplanTask,
} from './replan.js'

// Mercredi 25 novembre 2026 : semaine du lundi 23 au dimanche 29, 3 jours travaillés restants (25, 26, 27).
const TODAY = '2026-11-25'
const P1 = 'p1'
const P2 = 'p2'

function member(id: string, name: string, overrides: Partial<ReplanMember> = {}): ReplanMember {
  return {
    id,
    name,
    role: 'membre',
    removed_at: null,
    skills: { dev: 3 },
    weekly_capacity_hours: 35,
    unavailable_weekdays: [],
    absences: [],
    ...overrides,
  }
}

let seq = 0
function task(overrides: Partial<ReplanTask>): ReplanTask {
  seq += 1
  return {
    id: `t${seq}`,
    project_id: P1,
    title: `Tâche ${seq}`,
    skill: 'dev',
    estimate_hours: 1,
    assignee_member_id: null,
    status: 'todo',
    depends_on_task_id: null,
    due_date: null,
    priority: 'medium',
    ...overrides,
  }
}

const mael = member('mael', 'Maël', { role: 'admin', skills: { dev: 4 } })
const sacha = member('sacha', 'Sacha', { skills: { dev: 3, design: 5 } })

function run(partial: Partial<ReplanInput>) {
  return analyzePlanning({ today: TODAY, tasks: [], members: [mael, sacha], ...partial })
}

describe('dates et capacité', () => {
  it('semaine du lundi au dimanche, la suivante le week-end', () => {
    expect(planningWeek('2026-11-25')).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(planningWeek('2026-11-23')).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(planningWeek('2026-11-28')).toEqual({ start: '2026-11-30', end: '2026-12-06' })
    expect(planningWeek('2026-11-29')).toEqual({ start: '2026-11-30', end: '2026-12-06' })
  })

  it('formate une date courte en français', () => {
    expect(formatShortDate('2026-12-03')).toBe('3 déc.')
    expect(formatShortDate(null)).toBe('sans échéance')
  })

  it('capacité par jour : capacité hebdo ÷ jours travaillés, 0 sans capacité', () => {
    expect(dailyCapacity(mael)).toBe(7)
    expect(dailyCapacity(member('a', 'A', { weekly_capacity_hours: 28, unavailable_weekdays: [3] }))).toBe(7)
    expect(dailyCapacity(member('b', 'B', { weekly_capacity_hours: 0 }))).toBe(0)
    expect(dailyCapacity(member('c', 'C', { unavailable_weekdays: [1, 2, 3, 4, 5] }))).toBe(0)
  })

  it('heures disponibles : sans week-end, jours indisponibles ni absences', () => {
    expect(availableHours(mael, '2026-11-25', '2026-11-29')).toBe(21)
    const school = member('e', 'École', { weekly_capacity_hours: 28, unavailable_weekdays: [3] })
    expect(availableHours(school, '2026-11-25', '2026-11-27')).toBe(14)
    const away = member('f', 'Absent', { absences: [{ start_date: '2026-11-26', end_date: '2026-11-26' }] })
    expect(availableHours(away, '2026-11-25', '2026-11-27')).toBe(14)
  })
})

describe('semaine qui déborde', () => {
  it('propose de réattribuer ou décaler les tâches les moins prioritaires jusqu’à résorber l’excédent', () => {
    // Maël : 30 h dues pour 21 h disponibles (9 h de trop).
    const high = task({ assignee_member_id: 'mael', estimate_hours: 10, priority: 'high', due_date: '2026-11-26' })
    const medium = task({ assignee_member_id: 'mael', estimate_hours: 12, priority: 'medium', due_date: '2026-11-27' })
    const low = task({ assignee_member_id: 'mael', estimate_hours: 8, priority: 'low', due_date: '2026-11-28' })
    const analysis = run({ tasks: [high, medium, low] })

    expect(analysis.issues).toHaveLength(1)
    const [issue] = analysis.issues
    expect(issue?.type).toBe('overload')
    expect(issue?.memberId).toBe('mael')
    expect(issue?.taskIds).toEqual([low.id, medium.id])
    expect(issue?.summary).toContain('30 h')
    expect(issue?.summary).toContain('21 h')

    const ids = analysis.candidates.map((c) => c.id)
    expect(ids).toEqual([`reassign:${low.id}:sacha`, `due:${low.id}:2026-11-30`, `reassign:${medium.id}:sacha`, `due:${medium.id}:2026-11-30`])
    const reassign = analysis.candidates[0]
    expect(reassign?.before).toEqual({ assignee_member_id: 'mael' })
    expect(reassign?.after).toEqual({ assignee_member_id: 'sacha' })
    expect(reassign?.memberIds).toEqual(['mael', 'sacha'])
    expect(analysis.candidates[1]?.before).toEqual({ due_date: '2026-11-28' })
    expect(analysis.candidates[1]?.after).toEqual({ due_date: '2026-11-30' })
  })

  it('rien si la semaine tient, ou pour les tâches sans échéance ou déjà faites', () => {
    const tasks = [
      task({ assignee_member_id: 'mael', estimate_hours: 20, due_date: '2026-11-27' }),
      task({ assignee_member_id: 'mael', estimate_hours: 30, due_date: null }),
      task({ assignee_member_id: 'mael', estimate_hours: 30, due_date: '2026-11-26', status: 'done' }),
    ]
    expect(run({ tasks }).issues).toEqual([])
  })

  it('ne réattribue qu’à un membre compétent qui a la place', () => {
    const designer = member('lea', 'Léa', { skills: { design: 5 } })
    const busy = member('tom', 'Tom', { skills: { dev: 5 } })
    const tasks = [
      task({ assignee_member_id: 'mael', estimate_hours: 25, due_date: '2026-11-27' }),
      task({ assignee_member_id: 'tom', estimate_hours: 20, due_date: '2026-11-27' }),
    ]
    const analysis = run({ tasks, members: [mael, designer, busy] })
    expect(analysis.issues).toHaveLength(1)
    expect(analysis.candidates.map((c) => c.kind)).toEqual(['move_due_date'])
  })

  it('une absence réduit la capacité et retire la personne des candidats', () => {
    const absentSacha = member('sacha', 'Sacha', { absences: [{ start_date: '2026-11-25', end_date: '2026-11-27' }] })
    const tasks = [task({ assignee_member_id: 'mael', estimate_hours: 25, due_date: '2026-11-27' })]
    const analysis = run({ tasks, members: [mael, absentSacha] })
    expect(analysis.candidates.map((c) => c.kind)).toEqual(['move_due_date'])

    // Maël absent jeudi : 14 h disponibles, 15 h dues → débordement.
    const absentMael = member('mael', 'Maël', { skills: { dev: 4 }, absences: [{ start_date: '2026-11-26', end_date: '2026-11-26' }] })
    const overflow = run({ tasks: [task({ assignee_member_id: 'mael', estimate_hours: 15, due_date: '2026-11-27' })], members: [absentMael, sacha] })
    expect(overflow.issues.map((i) => i.type)).toEqual(['overload'])
  })

  it('ne décale pas une tâche de priorité haute et ne touche pas une tâche commencée', () => {
    const tasks = [
      task({ assignee_member_id: 'mael', estimate_hours: 15, priority: 'high', due_date: '2026-11-27' }),
      task({ assignee_member_id: 'mael', estimate_hours: 15, status: 'in_progress', due_date: '2026-11-27' }),
    ]
    const analysis = run({ tasks, members: [mael, sacha] })
    expect(analysis.candidates.map((c) => c.kind)).toEqual(['reassign_task'])
  })

  it('le week-end, la semaine analysée est la suivante', () => {
    const tasks = [task({ assignee_member_id: 'mael', estimate_hours: 40, due_date: '2026-12-04' })]
    const analysis = run({ today: '2026-11-28', tasks })
    expect(analysis.weekStart).toBe('2026-11-30')
    expect(analysis.issues.map((i) => i.type)).toEqual(['overload'])
    expect(analysis.candidates.find((c) => c.kind === 'move_due_date')?.after).toEqual({ due_date: '2026-12-07' })
  })
})

describe('tâche bloquante', () => {
  it('dépend d’une tâche non faite qui finit après elle : avancer l’une ou décaler l’autre', () => {
    const dependency = task({ assignee_member_id: 'sacha', due_date: '2026-11-28' })
    const blocked = task({ assignee_member_id: 'mael', due_date: '2026-11-26', depends_on_task_id: dependency.id })
    const analysis = run({ tasks: [dependency, blocked] })
    expect(analysis.issues).toHaveLength(1)
    expect(analysis.issues[0]?.type).toBe('blocked')
    expect(analysis.issues[0]?.taskIds).toEqual([blocked.id, dependency.id])
    expect(analysis.candidates.map((c) => c.id)).toEqual([`due:${dependency.id}:2026-11-25`, `due:${blocked.id}:2026-11-30`])
  })

  it('rien si la dépendance est faite, sans échéance ou finit avant', () => {
    const done = task({ due_date: '2026-11-28', status: 'done' })
    const noDate = task({ due_date: null })
    const before = task({ due_date: '2026-11-25' })
    const tasks = [
      done,
      noDate,
      before,
      task({ due_date: '2026-11-26', depends_on_task_id: done.id }),
      task({ due_date: '2026-11-26', depends_on_task_id: noDate.id }),
      task({ due_date: '2026-11-26', depends_on_task_id: before.id }),
    ]
    expect(run({ tasks }).issues).toEqual([])
  })

  it('n’avance jamais une échéance avant aujourd’hui', () => {
    const dependency = task({ due_date: '2026-11-30' })
    const blocked = task({ due_date: '2026-11-25', depends_on_task_id: dependency.id })
    const analysis = run({ tasks: [dependency, blocked] })
    expect(analysis.candidates.map((c) => c.id)).toEqual([`due:${blocked.id}:2026-12-01`])
  })
})

describe('urgence', () => {
  it('priorité haute en retard : réattribuer ou ramener l’échéance au prochain jour disponible', () => {
    const late = task({ assignee_member_id: 'mael', priority: 'high', due_date: '2026-11-20', estimate_hours: 2 })
    const analysis = run({ tasks: [late] })
    expect(analysis.issues.map((i) => i.type)).toEqual(['urgent'])
    expect(analysis.issues[0]?.summary).toContain('en retard')
    expect(analysis.candidates.map((c) => c.id)).toEqual([`reassign:${late.id}:sacha`, `due:${late.id}:2026-11-25`])
  })

  it('priorité haute sans personne : réattribution seulement', () => {
    const orphan = task({ priority: 'high', due_date: '2026-11-27' })
    const analysis = run({ tasks: [orphan] })
    expect(analysis.issues[0]?.summary).toContain('personne')
    expect(analysis.candidates.map((c) => c.id)).toEqual([`reassign:${orphan.id}:mael`, `reassign:${orphan.id}:sacha`])
    expect(analysis.candidates[0]?.before).toEqual({ assignee_member_id: null })
  })

  it('due avant que la personne soit disponible (absence)', () => {
    const away = member('sacha', 'Sacha', { skills: { dev: 3 }, absences: [{ start_date: '2026-11-25', end_date: '2026-12-01' }] })
    const urgent = task({ assignee_member_id: 'sacha', priority: 'high', due_date: '2026-11-27' })
    const analysis = run({ tasks: [urgent], members: [mael, away] })
    // Sacha a aussi une semaine qui déborde (0 h disponible) : les deux problèmes partagent le candidat.
    expect(analysis.issues.map((i) => i.type)).toEqual(['overload', 'urgent'])
    expect(analysis.issues[1]?.summary).toContain("Sacha n'est pas disponible")
    expect(analysis.candidates.map((c) => c.id)).toEqual([`reassign:${urgent.id}:mael`, `due:${urgent.id}:2026-12-02`])
  })

  it('priorité moyenne en retard : pas une urgence', () => {
    expect(run({ tasks: [task({ assignee_member_id: 'mael', due_date: '2026-11-20' })] }).issues).toEqual([])
  })
})

describe('périmètre', () => {
  it('limite au projet demandé, la charge reste celle de toute l’organisation', () => {
    const tasks = [
      task({ project_id: P2, assignee_member_id: 'mael', estimate_hours: 20, due_date: '2026-11-27' }),
      task({ project_id: P1, assignee_member_id: 'mael', estimate_hours: 5, due_date: '2026-11-27' }),
    ]
    const analysis = run({ tasks, projectId: P1 })
    expect(analysis.issues).toHaveLength(1)
    expect(analysis.candidates.every((c) => c.projectId === P1)).toBe(true)
  })

  it('les tâches déjà dans une proposition en attente sont exclues', () => {
    const late = task({ assignee_member_id: 'mael', priority: 'high', due_date: '2026-11-20' })
    expect(run({ tasks: [late], excludedTaskIds: new Set([late.id]) }).issues).toEqual([])
  })

  it('se limite aux membres du projet s’il en a', () => {
    const tom = member('tom', 'Tom', { skills: { dev: 5 } })
    const orphan = task({ priority: 'high', due_date: '2026-11-27' })
    const analysis = run({ tasks: [orphan], members: [mael, sacha, tom], projectMembers: new Map([[P1, ['sacha']]]) })
    expect(analysis.candidates.map((c) => c.id)).toEqual([`reassign:${orphan.id}:sacha`])
  })
})

describe('buildProposals', () => {
  const dependency = task({ assignee_member_id: 'sacha', due_date: '2026-11-28' })
  const blocked = task({ assignee_member_id: 'mael', due_date: '2026-11-26', depends_on_task_id: dependency.id })
  const late = task({ project_id: P2, assignee_member_id: 'mael', priority: 'high', due_date: '2026-11-20' })
  const analysis = analyzePlanning({ today: TODAY, tasks: [dependency, blocked, late], members: [mael, sacha] })
  const [moveDep, moveBlocked] = [`due:${dependency.id}:2026-11-25`, `due:${blocked.id}:2026-11-30`]
  const reassignLate = `reassign:${late.id}:sacha`

  it('transforme le choix en propositions avec les valeurs avant / après exactes', () => {
    const { drafts, rejected } = buildProposals(analysis, [
      { candidate_ids: [moveDep], title: '  Avancer la tâche  ', explanation: 'Parce que — voilà.' },
      { candidate_ids: [reassignLate], title: 'Confier à Sacha', explanation: 'Urgent.' },
    ])
    expect(rejected).toEqual([])
    expect(drafts[0]).toEqual({
      kind: 'move_due_date',
      projectId: P1,
      title: 'Avancer la tâche',
      explanation: 'Parce que, voilà.',
      operations: [{ task_id: dependency.id, before: { due_date: '2026-11-28' }, after: { due_date: '2026-11-25' } }],
      memberIds: ['sacha'],
    })
    expect(drafts[1]?.kind).toBe('reassign_task')
    expect(drafts[1]?.projectId).toBe(P2)
    expect(drafts[1]?.memberIds).toEqual(['mael', 'sacha'])
  })

  it('rejette toute opération hors liste', () => {
    const { drafts, rejected } = buildProposals(analysis, [
      { candidate_ids: [moveDep, `reassign:${late.id}:inconnu`], title: 'X', explanation: 'Y' },
    ])
    expect(drafts).toEqual([])
    expect(rejected[0]?.reason).toContain('hors liste')
  })

  it('rejette une opération réutilisée, deux opérations sur la même tâche, une liste vide', () => {
    const { drafts, rejected } = buildProposals(analysis, [
      { candidate_ids: [moveDep], title: 'A', explanation: 'a' },
      { candidate_ids: [moveDep], title: 'B', explanation: 'b' },
      { candidate_ids: [reassignLate, `due:${late.id}:2026-11-25`], title: 'C', explanation: 'c' },
      { candidate_ids: [], title: 'D', explanation: 'd' },
    ])
    expect(drafts.map((d) => d.title)).toEqual(['A'])
    expect(rejected.map((r) => r.reason)).toEqual([
      'opération déjà utilisée par une autre proposition',
      'deux opérations sur la même tâche',
      'aucune opération',
    ])
  })

  it('types mélangés → reorder ; projets différents → sans projet ; titre vide → libellé', () => {
    const { drafts } = buildProposals(analysis, [{ candidate_ids: [moveBlocked, reassignLate], title: ' ', explanation: '' }])
    expect(drafts[0]?.kind).toBe('reorder')
    expect(drafts[0]?.projectId).toBeNull()
    expect(drafts[0]?.title).toContain('Décaler')
    expect(drafts[0]?.explanation).not.toBe('')
  })
})

describe('operationsSignature et ruleCovers', () => {
  it('même empreinte quel que soit l’ordre', () => {
    const a = { task_id: 'a', before: {}, after: { due_date: '2026-12-01' } }
    const b = { task_id: 'b', before: {}, after: { assignee_member_id: 'x' } }
    expect(operationsSignature([a, b])).toBe(operationsSignature([b, a]))
    expect(operationsSignature([a])).not.toBe(operationsSignature([{ ...a, after: { due_date: '2026-12-02' } }]))
  })

  it('une règle couvre son type, dans son projet ou toute l’organisation', () => {
    const rule = { kind: 'reassign_task' as const, scope: { project_id: P1 }, revoked_at: null }
    expect(ruleCovers(rule, 'reassign_task', P1)).toBe(true)
    expect(ruleCovers(rule, 'reassign_task', P2)).toBe(false)
    expect(ruleCovers(rule, 'reassign_task', null)).toBe(false)
    expect(ruleCovers(rule, 'move_due_date', P1)).toBe(false)
    expect(ruleCovers({ ...rule, scope: {} }, 'reassign_task', null)).toBe(true)
    expect(ruleCovers({ ...rule, revoked_at: '2026-11-01' }, 'reassign_task', P1)).toBe(false)
  })
})
