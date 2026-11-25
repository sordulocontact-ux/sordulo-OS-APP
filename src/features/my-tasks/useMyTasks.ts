import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Project, Task, TaskStatus } from '../../shared/types'
import { useCurrentMember } from '../auth'
import { isVisibleTask, type TaskTicket } from '../tasks/board'

export type MyTask = Task & { ticket: TaskTicket | null; project: Pick<Project, 'id' | 'name'> | null }

const SELECT = '*, ticket:tickets(id, title, type, priority, status), project:projects(id, name)'
export const RECENT_DONE_LIMIT = 10

export const myTasksKey = (memberId: string) => ['my-tasks', memberId] as const

/** Mes tâches non terminées de tous les projets (tickets validés ou sans ticket), et les dernières faites. */
export function useMyTasks() {
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useQuery({
    queryKey: myTasksKey(memberId),
    enabled: Boolean(memberId),
    queryFn: async () => {
      const [open, done] = await Promise.all([
        supabase
          .from('tasks')
          .select(SELECT)
          .eq('assignee_member_id', memberId)
          .neq('status', 'done')
          .overrideTypes<MyTask[], { merge: false }>(),
        // Dernières faites par date de fin (0016) ; les tâches finies avant la migration (done_at null) à la fin.
        supabase
          .from('tasks')
          .select(SELECT)
          .eq('assignee_member_id', memberId)
          .eq('status', 'done')
          .order('done_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(RECENT_DONE_LIMIT * 3)
          .overrideTypes<MyTask[], { merge: false }>(),
      ])
      if (open.error) throw open.error
      if (done.error) throw done.error
      return {
        open: open.data.filter(isVisibleTask),
        done: done.data.filter(isVisibleTask).slice(0, RECENT_DONE_LIMIT),
      }
    },
  })
}

/** Change le statut d'une de mes tâches, puis rafraîchit la liste et le kanban du projet. */
export function useChangeMyTaskStatus(onError: (message: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ task, status }: { task: MyTask; status: TaskStatus }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', task.id)
      if (error) throw error
    },
    onError: () => onError('Impossible de changer le statut de la tâche.'),
    onSettled: (_data, _error, { task }) => {
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(task.project_id) })
    },
  })
}
