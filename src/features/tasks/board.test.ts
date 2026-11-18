import { describe, expect, it } from 'vitest'
import {
  computeDropPosition,
  countBlocked,
  dependencyLabel,
  filterByPerson,
  filterVisible,
  formatHours,
  getDependency,
  groupByStatus,
  totalHours,
  type BoardTask,
} from './board'

function task(id: string, over: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    organization_id: 'o',
    project_id: 'p',
    ticket_id: 't',
    title: `Tâche ${id}`,
    skill: 'dev',
    estimate_hours: 1,
    assignee_member_id: 'm1',
    status: 'todo',
    depends_on_task_id: null,
    position: 1,
    created_at: '2026-11-18T10:00:00Z',
    ticket: { id: 't', title: 'T', type: 'bug', priority: 'low', status: 'validated' },
    ...over,
  }
}

describe('filterVisible', () => {
  it('garde validated, done et sans ticket', () => {
    const t = (status: 'proposed' | 'validated' | 'rejected' | 'done') =>
      task(status, { ticket: { id: 't', title: 'T', type: 'bug', priority: 'low', status } })
    const list = [t('proposed'), t('validated'), t('rejected'), t('done'), task('none', { ticket: null })]
    expect(filterVisible(list).map((x) => x.id)).toEqual(['validated', 'done', 'none'])
  })
})

describe('filterByPerson', () => {
  const list = [task('a'), task('b', { assignee_member_id: 'm2' }), task('c', { assignee_member_id: null })]
  it('tout le monde', () => expect(filterByPerson(list, null)).toHaveLength(3))
  it('un membre', () => expect(filterByPerson(list, 'm2').map((x) => x.id)).toEqual(['b']))
  it('non attribuées', () => expect(filterByPerson(list, 'none').map((x) => x.id)).toEqual(['c']))
})

describe('groupByStatus', () => {
  it('regroupe et trie par position', () => {
    const cols = groupByStatus([
      task('a', { position: 3 }),
      task('b', { position: 1 }),
      task('c', { status: 'done' }),
    ])
    expect(cols.todo.map((x) => x.id)).toEqual(['b', 'a'])
    expect(cols.done.map((x) => x.id)).toEqual(['c'])
    expect(cols.review).toEqual([])
  })
})

describe('computeDropPosition', () => {
  const col = [task('a', { position: 1 }), task('b', { position: 2 }), task('c', { position: 4 })]
  it('fin de colonne : max + 1', () => expect(computeDropPosition(col, 'x', null)).toBe(5))
  it('colonne vide', () => expect(computeDropPosition([], 'x', null)).toBe(1))
  it('avant une carte : moyenne des voisines', () => expect(computeDropPosition(col, 'x', 'c')).toBe(3))
  it('avant la première', () => expect(computeDropPosition(col, 'x', 'a')).toBe(0))
  it('ignore la carte déplacée', () => expect(computeDropPosition(col, 'b', 'c')).toBe(2.5))
  it('fin ignore la carte déplacée', () => expect(computeDropPosition(col, 'c', null)).toBe(3))
})

describe('dépendances', () => {
  const design = task('d', { status: 'in_progress', title: 'Maquette' })
  const dev = task('v', { depends_on_task_id: 'd' })
  it('bloquée tant que la dépendance n\'est pas faite', () => {
    const info = getDependency(dev, [design, dev])
    expect(info.blocked).toBe(true)
    expect(dependencyLabel(info)).toBe('Bloquée par : Maquette (En cours)')
  })
  it('après quand la dépendance est faite', () => {
    const info = getDependency(dev, [{ ...design, status: 'done' }, dev])
    expect(info.blocked).toBe(false)
    expect(dependencyLabel(info)).toBe('Après : Maquette')
  })
  it('pas de dépendance, ou introuvable', () => {
    expect(dependencyLabel(getDependency(design, [design]))).toBeNull()
    expect(getDependency(dev, [dev]).blocked).toBe(false)
  })
  it('compte les tâches bloquées', () => {
    expect(countBlocked('d', [design, dev])).toBe(1)
    expect(countBlocked('d', [design, { ...dev, status: 'done' }])).toBe(0)
  })
})

describe('heures', () => {
  it('format français', () => {
    expect(formatHours(1.5)).toBe('1,5 h')
    expect(formatHours(null)).toBe('Non estimée')
  })
  it('total', () => expect(totalHours([task('a', { estimate_hours: 1.5 }), task('b', { estimate_hours: null })])).toBe(1.5))
})
