/**
 * Rangement des fichiers déposés (île ou app web) : logique pure partagée front / API.
 * Seuil de confiance, raisons de faire vérifier un dépôt, dossier par défaut, chemins Storage,
 * clé de version d'un nom de fichier, confiance finale et libellé court d'une proposition.
 * Sans dépendance (ni Supabase, ni React) : testé par src/shared/filing.test.ts.
 */
import {
  EXTRACTED_TEXT_MAX_LENGTH,
  FILE_FOLDER_MAX_LENGTH,
  FILE_KINDS,
  FILES_INBOX_FOLDER,
  FILING_CONFIDENCE_THRESHOLD,
  FOLDER_BY_KIND,
  LABELS,
  type FileIntake,
  type FileIntakeProposal,
  type FileKind,
} from './types.js'

export { DEFAULT_FOLDERS, FILE_KINDS, FILES_BUCKET, FILE_MAX_BYTES, FILING_CONFIDENCE_THRESHOLD } from './types.js'

/** Image envoyée à Claude telle quelle (bloc image) quand le dépôt n'a pas de texte. */
export const CLASSIFY_IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** PDF sans texte (scanné) envoyé à Claude tel quel (bloc document). */
export const CLASSIFY_PDF_MAX_BYTES = 10 * 1024 * 1024
export const CLASSIFY_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type ClassifyImageType = (typeof CLASSIFY_IMAGE_TYPES)[number]

/** Confiance maximale d'une proposition sans projet. */
export const NO_PROJECT_CONFIDENCE_CAP = 0.5
/** Confiance maximale quand le projet est ambigu (plusieurs projets actifs du client, aucun indice). */
export const AMBIGUOUS_PROJECT_CONFIDENCE_CAP = 0.6

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === 'string' && (FILE_KINDS as readonly string[]).includes(value)
}

/** Dossier proposé par défaut pour un type (Devis, Factures, Contrats…). */
export function defaultFolderFor(kind: FileKind): string {
  return FOLDER_BY_KIND[kind]
}

/**
 * Dossier valide : espaces réduits, 80 caractères au plus ; vide → dossier par défaut du type.
 * Un devis va toujours dans « Devis », une facture dans « Factures » (décision du ticket).
 */
export function normalizeFolder(folder: string | null | undefined, kind: FileKind): string {
  if (kind === 'quote' || kind === 'invoice') return defaultFolderFor(kind)
  const clean = (folder ?? '').replace(/\s+/g, ' ').trim().slice(0, FILE_FOLDER_MAX_LENGTH).trim()
  return clean === '' ? defaultFolderFor(kind) : clean
}

/* ---------- Noms et chemins Storage ---------- */

const STORAGE_NAME_MAX_LENGTH = 100

/** Extension en minuscules, sans le point (« pdf »), ou chaîne vide. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && base.length - dot <= 11 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Nom sans extension (« Devis Ibé v2.pdf » → « Devis Ibé v2 »). */
export function baseName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const ext = fileExtension(base)
  return ext ? base.slice(0, base.length - ext.length - 1) : base
}

/**
 * Nom de fichier sûr pour un chemin Storage : [A-Za-z0-9._-], accents retirés, le reste devient « - »,
 * 100 caractères au plus (extension gardée). Jamais vide (« fichier »).
 */
export function sanitizeStorageName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  let clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (clean.length > STORAGE_NAME_MAX_LENGTH) {
    const dot = clean.lastIndexOf('.')
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ''
    clean = clean.slice(0, STORAGE_NAME_MAX_LENGTH - ext.length).replace(/[-.]+$/, '') + ext
  }
  return clean || 'fichier'
}

/** Dépôt en attente : `<org>/inbox/<member>/<uuid>-<nom>` (seul le membre écrit dans son dossier). */
export function inboxPath(organizationId: string, memberId: string, uuid: string, fileName: string): string {
  return `${organizationId}/${FILES_INBOX_FOLDER}/${memberId}/${uuid}-${sanitizeStorageName(fileName)}`
}

/** Fichier rangé : `<org>/<project>/<uuid>-<nom>`. */
export function projectFilePath(organizationId: string, projectId: string, uuid: string, fileName: string): string {
  return `${organizationId}/${projectId}/${uuid}-${sanitizeStorageName(fileName)}`
}

/** Vrai pour un chemin de dépôt `<org>/inbox/<member>/<fichier>`. */
export function isInboxPath(path: string): boolean {
  return path.split('/')[1] === FILES_INBOX_FOLDER
}

/** Texte extrait d'un dépôt tel que stocké (file_intakes.extracted_text) : nettoyé, tronqué, null si vide. */
export function truncateExtractedText(text: string | null | undefined): string | null {
  // Postgres refuse le caractère nul dans un texte (PDF mal encodés).
  const clean = (text ?? '').split('\u0000').join('').trim()
  if (clean === '') return null
  return clean.length > EXTRACTED_TEXT_MAX_LENGTH ? clean.slice(0, EXTRACTED_TEXT_MAX_LENGTH) : clean
}

/** Image lisible par Claude (bloc image) : png, jpeg, webp, gif de 5 Mo au plus. */
export function isClassifiableImage(mimeType: string | null, sizeBytes: number | null): mimeType is ClassifyImageType {
  return (
    mimeType !== null &&
    (CLASSIFY_IMAGE_TYPES as readonly string[]).includes(mimeType) &&
    sizeBytes !== null &&
    sizeBytes <= CLASSIFY_IMAGE_MAX_BYTES
  )
}

/** PDF lisible par Claude (bloc document) : 10 Mo au plus. */
export function isClassifiablePdf(name: string, mimeType: string | null, sizeBytes: number | null): boolean {
  const pdf = mimeType === 'application/pdf' || fileExtension(name) === 'pdf'
  return pdf && sizeBytes !== null && sizeBytes <= CLASSIFY_PDF_MAX_BYTES
}

