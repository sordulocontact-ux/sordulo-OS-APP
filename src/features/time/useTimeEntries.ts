import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Project, Task, TimeEntry } from '../../shared/types'
import { useCurrentMember } from '../auth'

/** Clés propres à la feature : tout commence par 'time-entries', une invalidation du préfixe rafraîchit tout. */
export const timeKeys = {
  all: ['time-entries'] as const,
  project: (projectId: string) => ['time-entries', 'project', projectId] as const,
  running: (memberId: string) => ['time-entries', 'running', memberId] as const,
}

export type RunningEntry = TimeEntry & {
  task: Pick<Task, 'id' | 'title'> | null
  project: Pick<Project, 'id' | 'name'> | null
}

/** Entrées de temps d'un projet, les plus récentes d'abord. */
export function useProjectTimeEntries(projectId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.project(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .eq('project_id', projectId ?? '')
        .order('started_at', { ascending: false })
        .overrideTypes<TimeEntry[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Le minuteur en cours du membre connecté (au plus un, la base l'impose), avec sa tâche et son projet. */
export function useRunningEntry() {
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useQuery({
    queryKey: timeKeys.running(memberId),
    enabled: Boolean(memberId),
    // Un minuteur peut être arrêté depuis un autre appareil.
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_entries')
        .select('*, task:tasks(id, title), project:projects(id, name)')
        .eq('member_id', memberId)
        .is('ended_at', null)
        .limit(1)
        .overrideTypes<RunningEntry[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** Heure courante rafraîchie toutes les `intervalMs` tant que `active` (minuteur qui défile). */
export function useNow(active: boolean, intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    // Premier tour tout de suite : `now` peut dater de l'avant-dernier rendu.
    const first = window.setTimeout(() => setNow(new Date()), 0)
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [active, intervalMs])
  return now
}

export interface TimerTarget {
  id: string
  project_id: string
  title: string
}

export interface TimerResult {
  /** Titre de la tâche (ou nom du projet) dont le minuteur a été arrêté pour démarrer le nouveau. */
  stopped: string | null
}

/** Démarrer (arrête d'abord le minuteur en cours), arrêter. */
export function useTimerActions() {
  const queryClient = useQueryClient()
  const { data: running } = useRunningEntry()
  const refresh = () => queryClient.invalidateQueries({ queryKey: timeKeys.all })

  const stop = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from('time_entries')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', entryId)
        .is('ended_at', null)
      if (error) throw error
    },
    onSettled: refresh,
  })

  const start = useMutation({
    mutationFn: async (target: TimerTarget): Promise<TimerResult> => {
      let stopped: string | null = null
      if (running) {
        const { error } = await supabase
          .from('time_entries')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', running.id)
          .is('ended_at', null)
        if (error) throw error
        stopped = running.task?.title ?? running.project?.name ?? 'la tâche précédente'
      }
      const { error } = await supabase.from('time_entries').insert({ project_id: target.project_id, task_id: target.id })
      if (error) throw error
      return { stopped }
    },
    onSettled: refresh,
  })

  return { running: running ?? null, start, stop }
}

export interface EntryInput {
  project_id: string
  task_id: string | null
  started_at: string
  duration_minutes: number
  note: string | null
}

/** Saisie manuelle, modification et suppression d'une entrée. */
export function useEntryMutations() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: timeKeys.all })
  const create = useMutation({
    mutationFn: async (input: EntryInput) => {
      const { error } = await supabase.from('time_entries').insert(input)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Omit<EntryInput, 'project_id'> }) => {
      const { error } = await supabase.from('time_entries').update(input).eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('time_entries').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { create, update, remove }
}
