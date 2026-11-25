import { describe, expect, it } from 'vitest'
import {
  doneInWeekIds,
  addDays,
  collectedInWeek,
  doneByMember,
  formatDuration,
  isMonday,
  isoWeekKey,
  lateProjects,
  loadLevel,
  recapWeeks,
  taskIdsWithTime,
  timeInWeek,
  weekLabel,
  weekOf,
  weeklyLoads,
  type RecapInvoice,
  type RecapMember,
  type RecapTask,
} from './recapLogic'

describe('semaines', () => {
  it('calcule la semaine lundi → dimanche', () => {
    expect(weekOf('2026-11-25')).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(weekOf('2026-11-23')).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(weekOf('2026-11-29')).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('donne la semaine précédente d’un lundi, jour de Paris', () => {
    // Dimanche 22 novembre 23h30 UTC = lundi 23 novembre 00h30 à Paris.
    const weeks = recapWeeks(new Date('2026-11-22T23:30:00Z'))
    expect(weeks.today).toBe('2026-11-23')
    expect(weeks.previous).toEqual({ start: '2026-11-16', end: '2026-11-22' })
    expect(weeks.current).toEqual({ start: '2026-11-23', end: '2026-11-29' })
    expect(isMonday(new Date('2026-11-22T23:30:00Z'))).toBe(true)
    expect(isMonday(new Date('2026-11-24T10:00:00Z'))).toBe(false)
  })

  it('numérote les semaines ISO', () => {
    expect(isoWeekKey('2026-11-23')).toBe('2026-W48')
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01')
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53')
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01')
  })

  it('libelle la semaine', () => {
    expect(weekLabel({ start: '2026-11-16', end: '2026-11-22' })).toBe('du 16 au 22 novembre')
    expect(weekLabel({ start: '2026-11-30', end: '2026-12-06' })).toBe('du 30 novembre au 6 décembre')
  })
})

describe('collectedInWeek', () => {
  const week = { start: '2026-11-16', end: '2026-11-22' }
  const inv = (o: Partial<RecapInvoice>): RecapInvoice => ({
    id: 'i', kind: 'invoice', status: 'paid', issue_date: '2026-11-01', paid_at: '2026-11-18T10:00:00Z', credited_invoice_id: null, total_ht_cents: 100_000, ...o,
  })

  it('somme les paiements de la semaine, pas les autres', () => {
    expect(collectedInWeek([inv({ id: 'a' }), inv({ id: 'b', paid_at: '2026-11-23T10:00:00Z' }), inv({ id: 'c', status: 'issued', paid_at: null })], week)).toBe(100_000)
  })
  it('déduit les avoirs de factures payées', () => {
    const credit = inv({ id: 'a2', kind: 'credit_note', status: 'issued', paid_at: null, issue_date: '2026-11-20', total_ht_cents: -30_000, credited_invoice_id: 'a' })
    expect(collectedInWeek([inv({ id: 'a', status: 'cancelled', paid_at: '2026-11-02T10:00:00Z' }), credit], week)).toBe(-30_000)
  })
})

describe('tâches, projets, temps', () => {
  const members: RecapMember[] = [
    { id: 'm1', name: 'Maël', role: 'admin', weekly_capacity_hours: 35, unavailable_weekdays: [], removed_at: null },
    { id: 'm2', name: 'Sacha', role: 'admin', weekly_capacity_hours: 20, unavailable_weekdays: [4, 5], removed_at: null },
    { id: 'm3', name: 'Gabriela', role: 'prospection', weekly_capacity_hours: 10, unavailable_weekdays: [], removed_at: null },
  ]
  const task = (o: Partial<RecapTask>): RecapTask => ({ id: 't', title: 'T', project_id: 'p', assignee_member_id: 'm1', status: 'todo', estimate_hours: 2, due_date: '2026-11-25', ...o })

  it('groupe les tâches faites par personne', () => {
    const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' }), task({ id: 'c', status: 'done', assignee_member_id: 'm2' }), task({ id: 'd', status: 'done' }), task({ id: 'e' })]
    const done = doneByMember(tasks, new Set(['a', 'b', 'c', 'e']), members)
    expect(done.map((d) => [d.name, d.count])).toEqual([['Maël', 2], ['Sacha', 1]])
  })

  it('liste les projets en retard, pas ceux livrés', () => {
    const today = '2026-11-25'
    const late = lateProjects(
      [
        { id: '1', name: 'A', status: 'in_progress', due_date: '2026-11-20' },
        { id: '2', name: 'B', status: 'delivered', due_date: '2026-11-01' },
        { id: '3', name: 'C', status: 'in_progress', due_date: today },
        { id: '4', name: 'D', status: 'quote_sent', due_date: '2026-10-01' },
        { id: '5', name: 'E', status: 'in_progress', due_date: null },
      ],
      today,
    )
    expect(late.map((p) => [p.name, p.daysLate])).toEqual([['D', 55], ['A', 5]])
  })

  it('calcule la charge et la capacité, absences déduites, prospection exclue', () => {
    const week = { start: '2026-11-23', end: '2026-11-29' }
    const loads = weeklyLoads(
      members,
      [task({ id: '1', estimate_hours: 30 }), task({ id: '2', estimate_hours: null }), task({ id: '3', status: 'done', estimate_hours: 9 }), task({ id: '4', due_date: '2026-12-02', estimate_hours: 9 }), task({ id: '5', assignee_member_id: 'm2', estimate_hours: 9 })],
      [{ member_id: 'm1', start_date: '2026-11-26', end_date: '2026-11-27' }],
      week,
    )
    expect(loads.map((l) => l.name)).toEqual(['Maël', 'Sacha'])
    const mael = loads[0]
    expect(mael?.hours).toBe(30)
    expect(mael?.openTasks).toBe(2)
    expect(mael?.unestimated).toBe(1)
    expect(mael?.absentDays).toBe(2)
    expect(mael?.capacityHours).toBe(21)
    expect(mael?.level).toBe('over')
    const sacha = loads[1]
    // 20 h sur les 3 jours ouvrés (lundi à mercredi) de Sacha, aucune absence.
    expect(sacha?.capacityHours).toBe(20)
    expect(sacha?.level).toBe('ok')
  })

  it('classe la charge', () => {
    expect(loadLevel(0, 0)).toBe('ok')
    expect(loadLevel(5, 0)).toBe('over')
    expect(loadLevel(7, 10)).toBe('ok')
    expect(loadLevel(8, 10)).toBe('tight')
    expect(loadLevel(10, 10)).toBe('tight')
    expect(loadLevel(11, 10)).toBe('over')
  })

  it('totalise le temps de la semaine par personne', () => {
    const week = { start: '2026-11-16', end: '2026-11-22' }
    const entries = [
      { member_id: 'm1', started_at: '2026-11-17T09:00:00Z', duration_minutes: 90, task_id: 'a' },
      { member_id: 'm1', started_at: '2026-11-18T09:00:00Z', duration_minutes: 30, task_id: null },
      { member_id: 'm2', started_at: '2026-11-19T09:00:00Z', duration_minutes: 200, task_id: 'b' },
      { member_id: 'm2', started_at: '2026-11-25T09:00:00Z', duration_minutes: 60, task_id: 'c' },
      { member_id: 'm2', started_at: '2026-11-20T09:00:00Z', duration_minutes: null, task_id: 'd' },
    ]
    expect(timeInWeek(entries, members, week).map((t) => [t.name, t.minutes])).toEqual([['Sacha', 200], ['Maël', 120]])
    expect([...taskIdsWithTime(entries, week)].sort()).toEqual(['a', 'b', 'd'])
  })

  it('formate les durées', () => {
    expect(formatDuration(95)).toBe('1 h 35')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(40)).toBe('40 min')
  })
})

describe('doneInWeekIds (date de fin 0016)', () => {
  const week = { start: '2026-11-16', end: '2026-11-22' }
  const base = { title: 'T', project_id: 'p', assignee_member_id: 'm', estimate_hours: 1, due_date: null }
  it('retient la date de fin au jour de Paris, et le temps saisi pour les tâches sans date', () => {
    const ids = doneInWeekIds(
      [
        { ...base, id: 'a', status: 'done', done_at: '2026-11-22T23:30:00Z' }, // lundi 23 à 0 h 30 à Paris : hors semaine
        { ...base, id: 'b', status: 'done', done_at: '2026-11-16T08:00:00Z' },
        { ...base, id: 'c', status: 'done', done_at: null },
        { ...base, id: 'd', status: 'done', done_at: null },
        { ...base, id: 'e', status: 'todo', done_at: null },
      ],
      week,
      new Set(['c', 'e']),
    )
    expect([...ids].sort()).toEqual(['b', 'c'])
  })
})
