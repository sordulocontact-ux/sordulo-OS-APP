/**
 * Post-traitement de la classification de Claude, en code (pur, testé) : ids inconnus → null, document de
 * l'app rapproché par son numéro (son projet et son client priment), doublon, version précédente, dossier,
 * confiance finale, import et tickets proposés.
 */
import type { Classification } from '../../../src/shared/ai/classify.js'
import { NO_PROJECT_CONFIDENCE_CAP, baseName, finalConfidence, normalizeFolder } from '../../../src/shared/filing.js'
import type { FileIntakeProposal } from '../../../src/shared/types.js'
import { ACTIVE_PROJECT_STATUSES, type ClientRef, type DocumentRef, type FileRef, type ProjectRef, type VersionCandidate } from './types.js'

const TITLE_MAX = 200
const SUMMARY_MAX = 2000
const REASON_MAX = 300
const REASONS_MAX = 5
const NUMBER_MAX = 100

function cleanText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/[ \t]+/g, ' ').trim()
  return text === '' ? null : text.slice(0, max).trim()
}

function cleanDate(value: string | null): string | null {
  const text = value?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const date = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text
}

function cleanAmount(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value)
}

/** Numéro de document tel que lu (rogné, espaces réduits), null si vide. */
export function cleanDocumentNumber(value: string | null | undefined): string | null {
  return cleanText(value?.replace(/\s+/g, ' '), NUMBER_MAX)
}

/** Variantes exactes cherchées en base : le numéro rogné, et en majuscules s'il diffère. */
export function documentNumberVariants(value: string | null | undefined): string[] {
  const number = cleanDocumentNumber(value)
  if (!number) return []
  return [...new Set([number, number.toUpperCase()])]
}

/**
 * Document de l'app dont le numéro correspond EXACTEMENT. Plusieurs correspondances (même numéro chez deux
 * émetteurs) : celle du client proposé par l'IA, sinon aucune (pas de devinette).
 */
export function pickLinkedDocument(matches: readonly DocumentRef[], aiClientId: string | null): DocumentRef | null {
  if (matches.length === 1) return matches[0]!
  const sameClient = matches.filter((d) => aiClientId !== null && d.client_id === aiClientId)
  return sameClient.length === 1 ? sameClient[0]! : null
}

/** Dernière version de chaque groupe parmi ces fichiers. */
export function latestVersions<F extends FileRef>(files: readonly F[]): F[] {
  const byGroup = new Map<string, F>()
  for (const file of files) {
    const current = byGroup.get(file.version_group_id)
    if (!current || file.version > current.version) byGroup.set(file.version_group_id, file)
  }
  return [...byGroup.values()]
}

export interface FinalizeInput {
  ai: Classification
  intake: { name: string; sha256: string | null }
  clients: readonly ClientRef[]
  projects: readonly ProjectRef[]
  /** Correspondance exacte du numéro (devis si kind = quote, facture si kind = invoice), déjà choisie. */
  linkedDocument: DocumentRef | null
  /** Fichiers déjà reliés à ce document (versions précédentes possibles). */
  linkedFiles: readonly FileRef[]
  duplicates: readonly FileRef[]
  candidates: readonly VersionCandidate[]
  /** Faux quand Claude n'a vu que le nom et le type du fichier : confiance plafonnée à 0,5. */
  contentReadable?: boolean
  /**
   * Faux sans accès aux devis et factures (rôle membre) : aucun document relié, pas d'import proposé
   * (on n'a pas cherché le document). Le type quote / invoice reste proposé. Vrai par défaut.
   */
  billing?: boolean
}

export interface FinalizedProposal {
  proposal: FileIntakeProposal
  /** Confiance finale (= proposal.confidence), à écrire dans file_intakes.confidence. */
  confidence: number
  /** Le projet vient du document de l'app rapproché (il prime sur une règle « Toujours »). */
  projectFromDocument: boolean
  projectAmbiguous: boolean
}

