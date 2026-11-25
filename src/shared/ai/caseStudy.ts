/** Action IA « caseStudy » : projet livré et montrable → étude de cas pour sordulo.com (POST /api/ai/run, action caseStudy). */
import { z } from 'zod'
import type { CaseStudy, Project } from '../types.js'

export interface CaseStudyRequest {
  projectId: string
}

/** Étude de cas enregistrée dans projects.case_study : les champs de CaseStudy, plus ceux de l'IA. */
export interface CaseStudyContent extends CaseStudy {
  /** Contexte du client et du projet. */
  context?: string
  /** Titres des livrables du projet (repris de la base, pas écrits par l'IA). */
  deliverables?: string[]
  /** Citation du client, reprise mot pour mot d'un de ses commentaires. */
  client_quote?: { text: string; author: string | null } | null
}

export interface CaseStudyResponse {
  caseStudy: CaseStudyContent
}

/** Ce que Claude rédige. `summary` du CaseStudy = l'accroche. */
export const CaseStudyOutputSchema = z.object({
  title: z.string(),
  hook: z.string(),
  context: z.string(),
  challenge: z.string(),
  solution: z.string(),
  /** Seulement des résultats qui figurent dans les données. */
  results: z.array(z.string()),
  /** Un extrait mot pour mot d'un commentaire du client, ou null. */
  client_quote: z.object({ text: z.string(), author: z.string().nullable() }).nullable(),
})
export type CaseStudyOutput = z.infer<typeof CaseStudyOutputSchema>

/** Droits : étude de cas possible seulement si le projet est montrable et livré ou payé. */
export type CaseStudyBlock = 'nda' | 'unknown' | 'not_delivered'

export function caseStudyBlock(project: Pick<Project, 'showcase' | 'status'>): CaseStudyBlock | null {
  if (project.showcase === 'nda') return 'nda'
  if (project.showcase !== 'showable') return 'unknown'
  if (project.status !== 'delivered' && project.status !== 'paid') return 'not_delivered'
  return null
}

export const CASE_STUDY_BLOCK_MESSAGE: Record<CaseStudyBlock, string> = {
  nda: 'Ce projet est sous NDA : aucune étude de cas ne peut être proposée.',
  unknown: 'Indique d’abord que le projet est montrable avant de proposer une étude de cas.',
  not_delivered: 'L’étude de cas se propose quand le projet est livré ou payé.',
}

const normalizeSpaces = (text: string): string =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Nombres d'un texte (« 12,5 », « 40 »), virgule ramenée au point. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'))
}

/** Garde les résultats dont tous les chiffres figurent dans les données ; les autres sont écartés. */
export function supportedResults(results: readonly string[], sourceText: string): string[] {
  const known = new Set(numbersIn(sourceText))
  return results.map((r) => r.replace(/\s+/g, ' ').trim()).filter((r) => r !== '' && numbersIn(r).every((n) => known.has(n)))
}

export interface ClientComment {
  body: string
  author: string | null
}

/** La citation n'est gardée que si son texte est un extrait d'un commentaire du client. */
export function verifiedQuote(
  quote: CaseStudyOutput['client_quote'],
  comments: readonly ClientComment[],
): { text: string; author: string | null } | null {
  if (!quote) return null
  const wanted = normalizeSpaces(quote.text.replace(/^["«\s]+|["»\s]+$/g, ''))
  if (wanted === '') return null
  const source = comments.find((c) => normalizeSpaces(c.body).includes(wanted))
  if (!source) return null
  return { text: quote.text.replace(/^["«\s]+|["»\s]+$/g, '').trim(), author: source.author ?? quote.author }
}

export interface CaseStudySource {
  /** Tout ce qui a été donné à Claude : sert à vérifier les chiffres. */
  text: string
  deliverableTitles: readonly string[]
  clientComments: readonly ClientComment[]
}

/** Assemble l'étude de cas : texte de Claude contrôlé, livrables repris de la base, brouillon à relire. */
export function buildCaseStudy(output: CaseStudyOutput, source: CaseStudySource, previous: CaseStudy | null): CaseStudyContent {
  const results = supportedResults(output.results, source.text)
  const quote = verifiedQuote(output.client_quote, source.clientComments)
  const clean = (t: string): string => t.trim()
  return {
    ...(previous?.file_ids ? { file_ids: previous.file_ids } : {}),
    title: clean(output.title),
    summary: clean(output.hook),
    context: clean(output.context),
    challenge: clean(output.challenge),
    solution: clean(output.solution),
    results: results.map((r) => `- ${r}`).join('\n'),
    deliverables: [...source.deliverableTitles],
    client_quote: quote,
    status: 'draft',
  }
}

/** Texte à coller sur sordulo.com. */
export function caseStudyToMarkdown(cs: CaseStudyContent): string {
  const section = (title: string, text: string | undefined): string[] => (text && text.trim() !== '' ? [`## ${title}`, text.trim()] : [])
  const parts = [
    `# ${cs.title?.trim() || 'Étude de cas'}`,
    ...(cs.summary?.trim() ? [`*${cs.summary.trim()}*`] : []),
    ...section('Contexte', cs.context),
    ...section('Défi', cs.challenge),
    ...section('Solution', cs.solution),
    ...section('Résultats', cs.results),
    ...(cs.deliverables && cs.deliverables.length > 0 ? ['## Livrables', cs.deliverables.map((d) => `- ${d}`).join('\n')] : []),
    ...(cs.client_quote ? [`> ${cs.client_quote.text}${cs.client_quote.author ? `\n> ${cs.client_quote.author}` : ''}`] : []),
  ]
  return `${parts.join('\n\n')}\n`
}
