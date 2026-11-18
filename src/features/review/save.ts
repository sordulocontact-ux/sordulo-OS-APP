import { supabase } from '../../lib/supabase'
import { isPlanEmpty, type SavePlan } from './diff'

function fail(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what} : ${error.message}`)
}

/** Runs a plan: tasks first, the ticket (and its status) last, so a ticket is never validated half saved. */
export async function executePlan(ticketId: string, plan: SavePlan): Promise<void> {
  if (isPlanEmpty(plan)) return
  for (const { id, patch } of plan.taskUpdates) {
    const { error } = await supabase.from('tasks').update(patch).eq('id', id)
    fail(error, 'Mise à jour de tâche impossible')
  }
  if (plan.taskInserts.length > 0) {
    const { error } = await supabase.from('tasks').insert(plan.taskInserts)
    fail(error, 'Ajout de tâche impossible')
  }
  if (plan.taskDeletes.length > 0) {
    const { error } = await supabase.from('tasks').delete().in('id', plan.taskDeletes)
    fail(error, 'Suppression de tâche impossible')
  }
  if (Object.keys(plan.ticketPatch).length > 0) {
    const { error } = await supabase.from('tickets').update(plan.ticketPatch).eq('id', ticketId)
    fail(error, 'Mise à jour du ticket impossible')
  }
}