/* ---------- Versions ---------- */

/** Mots qui marquent une version ou une copie, ignorés pour reconnaître un même document. */
const VERSION_WORDS = new Set(['v', 'version', 'rev', 'revision', 'final', 'finale', 'def', 'definitif', 'definitive', 'copie', 'copy', 'maj', 'nouveau', 'nouvelle'])

/**
 * Clé d'un nom de fichier pour reconnaître une nouvelle version : minuscules, sans accents ni extension,
 * séparateurs réduits, marques de version retirées (v2, V3, version 4, rev2, (1), final, copie…).
 * « Devis Ibé v2.pdf » et « devis-ibe-v3.pdf » donnent « devis ibe ». Les autres nombres sont gardés
 * (« Facture 2026-012 » ≠ « Facture 2026-013 »).
 */
export function versionKey(name: string): string {
  const words = baseName(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (/^(v|rev|r)\d+$/.test(word)) continue
    if (VERSION_WORDS.has(word)) {
      // « version 4 », « v 2 » : le nombre qui suit fait partie de la marque.
      if (/^\d+$/.test(words[i + 1] ?? '') && ['v', 'version', 'rev', 'revision'].includes(word)) i++
      continue
    }
    kept.push(word)
  }
  return kept.join(' ')
}

/** Vrai si les deux noms désignent sans doute le même document (clé de version identique et non vide). */
export function sameDocumentName(a: string, b: string): boolean {
  const key = versionKey(a)
  return key !== '' && key === versionKey(b)
}

/* ---------- Confiance et vérification ---------- */

/** Arrondi à 2 décimales dans [0, 1] (colonne numeric(3, 2)). */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

/**
 * Confiance finale : celle de l'IA, plafonnée à 0,6 si le projet est ambigu et à 0,5 sans projet.
 */
export function finalConfidence(input: { aiConfidence: number; hasProject: boolean; projectAmbiguous: boolean }): number {
  let value = clampConfidence(input.aiConfidence)
  if (input.projectAmbiguous) value = Math.min(value, AMBIGUOUS_PROJECT_CONFIDENCE_CAP)
  if (!input.hasProject) value = Math.min(value, NO_PROJECT_CONFIDENCE_CAP)
  return value
}

export const REVIEW_REASONS = ['not_ready', 'no_proposal', 'no_project', 'low_confidence', 'duplicate', 'import_suggested'] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const REVIEW_REASON_LABELS = {
  not_ready: 'Analyse pas terminée',
  no_proposal: 'Aucune proposition',
  no_project: 'Projet à choisir',
  low_confidence: 'Confiance trop faible',
  duplicate: 'Déjà rangé (doublon)',
  import_suggested: 'Import du document à décider',
} as const satisfies Record<ReviewReason, string>

type ReviewableIntake = Pick<FileIntake, 'status' | 'proposal' | 'confidence'>

/** Confiance d'un dépôt : la colonne (finale), sinon celle de la proposition. */
export function intakeConfidence(intake: Pick<FileIntake, 'proposal' | 'confidence'>): number | null {
  return intake.confidence ?? intake.proposal?.confidence ?? null
}

/** Pourquoi ce dépôt doit être vérifié dans l'app (liste vide = validable dans l'île). */
export function reviewReasons(intake: ReviewableIntake): ReviewReason[] {
  if (intake.status !== 'ready') return ['not_ready']
  const proposal = intake.proposal
  if (!proposal) return ['no_proposal']
  const reasons: ReviewReason[] = []
  if (!proposal.project_id) reasons.push('no_project')
  const confidence = intakeConfidence(intake)
  if (confidence === null || confidence < FILING_CONFIDENCE_THRESHOLD) reasons.push('low_confidence')
  if (proposal.duplicate_of_file_id) reasons.push('duplicate')
  if (proposal.suggest_import) reasons.push('import_suggested')
  return reasons
}

/**
 * Vrai si le dépôt doit être vérifié sur l'écran de rangement (/files/intake/:intakeId) :
 * pas encore prêt, pas de projet, confiance sous le seuil (projet ambigu compris), doublon, import proposé.
 * Faux = l'île peut proposer « Ranger » directement.
 */
export function needsReview(intake: ReviewableIntake): boolean {
  return reviewReasons(intake).length > 0
}

/* ---------- Libellés ---------- */

export interface ProposalNames {
  clientName?: string | null
  projectName?: string | null
}

/**
 * Libellé court d'une proposition pour l'île : « Devis D-2026-012 · Ibé › App Ibé ».
 * Sans numéro : « Maquette · Ibé › App Ibé » ; sans projet : « Facture F-12 · Ibé › projet à choisir ».
 */
export function proposalLabel(
  proposal: Pick<FileIntakeProposal, 'kind' | 'document_number' | 'project_id' | 'client_id'>,
  names: ProposalNames = {},
): string {
  const kind = LABELS.fileKind[proposal.kind]
  const what = proposal.document_number ? `${kind} ${proposal.document_number}` : kind
  const client = names.clientName?.trim() || null
  const project = proposal.project_id ? names.projectName?.trim() || null : null
  if (!client && !project) return proposal.project_id ? what : `${what} · projet à choisir`
  if (!project) return `${what} · ${client} › projet à choisir`
  return client ? `${what} · ${client} › ${project}` : `${what} · ${project}`
}

/** Confiance en pourcentage entier (« 82 % »). */
export function formatConfidence(confidence: number | null): string {
  return confidence === null ? 'non évaluée' : `${Math.round(clampConfidence(confidence) * 100)} %`
}
