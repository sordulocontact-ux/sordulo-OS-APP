import { caseStudyBlock, CASE_STUDY_BLOCK_MESSAGE, type CaseStudyContent } from '../../shared/ai/caseStudy'
import type { Project, ProjectShowcase } from '../../shared/types'

export const SHOWCASE_LABEL: Record<ProjectShowcase, string> = {
  unknown: 'À définir',
  showable: 'Montrable',
  nda: 'Sous NDA',
}

export type CaseStudyAvailability =
  | { kind: 'ready' }
  /** Pas de proposition possible, avec la raison à afficher. */
  | { kind: 'blocked'; reason: string; nda: boolean }

/** Étude de cas proposable : montrable, et projet livré ou payé. Sous NDA : jamais. */
export function caseStudyAvailability(project: Pick<Project, 'showcase' | 'status'>): CaseStudyAvailability {
  const block = caseStudyBlock(project)
  return block === null ? { kind: 'ready' } : { kind: 'blocked', reason: CASE_STUDY_BLOCK_MESSAGE[block], nda: block === 'nda' }
}

export interface CaseStudyForm {
  title: string
  summary: string
  context: string
  challenge: string
  solution: string
  results: string
  quoteText: string
  quoteAuthor: string
  ready: boolean
}

export function formFromCaseStudy(cs: CaseStudyContent | null): CaseStudyForm {
  return {
    title: cs?.title ?? '',
    summary: cs?.summary ?? '',
    context: cs?.context ?? '',
    challenge: cs?.challenge ?? '',
    solution: cs?.solution ?? '',
    results: cs?.results ?? '',
    quoteText: cs?.client_quote?.text ?? '',
    quoteAuthor: cs?.client_quote?.author ?? '',
    ready: cs?.status === 'ready',
  }
}

/** Étude de cas à enregistrer : champs édités, livrables et fichiers conservés. */
export function caseStudyFromForm(form: CaseStudyForm, previous: CaseStudyContent | null): CaseStudyContent {
  const quote = form.quoteText.trim()
  return {
    ...(previous?.file_ids ? { file_ids: previous.file_ids } : {}),
    ...(previous?.deliverables ? { deliverables: previous.deliverables } : {}),
    title: form.title.trim(),
    summary: form.summary.trim(),
    context: form.context.trim(),
    challenge: form.challenge.trim(),
    solution: form.solution.trim(),
    results: form.results.trim(),
    client_quote: quote === '' ? null : { text: quote, author: form.quoteAuthor.trim() === '' ? null : form.quoteAuthor.trim() },
    status: form.ready ? 'ready' : 'draft',
  }
}

export function hasCaseStudyChanges(a: CaseStudyForm, b: CaseStudyForm): boolean {
  return (Object.keys(a) as (keyof CaseStudyForm)[]).some((k) => a[k] !== b[k])
}

export function showcaseErrorText(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501' || message.toLowerCase().includes('row-level security')) return 'Ton rôle ne permet pas de modifier ce projet.'
  return message || 'Une erreur est survenue. Réessaie.'
}
