/**
 * Récap du lundi : semaine précédente (lundi → dimanche, Paris), charge de la semaine qui commence.
 * Module pur (pas de React, pas de Supabase).
 *
 * « Tâches faites » = tâches dont la date de fin (done_at, migration 0016) tombe dans la semaine ; pour les
 * tâches finies avant 0016, celles sur lesquelles du temps a été saisi pendant la semaine (`doneInWeekIds`).
 */
import { todayIso } from '../../shared/billing'
import { creditedWasPaid, type SplitInvoice } from '../../shared/revenueSplit'
import type { Invoice, Member, MemberAbsence, Project, Task, TimeEntry, Weekday } from '../../shared/types'
import { parisDay } from '../finance/financeLogic'

/* ---------- Semaines (jours AAAA-MM-JJ, calendrier de Paris) ---------- */

/** Ajoute `days` jours à une date AAAA-MM-JJ. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 1 = lundi … 7 = dimanche. */
export function weekdayOf(day: string): Weekday {
  const js = new Date(`${day}T00:00:00Z`).getUTCDay()
  return (js === 0 ? 7 : js) as Weekday
}

export interface WeekRange {
  /** Lundi, AAAA-MM-JJ. */
  start: string
  /** Dimanche, AAAA-MM-JJ. */
  end: string
}

/** Semaine (lundi → dimanche) qui contient `day`. */
export function weekOf(day: string): WeekRange {
  const start = addDays(day, -(weekdayOf(day) - 1))
  return { start, end: addDays(start, 6) }
}

