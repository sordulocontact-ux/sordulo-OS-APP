import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { filterVisible, patchTask, type BoardTask } from './board'
import type { Task } from '../../shared/types'

/**
 * Tasks of a project with their ticket. The cache holds the full list (needed to resolve dependencies);
 * `tasks` is the list the kanban shows (ticket validated or done, or no ticket).
 */
export function useProjectTasks(projectId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.tasks(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, ticket:tickets(id, title, type, priority, status)')
        .eq('project_id', projectId ?? '')
        .order('position')
        .overrideTypes<BoardTask[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
  const allTasks = query.data
  const tasks = useMemo(() => (allTasks ? filterVisible(allTasks) : undefined), [allTasks])
  return { ...query, tasks, allTasks }
}

export type TaskPatch = Partial<Pick<Task, 'status' | 'position' | 'assignee_member_id' | 'due_date' | 'priority'>>

/** Optimistic task update: patch the cache, roll back on error, refetch at the end. */
export function useUpdateTask(projectId: string, onError: (message: string) => void) {
  const queryClient = useQueryClient()
  const key = queryKeys.tasks(projectId)
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskPatch }) => {
      const { error } = await supabase.from('tasks').update(patch).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BoardTask[]>(key)
      queryClient.setQueryData<BoardTask[]>(key, (old) => (old ? patchTask(old, id, patch) : old))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      onError('Impossible de mettre à jour la tâche. La modification a été annulée.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
