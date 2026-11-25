import { useMutation, useQueryClient } from '@tanstack/react-query'
import { runAi } from '../../lib/ai'
import { queryKeys } from '../../lib/queryKeys'
import { supabase } from '../../lib/supabase'
import type { CaseStudyContent, CaseStudyRequest, CaseStudyResponse } from '../../shared/ai/caseStudy'
import type { ProjectShowcase } from '../../shared/types'

function useInvalidateProject(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
  }
}

async function updateProject(projectId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.from('projects').update(patch).eq('id', projectId).select('id')
  if (error) throw error
  if (data.length === 0) throw Object.assign(new Error('row-level security'), { code: '42501' })
}

export function useSetShowcase(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: (showcase: ProjectShowcase) => updateProject(projectId, { showcase }),
    onSettled: invalidate,
  })
}

export function useSaveCaseStudy(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: (caseStudy: CaseStudyContent) => updateProject(projectId, { case_study: caseStudy }),
    onSettled: invalidate,
  })
}

/** L'action IA enregistre elle-même l'étude dans projects.case_study. */
export function useProposeCaseStudy(projectId: string) {
  const invalidate = useInvalidateProject(projectId)
  return useMutation({
    mutationFn: async () => (await runAi<CaseStudyRequest, CaseStudyResponse>('caseStudy', { projectId })).caseStudy,
    onSettled: invalidate,
  })
}
