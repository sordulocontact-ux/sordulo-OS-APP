import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { MemberRole } from '../../shared/types'
import { FINANCE_ROLES, PROJECT_ROLES } from '../auth/roles'
import {
  addDays,
  collectedInWeek,
  doneByMember,
  doneInWeekIds,
  lateProjects,
  recapWeeks,
  taskIdsWithTime,
  timeInWeek,
  weeklyLoads,
  type DoneByMember,
  type LateProject,
  type MemberLoad,
  type RecapAbsence,
  type RecapInvoice,
  type RecapMember,
  type RecapProject,
  type RecapTask,
  type RecapTimeEntry,
  type TimeByMember,
  type WeekRange,
} from './recapLogic'

export interface WeeklyRecap {
  key: string
  today: string
  previous: WeekRange
  current: WeekRange
  /** `null` : le rôle ne lit pas les factures. */
  collectedCents: number | null
  /** `null` : le rôle ne lit pas les tâches. */
  done: DoneByMember[] | null
  lateProjects: LateProject[]
  loads: MemberLoad[] | null
  time: TimeByMember[]
}

/** Récap de la semaine écoulée et de la semaine qui commence ; chaque section selon les droits du rôle. */
export function useWeeklyRecap(organizationId: string | undefined, role: MemberRole | undefined) {
  const weeks = recapWeeks()
  return useQuery({
    queryKey: ['recap', organizationId ?? '', weeks.key, role ?? ''] as const,
    enabled: Boolean(organizationId && role),
    queryFn: async (): Promise<WeeklyRecap> => {
      const canMoney = role !== undefined && FINANCE_ROLES.includes(role)
      const canWork = role !== undefined && PROJECT_ROLES.includes(role)
      const { previous, current } = weeks
      // Marge d'un jour de chaque côté : les bornes sont en UTC, les semaines en jours de Paris.
      const since = `${addDays(previous.start, -1)}T00:00:00Z`

      const [members, projects, entries] = await Promise.all([
        supabase.from('members').select('id, name, role, weekly_capacity_hours, unavailable_weekdays, removed_at').eq('organization_id', organizationId ?? '').overrideTypes<RecapMember[], { merge: false }>(),
        supabase.from('projects').select('id, name, status, due_date').overrideTypes<RecapProject[], { merge: false }>(),
        supabase.from('time_entries').select('member_id, started_at, duration_minutes, task_id').gte('started_at', since).overrideTypes<RecapTimeEntry[], { merge: false }>(),
      ])
      if (members.error) throw members.error
      if (projects.error) throw projects.error
      if (entries.error) throw entries.error

      let collectedCents: number | null = null
      if (canMoney) {
        const res = await supabase
          .from('invoices')
          .select('id, kind, status, issue_date, paid_at, credited_invoice_id, total_ht_cents')
          .neq('status', 'draft')
          .or(`paid_at.gte.${since},issue_date.gte.${previous.start}`)
          .overrideTypes<RecapInvoice[], { merge: false }>()
        if (res.error) throw res.error
        const invoices = res.data
        const known = new Set(invoices.map((i) => i.id))
        const missing = [...new Set(invoices.flatMap((i) => (i.kind === 'credit_note' && i.credited_invoice_id && !known.has(i.credited_invoice_id) ? [i.credited_invoice_id] : [])))]
        if (missing.length > 0) {
          const credited = await supabase.from('invoices').select('id, paid_at').in('id', missing).overrideTypes<{ id: string; paid_at: string | null }[], { merge: false }>()
          if (credited.error) throw credited.error
          const paidAt = new Map(credited.data.map((c) => [c.id, c.paid_at]))
          for (const i of invoices) if (i.credited_invoice_id && paidAt.has(i.credited_invoice_id)) i.credited_paid_at = paidAt.get(i.credited_invoice_id) ?? null
        }
        collectedCents = collectedInWeek(invoices, previous)
      }

      let done: DoneByMember[] | null = null
      let loads: MemberLoad[] | null = null
      if (canWork) {
        const [open, absences] = await Promise.all([
          supabase
            .from('tasks')
            .select('id, title, project_id, assignee_member_id, status, estimate_hours, due_date, done_at')
            .neq('status', 'done')
            .overrideTypes<RecapTask[], { merge: false }>(),
          supabase
            .from('member_absences')
            .select('member_id, start_date, end_date')
            .gte('end_date', current.start)
            .lte('start_date', current.end)
            .overrideTypes<RecapAbsence[], { merge: false }>(),
        ])
        if (open.error) throw open.error
        if (absences.error) throw absences.error
        loads = weeklyLoads(members.data, open.data, absences.data, current)

        // Date de fin (0016) ; repli sur le temps saisi pour les tâches finies avant la migration.
        const withTime = taskIdsWithTime(entries.data, previous)
        const sinceDone = `${addDays(previous.start, -1)}T00:00:00Z`
        const untilDone = `${addDays(previous.end, 2)}T00:00:00Z`
        const filters = [`and(done_at.gte.${sinceDone},done_at.lt.${untilDone})`]
        if (withTime.size > 0) filters.push(`and(done_at.is.null,id.in.(${[...withTime].join(',')}))`)
        const finished = await supabase
          .from('tasks')
          .select('id, title, project_id, assignee_member_id, status, estimate_hours, due_date, done_at')
          .eq('status', 'done')
          .or(filters.join(','))
          .overrideTypes<RecapTask[], { merge: false }>()
        if (finished.error) throw finished.error
        done = doneByMember(finished.data, doneInWeekIds(finished.data, previous, withTime), members.data)
      }

      return {
        key: weeks.key,
        today: weeks.today,
        previous,
        current,
        collectedCents,
        done,
        lateProjects: lateProjects(projects.data, weeks.today),
        loads,
        time: timeInWeek(entries.data, members.data, previous),
      }
    },
  })
}