/** Semaine ISO « AAAA-Www » du jour (jeudi de la semaine = année ISO). */
export function isoWeekKey(day: string): string {
  const thursday = addDays(weekOf(day).start, 3)
  const year = Number(thursday.slice(0, 4))
  const firstThursday = addDays(weekOf(`${year}-01-04`).start, 3)
  const week = 1 + Math.round((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${firstThursday}T00:00:00Z`)) / (7 * 86_400_000))
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Récap : la semaine écoulée et la semaine en cours, d'après le jour de Paris de `now`. */
export function recapWeeks(now: Date = new Date()): { today: string; previous: WeekRange; current: WeekRange; key: string } {
  const today = todayIso(now)
  const current = weekOf(today)
  const previous = { start: addDays(current.start, -7), end: addDays(current.start, -1) }
  // Clé de dédoublonnage : la semaine qui commence (celle du lundi où le récap est ouvert).
  return { today, previous, current, key: isoWeekKey(today) }
}

/** Vrai le lundi (Paris). */
export function isMonday(now: Date = new Date()): boolean {
  return weekdayOf(todayIso(now)) === 1
}

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** « du 17 au 23 novembre » ; « du 28 novembre au 4 décembre » quand le mois change. */
export function weekLabel(week: WeekRange): string {
  const start = new Date(`${week.start}T00:00:00Z`)
  const end = new Date(`${week.end}T00:00:00Z`)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  const startText = sameMonth ? String(start.getUTCDate()) : dayMonth.format(start)
  return `du ${startText} au ${dayMonth.format(end)}`
}

const inWeek = (day: string, week: WeekRange): boolean => day >= week.start && day <= week.end

/* ---------- CA encaissé ---------- */

export type RecapInvoice = Pick<Invoice, 'id' | 'kind' | 'status' | 'issue_date' | 'paid_at' | 'credited_invoice_id' | 'total_ht_cents'> & {
  credited_paid_at?: string | null
}

/** CA HT encaissé dans la semaine (jour de paiement), moins les avoirs de factures payées émis dans la semaine. */
export function collectedInWeek(invoices: readonly RecapInvoice[], week: WeekRange): number {
  const byId = new Map<string, SplitInvoice>(invoices.map((i) => [i.id, i as unknown as SplitInvoice]))
  let total = 0
  for (const i of invoices) {
    if (i.status === 'draft') continue
    if (i.kind === 'credit_note') {
      if (i.issue_date && inWeek(i.issue_date, week) && creditedWasPaid(i as unknown as SplitInvoice, byId)) total -= Math.abs(i.total_ht_cents)
      continue
    }
    if (i.paid_at && (i.status === 'paid' || i.status === 'cancelled') && inWeek(parisDay(i.paid_at), week)) total += i.total_ht_cents
  }
  return total
}

/* ---------- Tâches faites ---------- */

export type RecapTask = Pick<Task, 'id' | 'title' | 'project_id' | 'assignee_member_id' | 'status' | 'estimate_hours' | 'due_date' | 'done_at'>

/**
 * Tâches faites pendant la semaine : date de fin (done_at, migration 0016) au jour de Paris dans la semaine ;
 * pour une tâche finie avant 0016 (done_at null), repli sur le temps saisi pendant la semaine (`withTime`).
 */
export function doneInWeekIds(
  tasks: readonly RecapTask[],
  week: { start: string; end: string },
  withTime: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (task.status !== 'done') continue
    if (task.done_at) {
      const day = parisDay(task.done_at)
      if (week.start <= day && day <= week.end) ids.add(task.id)
    } else if (withTime.has(task.id)) {
      ids.add(task.id)
    }
  }
  return ids
}
export type RecapMember = Pick<Member, 'id' | 'name' | 'role' | 'weekly_capacity_hours' | 'unavailable_weekdays' | 'removed_at'>

export interface DoneByMember {
  memberId: string | null
  name: string
  count: number
  titles: string[]
}

/** Tâches terminées dont l'identifiant figure dans `doneTaskIds`, regroupées par personne (la plus active d'abord). */
export function doneByMember(tasks: readonly RecapTask[], doneTaskIds: ReadonlySet<string>, members: readonly RecapMember[]): DoneByMember[] {
  const names = new Map(members.map((m) => [m.id, m.name]))
  const groups = new Map<string | null, DoneByMember>()
  for (const task of tasks) {
    if (task.status !== 'done' || !doneTaskIds.has(task.id)) continue
    const key = task.assignee_member_id
    const group = groups.get(key) ?? { memberId: key, name: key ? (names.get(key) ?? 'Membre') : 'Non attribuées', count: 0, titles: [] }
    group.count += 1
    group.titles.push(task.title)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'))
}

/* ---------- Projets en retard ---------- */

export type RecapProject = Pick<Project, 'id' | 'name' | 'status' | 'due_date'>

export interface LateProject {
  id: string
  name: string
  dueDate: string
  daysLate: number
}

const DAY_MS = 86_400_000

/** Échéance passée et projet ni livré, ni payé, ni archivé : le plus en retard d'abord. */
export function lateProjects(projects: readonly RecapProject[], today: string): LateProject[] {
  return projects
    .flatMap((p) => {
      if (p.due_date === null || p.due_date >= today) return []
      if (p.status === 'delivered' || p.status === 'paid' || p.status === 'archived') return []
      const daysLate = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.due_date}T00:00:00Z`)) / DAY_MS)
      return [{ id: p.id, name: p.name, dueDate: p.due_date, daysLate }]
    })
    .sort((a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name, 'fr'))
}

/* ---------- Charge de la semaine qui commence ---------- */

export type RecapAbsence = Pick<MemberAbsence, 'member_id' | 'start_date' | 'end_date'>

/** Jours ouvrés (lundi → vendredi) du membre dans la semaine, hors indisponibilité hebdomadaire. */
function workingDays(member: Pick<RecapMember, 'unavailable_weekdays'>, week: WeekRange): string[] {
  const days: string[] = []
  for (let i = 0; i < 5; i += 1) {
    const day = addDays(week.start, i)
    if (!member.unavailable_weekdays.includes(weekdayOf(day))) days.push(day)
  }
  return days
}

export type LoadLevel = 'ok' | 'tight' | 'over'

