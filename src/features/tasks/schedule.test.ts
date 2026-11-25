import { describe, expect, it } from 'vitest'
import {
  addDays, compareByUrgency, dueLabel, dueState, endOfWeek, filterByDue, filterByPriority, parseDueParam, parisDay, parsePriorityParam,
} from './schedule'

describe('parisDay', () => {
  it('lit le jour à Paris, pas en UTC', () => {
    expect(parisDay(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02')
    expect(parisDay(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01')
    expect(parisDay(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02')
  })
})

describe('addDays / endOfWeek', () => {
  it('passe les fins de mois et d\'année', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('donne le dimanche', () => {
    expect(endOfWeek('2026-11-25')).toBe('2026-11-29') // mercredi
    expect(endOfWeek('2026-11-29')).toBe('2026-11-29') // dimanche
    expect(endOfWeek('2026-11-30')).toBe('2026-12-06') // lundi
  })
})

describe('dueState', () => {
  const today = '2026-11-25'
  it('classe les échéances', () => {
    expect(dueState(null, today)).toBe('none')
    expect(dueState('2026-11-24', today)).toBe('overdue')
    expect(dueState('2026-11-25', today)).toBe('today')
    expect(dueState('2026-11-29', today)).toBe('week')
    expect(dueState('2026-11-30', today)).toBe('later')
  })
  it('une tâche faite n\'est pas en retard', () => {
    expect(dueState('2026-11-24', today, true)).toBe('later')
  })
})

describe('dueLabel', () => {
  it('formule la pastille', () => {
    expect(dueLabel(null, '2026-11-25')).toBeNull()
    expect(dueLabel('2026-11-25', '2026-11-25')).toBe("Aujourd'hui")
    expect(dueLabel('2026-11-20', '2026-11-25')).toMatch(/^En retard : 20 nov/)
    expect(dueLabel('2026-12-12', '2026-11-25')).toMatch(/^12 déc/)
  })
})

describe('filtres', () => {
  const today = '2026-11-25'
  const tasks = [
    { id: 'a', priority: 'high' as const, due_date: '2026-11-20', status: 'todo' as const },
    { id: 'b', priority: 'low' as const, due_date: '2026-11-25', status: 'todo' as const },
    { id: 'c', priority: 'medium' as const, due_date: '2026-11-27', status: 'todo' as const },
    { id: 'd', priority: 'high' as const, due_date: null, status: 'todo' as const },
    { id: 'e', priority: 'high' as const, due_date: '2026-11-01', status: 'done' as const },
  ]
  const ids = (list: { id: string }[]) => list.map((t) => t.id)
  it('priorité', () => {
    expect(ids(filterByPriority(tasks, 'high'))).toEqual(['a', 'd', 'e'])
    expect(ids(filterByPriority(tasks, ''))).toHaveLength(5)
  })
  it('échéance', () => {
    expect(ids(filterByDue(tasks, 'overdue', today))).toEqual(['a'])
    expect(ids(filterByDue(tasks, 'today', today))).toEqual(['b'])
    expect(ids(filterByDue(tasks, 'week', today))).toEqual(['a', 'b', 'c'])
    expect(ids(filterByDue(tasks, 'none', today))).toEqual(['d'])
  })
  it('lit les paramètres d\'URL', () => {
    expect(parsePriorityParam('high')).toBe('high')
    expect(parsePriorityParam('x')).toBe('')
    expect(parseDueParam('week')).toBe('week')
    expect(parseDueParam(null)).toBe('')
  })
})

describe('compareByUrgency', () => {
  it('trie par échéance puis priorité, sans échéance en dernier', () => {
    const list = [
      { priority: 'low' as const, due_date: null },
      { priority: 'low' as const, due_date: '2026-11-26' },
      { priority: 'high' as const, due_date: '2026-11-26' },
    ]
    expect([...list].sort(compareByUrgency).map((t) => `${t.priority}-${t.due_date}`)).toEqual([
      'high-2026-11-26', 'low-2026-11-26', 'low-null',
    ])
  })
})
