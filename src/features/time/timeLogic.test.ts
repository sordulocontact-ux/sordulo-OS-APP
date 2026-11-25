import { describe, expect, it } from 'vitest'
import type { TimeEntry } from '../../shared/types'
import {
  budget, budgetLabel, canEditEntry, entryMinutes, formatClock, formatDuration, localDay, manualStart, minutesByMember, minutesByTask,
  parseDuration, soldMinutes, taskTimeRows, totalMinutes,
} from './timeLogic'

function e(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'e', organization_id: 'o', project_id: 'p', task_id: null, member_id: 'm1', started_at: '2026-11-25T09:00:00Z',
    ended_at: '2026-11-25T10:00:00Z', duration_minutes: 60, note: null, created_at: '', updated_at: '', ...over,
  }
}
const now = new Date('2026-11-25T12:00:00Z')

describe('entryMinutes', () => {
  it('lit la durée enregistrée', () => expect(entryMinutes(e({ duration_minutes: 45 }), now)).toBe(45))
  it('calcule un minuteur en cours', () => {
    expect(entryMinutes(e({ ended_at: null, duration_minutes: null }), now)).toBe(180)
  })
  it('ne devient jamais négatif', () => {
    expect(entryMinutes(e({ ended_at: null, duration_minutes: null, started_at: '2026-11-25T13:00:00Z' }), now)).toBe(0)
  })
})

describe('formatDuration / formatClock', () => {
  it('formate', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(150)).toBe('2 h 30')
    expect(formatDuration(125)).toBe('2 h 05')
    expect(formatClock(3_725_000)).toBe('1:02:05')
    expect(formatClock(65_000)).toBe('01:05')
  })
})

describe('parseDuration', () => {
  it('lit les saisies courantes', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('1 h')).toBe(60)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('45min')).toBe(45)
    expect(parseDuration('1,5h')).toBe(90)
    expect(parseDuration('2h15min')).toBe(135)
  })
  it('refuse le reste', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('-5')).toBeNull()
    expect(parseDuration('999999')).toBeNull()
  })
})

describe('dates manuelles', () => {
  it('manualStart et localDay font l\'aller-retour', () => {
    const start = manualStart('2026-11-20')
    expect(start).not.toBeNull()
    expect(localDay(start as string)).toBe('2026-11-20')
    expect(manualStart('nope')).toBeNull()
  })
})

describe('totaux', () => {
  const entries = [
    e({ id: '1', task_id: 't1', member_id: 'm1', duration_minutes: 60 }),
    e({ id: '2', task_id: 't1', member_id: 'm2', duration_minutes: 30 }),
    e({ id: '3', task_id: null, member_id: 'm1', duration_minutes: 15 }),
    e({ id: '4', task_id: 't2', member_id: 'm2', ended_at: null, duration_minutes: null }),
  ]
  it('par tâche', () => {
    const map = minutesByTask(entries, now)
    expect(map.get('t1')).toBe(90)
    expect(map.get('t2')).toBe(180)
    expect(map.has('null')).toBe(false)
  })
  it('par membre et total', () => {
    expect(minutesByMember(entries, now).get('m1')).toBe(75)
    expect(totalMinutes(entries, now)).toBe(285)
  })
})

describe('temps vendu contre réel', () => {
  it('somme les estimations', () => {
    expect(soldMinutes([{ estimate_hours: 1.5 }, { estimate_hours: null }, { estimate_hours: 2 }])).toBe(210)
  })
  it('budget', () => {
    expect(budget(100, 0).state).toBe('unknown')
    expect(budget(100, 0).percent).toBeNull()
    expect(budget(60, 120)).toMatchObject({ state: 'ok', remaining: 60, percent: 50 })
    expect(budget(150, 120)).toMatchObject({ state: 'over', remaining: -30, percent: 125 })
    expect(budget(120, 120).state).toBe('ok')
  })
  it('libellé', () => {
    expect(budgetLabel(budget(150, 240))).toBe('2 h 30 sur 4 h')
    expect(budgetLabel(budget(30, 0))).toBe('30 min (non estimée)')
  })
  it('lignes par tâche, dépassements en tête, tâches vides écartées', () => {
    const tasks = [
      { id: 't1', title: 'A', estimate_hours: 2 },
      { id: 't2', title: 'B', estimate_hours: 1 },
      { id: 't3', title: 'C', estimate_hours: null },
    ]
    const entries = [e({ task_id: 't2', duration_minutes: 90 }), e({ task_id: 't1', duration_minutes: 30 })]
    const rows = taskTimeRows(tasks, entries, now)
    expect(rows.map((r) => r.taskId)).toEqual(['t2', 't1'])
  })
})

describe('canEditEntry', () => {
  it('auteur ou admin', () => {
    expect(canEditEntry({ member_id: 'm1' }, 'm1', false)).toBe(true)
    expect(canEditEntry({ member_id: 'm1' }, 'm2', false)).toBe(false)
    expect(canEditEntry({ member_id: 'm1' }, 'm2', true)).toBe(true)
    expect(canEditEntry({ member_id: 'm1' }, null, false)).toBe(false)
  })
})