export interface MemberLoad {
  memberId: string
  name: string
  /** Heures estimées des tâches ouvertes dues dans la semaine. */
  hours: number
  openTasks: number
  /** Tâches sans estimation (heures inconnues, donc sous-évaluées). */
  unestimated: number
  /** Capacité de la semaine après absences : capacité hebdo × jours présents / jours ouvrés. */
  capacityHours: number
  absentDays: number
  /** ok < 80 % de la capacité, tight de 80 à 100 %, over au-delà (ou capacité nulle avec du travail). */
  level: LoadLevel
}

export function loadLevel(hours: number, capacityHours: number): LoadLevel {
  if (hours <= 0) return 'ok'
  if (capacityHours <= 0) return 'over'
  const ratio = hours / capacityHours
  return ratio > 1 ? 'over' : ratio >= 0.8 ? 'tight' : 'ok'
}

/**
 * Charge de chaque membre actif pour `week` : tâches ouvertes qui lui sont attribuées et dues dans la
 * semaine, face à sa capacité (absences datées déduites des jours ouvrés).
 */
export function weeklyLoads(
  members: readonly RecapMember[],
  tasks: readonly RecapTask[],
  absences: readonly RecapAbsence[],
  week: WeekRange,
): MemberLoad[] {
  return members
    .filter((m) => m.removed_at === null && (m.role === 'admin' || m.role === 'membre'))
    .map((member) => {
      const days = workingDays(member, week)
      const mine = absences.filter((a) => a.member_id === member.id)
      const absentDays = days.filter((day) => mine.some((a) => a.start_date <= day && day <= a.end_date)).length
      const present = days.length - absentDays
      const capacityHours = days.length === 0 ? 0 : (member.weekly_capacity_hours * present) / days.length
      const due = tasks.filter(
        (t) => t.assignee_member_id === member.id && t.status !== 'done' && t.due_date !== null && inWeek(t.due_date, week),
      )
      const hours = due.reduce((sum, t) => sum + (t.estimate_hours ?? 0), 0)
      return {
        memberId: member.id,
        name: member.name,
        hours,
        openTasks: due.length,
        unestimated: due.filter((t) => t.estimate_hours === null).length,
        capacityHours,
        absentDays,
        level: loadLevel(hours, capacityHours),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/* ---------- Temps passé ---------- */

export type RecapTimeEntry = Pick<TimeEntry, 'member_id' | 'started_at' | 'duration_minutes' | 'task_id'>

export interface TimeByMember {
  memberId: string
  name: string
  minutes: number
}

/** Temps saisi (entrées terminées) dont le début tombe dans la semaine, par personne, du plus long au plus court. */
export function timeInWeek(entries: readonly RecapTimeEntry[], members: readonly RecapMember[], week: WeekRange): TimeByMember[] {
  const names = new Map(members.map((m) => [m.id, m.name]))
  const totals = new Map<string, number>()
  for (const e of entries) {
    if (e.duration_minutes === null || !inWeek(parisDay(e.started_at), week)) continue
    totals.set(e.member_id, (totals.get(e.member_id) ?? 0) + e.duration_minutes)
  }
  return [...totals.entries()]
    .map(([memberId, minutes]) => ({ memberId, name: names.get(memberId) ?? 'Membre', minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'fr'))
}

/** Identifiants des tâches ayant du temps saisi pendant la semaine (proxy de « travaillées cette semaine »). */
export function taskIdsWithTime(entries: readonly RecapTimeEntry[], week: WeekRange): Set<string> {
  const ids = new Set<string>()
  for (const e of entries) if (e.task_id && inWeek(parisDay(e.started_at), week)) ids.add(e.task_id)
  return ids
}

/** 95 → « 1 h 35 », 120 → « 2 h », 40 → « 40 min ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** 6 → « 6 h », 6,5 → « 6,5 h ». */
export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(hours)} h`
}

/** Corps de la notification du lundi. */
export function recapNotificationBody(previous: WeekRange): string {
  return `Le résumé de la semaine ${weekLabel(previous)} est prêt : chiffre d'affaires, tâches, retards et charge de la semaine.`
}