export function finalizeProposal(input: FinalizeInput): FinalizedProposal {
  const { ai } = input
  const kind = ai.kind
  const clientIds = new Set(input.clients.map((c) => c.id))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))

  let clientId = ai.client_id && clientIds.has(ai.client_id) ? ai.client_id : null
  let projectId = ai.project_id && projectsById.has(ai.project_id) ? ai.project_id : null
  let projectFromDocument = false

  const billing = input.billing !== false
  const linked = billing && (kind === 'quote' || kind === 'invoice') ? input.linkedDocument : null
  if (linked) {
    clientId = linked.client_id
    if (linked.project_id) {
      projectId = linked.project_id
      projectFromDocument = true
    }
  }

  // Le client du projet fait foi ; un projet choisi par l'IA pour un autre client rend le projet douteux.
  let clientMismatch = false
  const project = projectId ? projectsById.get(projectId) : undefined
  if (project?.client_id) {
    if (clientId && clientId !== project.client_id && !projectFromDocument) clientMismatch = true
    if (!linked || projectFromDocument) clientId = project.client_id
  }

  const activeProjectsOfClient = clientId
    ? input.projects.filter((p) => p.client_id === clientId && ACTIVE_PROJECT_STATUSES.includes(p.status)).length
    : 0
  const projectAmbiguous =
    projectId !== null && !projectFromDocument && (clientMismatch || (!ai.project_evidence && activeProjectsOfClient >= 2))

  const duplicate =
    input.duplicates.find((f) => f.project_id === projectId) ?? input.duplicates[0] ?? null

  let previous: FileRef | null = null
  let changeSummary: string | null = null
  if (!duplicate && projectId) {
    const notSame = (f: FileRef) => !(input.intake.sha256 && f.sha256 === input.intake.sha256)
    const aiPick = input.candidates.find((c) => c.id === ai.previous_version_file_id && c.project_id === projectId && notSame(c))
    if (aiPick) {
      const latest = latestVersions(input.candidates.filter((c) => c.version_group_id === aiPick.version_group_id))[0] ?? aiPick
      previous = latest
      changeSummary = cleanText(ai.change_summary, SUMMARY_MAX)
    } else {
      const linkedInProject = latestVersions(input.linkedFiles.filter((f) => f.project_id === projectId && notSame(f)))
      previous = linkedInProject.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
    }
  }

  let confidence = finalConfidence({ aiConfidence: ai.confidence, hasProject: projectId !== null, projectAmbiguous })
  if (input.contentReadable === false) confidence = Math.min(confidence, NO_PROJECT_CONFIDENCE_CAP)
  const reasons = ai.reasons
    .map((r) => cleanText(r, REASON_MAX))
    .filter((r): r is string => r !== null)
    .slice(0, REASONS_MAX)

  const proposal: FileIntakeProposal = {
    kind,
    client_id: clientId,
    project_id: projectId,
    folder: normalizeFolder(ai.folder, kind),
    title: cleanText(ai.title, TITLE_MAX) ?? baseName(input.intake.name).slice(0, TITLE_MAX),
    summary: cleanText(ai.summary, SUMMARY_MAX),
    document_number: cleanDocumentNumber(ai.document_number),
    document_date: cleanDate(ai.document_date),
    amount_ttc_cents: cleanAmount(ai.amount_ttc_cents),
    confidence,
    reasons,
    linked_quote_id: linked && kind === 'quote' ? linked.id : null,
    linked_invoice_id: linked && kind === 'invoice' ? linked.id : null,
    duplicate_of_file_id: duplicate?.id ?? null,
    previous_version_file_id: previous?.id ?? null,
    change_summary: previous ? changeSummary : null,
    suggest_import: billing && (kind === 'quote' || kind === 'invoice') && !linked,
    suggest_tickets: kind === 'feedback',
  }
  return { proposal, confidence, projectFromDocument, projectAmbiguous }
}
