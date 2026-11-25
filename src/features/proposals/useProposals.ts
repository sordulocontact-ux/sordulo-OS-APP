/**
 * Données des propositions de l'IA : en attente, historique, règles « Toujours », titres des tâches citées ;
 * décisions par les RPC (apply_ai_proposal, refuse_ai_proposal, undo_ai_proposal) ; action IA « replan ».
 * La RLS limite tout aux admins et membres de l'organisation.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runAi } from '../../lib/ai'
import { supabase } from '../../lib/supabase'
import type { ReplanRequest, ReplanResponse } from '../../shared/ai/replan'
import type { AiAutonomyRule, AiProposal, Task } from '../../shared/types'
import type { ProposalDecision } from './proposalLogic'

/** Clés TanStack Query de la feature (toutes sous `ai-proposals`). */
export const proposalKeys = {
  all: () => ['ai-proposals'] as const,
  pending: (organizationId: string) => ['ai-proposals', organizationId, 'pending'] as const,
  history: (organizationId: string) => ['ai-proposals', organizationId, 'history'] as const,
  rules: (organizationId: string) => ['ai-proposals', organizationId, 'rules'] as const,
  tasks: (taskIds: readonly string[]) => ['ai-proposals', 'tasks', ...taskIds] as const,
}

/** Nombre de propositions traitées affichées dans l'historique. */
export const HISTORY_LIMIT = 50

export function usePendingProposals(organizationId: string | undefined) {
  return useQuery({
    queryKey: proposalKeys.pending(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_proposals')
        .select('*')
        .eq('organization_id', organizationId ?? '')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .overrideTypes<AiProposal[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function useProposalHistory(organizationId: string | undefined) {
  return useQuery({
    queryKey: proposalKeys.history(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_proposals')
        .select('*')
        .eq('organization_id', organizationId ?? '')
        .neq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT)
        .overrideTypes<AiProposal[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Règles « Toujours » actives. */
export function useAutonomyRules(organizationId: string | undefined) {
  return useQuery({
    queryKey: proposalKeys.rules(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_autonomy_rules')
        .select('*')
        .eq('organization_id', organizationId ?? '')
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .overrideTypes<AiAutonomyRule[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export type ProposalTask = Pick<Task, 'id' | 'title' | 'project_id'>

/** Titres des tâches citées par les propositions (ids triés). */
export function useProposalTasks(taskIds: readonly string[]) {
  return useQuery({
    queryKey: proposalKeys.tasks(taskIds),
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, project_id')
        .in('id', [...taskIds])
        .overrideTypes<ProposalTask[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Après une décision : propositions, tâches (kanban) et notifications rechargées. */
function invalidateAfterChange(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: proposalKeys.all() })
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  void queryClient.invalidateQueries({ queryKey: ['notifications'] })
}

/** Valider, Toujours, Refuser ou Annuler une proposition. Renvoie la proposition à jour. */
export function useDecideProposal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: ProposalDecision }): Promise<AiProposal> => {
      const call =
        decision === 'apply' || decision === 'always'
          ? supabase.rpc('apply_ai_proposal', { p_id: id, p_always: decision === 'always' })
          : decision === 'refuse'
            ? supabase.rpc('refuse_ai_proposal', { p_id: id })
            : supabase.rpc('undo_ai_proposal', { p_id: id })
      const { data, error } = await call
      if (error) throw error
      return data as AiProposal
    },
    onSettled: () => invalidateAfterChange(queryClient),
  })
}

/** Révoque une règle « Toujours » (les prochaines propositions de ce type reviendront à valider). */
export function useRevokeRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase.from('ai_autonomy_rules').update({ revoked_at: new Date().toISOString() }).eq('id', ruleId)
      if (error) throw error
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: proposalKeys.all() }),
  })
}

/** Lance l'analyse du planning (action IA « replan »). */
export function useReplan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ReplanRequest) => runAi<ReplanRequest, ReplanResponse>('replan', request),
    onSettled: () => invalidateAfterChange(queryClient),
  })
}

/** Message d'erreur affichable (Supabase, API ou autre). */
export function proposalErrorText(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de faire cette action.'
  return message || 'Une erreur est survenue. Réessaie.'
}
