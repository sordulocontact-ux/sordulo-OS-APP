/**
 * Logique pure de l'espace Fichiers : dossiers, regroupement des versions, tri, libellés,
 * détection de doublon et de version à l'envoi direct, état d'un dépôt. Sans React ni Supabase.
 */
import { sameDocumentName, needsReview } from '../../shared/filing'
import {
  DEFAULT_FOLDERS,
  FILE_FOLDER_MAX_LENGTH,
  FOLDER_BY_KIND,
  LABELS,
  type FileIntake,
  type FileKind,
  type ProjectFile,
} from '../../shared/types'

/* ---------- Dossiers, versions, tri ---------- */

export function activeFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return files.filter((file) => file.deleted_at === null)
}

export function trashedFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return files.filter((file) => file.deleted_at !== null).sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''))
}

/** Dernière version vivante de chaque fichier (une ligne par version_group_id). */
export function latestVersions(files: readonly ProjectFile[]): ProjectFile[] {
  const latest = new Map<string, ProjectFile>()
  for (const file of activeFiles(files)) {
    const current = latest.get(file.version_group_id)
    if (!current || file.version > current.version) latest.set(file.version_group_id, file)
  }
  return Array.from(latest.values())
}

/** Dossiers types, puis les dossiers libres présents (ordre alphabétique). */
export function folderList(files: readonly ProjectFile[]): string[] {
  const defaults = new Set<string>(DEFAULT_FOLDERS)
  const custom = new Set<string>()
  for (const file of latestVersions(files)) if (!defaults.has(file.folder)) custom.add(file.folder)
  return [...DEFAULT_FOLDERS, ...Array.from(custom).sort((a, b) => a.localeCompare(b, 'fr'))]
}

/** Nombre de fichiers (versions regroupées) par dossier. */
export function folderCounts(files: readonly ProjectFile[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of latestVersions(files)) counts.set(file.folder, (counts.get(file.folder) ?? 0) + 1)
  return counts
}

export type FileSort = 'recent' | 'name'

export const FILE_SORT_LABELS: Record<FileSort, string> = { recent: 'Plus récents', name: 'Nom' }

export function sortFiles(files: readonly ProjectFile[], sort: FileSort): ProjectFile[] {
  const copy = [...files]
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }))
  return copy.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Fichiers d'un dossier, une ligne par fichier (dernière version), triés. */
export function filesInFolder(files: readonly ProjectFile[], folder: string, sort: FileSort = 'recent'): ProjectFile[] {
  return sortFiles(
    latestVersions(files).filter((file) => file.folder === folder),
    sort,
  )
}

/** Toutes les versions d'un fichier, la plus récente d'abord (corbeille comprise). */
export function versionHistory(files: readonly ProjectFile[], versionGroupId: string): ProjectFile[] {
  return files.filter((file) => file.version_group_id === versionGroupId).sort((a, b) => b.version - a.version)
}

/** « V3 » à partir de la 2e version, chaîne vide pour la première. */
export function versionLabel(version: number): string {
  return version > 1 ? `V${version}` : ''
}

/** Dossier proposé à l'envoi : celui qu'on regarde, sinon Divers. */
export function kindForFolder(folder: string): FileKind {
  const found = (Object.entries(FOLDER_BY_KIND) as [FileKind, string][]).find(([kind, name]) => name === folder && kind !== 'asset')
  return found ? found[0] : 'other'
}

/** Dossier libre valide : espaces réduits, 80 caractères au plus, non vide. */
export function cleanFolderName(folder: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = folder.replace(/\s+/g, ' ').trim()
  if (value === '') return { ok: false, error: 'Le nom du dossier est vide.' }
  if (value.length > FILE_FOLDER_MAX_LENGTH) return { ok: false, error: `Le nom du dossier dépasse ${FILE_FOLDER_MAX_LENGTH} caractères.` }
  return { ok: true, value }
}

export function cleanFileName(name: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = name.replace(/\s+/g, ' ').trim()
  if (value === '') return { ok: false, error: 'Le nom du fichier est vide.' }
  if (value.length > 255) return { ok: false, error: 'Le nom du fichier dépasse 255 caractères.' }
  return { ok: true, value }
}

/* ---------- Envoi direct : doublon et version ---------- */

export type UploadPlan =
  | { type: 'new' }
  /** Même empreinte qu'un fichier vivant du projet. */
  | { type: 'duplicate'; file: ProjectFile }
  /** Nom identique ou proche (versionKey) : proposé comme nouvelle version de ce fichier (sa dernière version). */
  | { type: 'version'; file: ProjectFile }

/** Décide de ce qu'il faut signaler avant d'envoyer un fichier. Le doublon passe avant la version. */
export function planUpload(existing: readonly ProjectFile[], candidate: { name: string; sha256: string }): UploadPlan {
  const live = latestVersions(existing)
  const sameBytes = activeFiles(existing).find((file) => file.sha256 !== null && file.sha256 === candidate.sha256)
  if (sameBytes) return { type: 'duplicate', file: sameBytes }
  const similar = live.filter((file) => sameDocumentName(file.name, candidate.name)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return similar ? { type: 'version', file: similar } : { type: 'new' }
}

/** Nouvelle version demandée explicitement pour `target` : seul le doublon exact est signalé. */
export function planUploadAsVersion(existing: readonly ProjectFile[], target: ProjectFile, sha256: string): UploadPlan {
  const sameBytes = activeFiles(existing).find((file) => file.sha256 !== null && file.sha256 === sha256)
  if (sameBytes) return { type: 'duplicate', file: sameBytes }
  const latest = latestVersions(existing).find((file) => file.version_group_id === target.version_group_id) ?? target
  return { type: 'version', file: latest }
}

/** Groupe de version du fichier choisi, seulement s'il est dans le projet visé (null = nouveau fichier). */
export function resolveVersionGroup(files: readonly ProjectFile[], versionFileId: string, projectId: string): string | null {
  if (versionFileId === '') return null
  const file = files.find((candidate) => candidate.id === versionFileId)
  return file && file.project_id === projectId && file.deleted_at === null ? file.version_group_id : null
}

/* ---------- Libellés ---------- */

/** 1,2 Mo, 340 Ko, 12 o (espace insécable). */
export function formatSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return ''
  const nbsp = ' '
  if (bytes < 1000) return `${bytes}${nbsp}o`
  const units = ['Ko', 'Mo', 'Go']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const text = value >= 100 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1).replace('.', ',')
  return `${text}${nbsp}${units[unit]}`
}

export type PreviewKind = 'image' | 'pdf' | 'none'

/** Aperçu possible dans le navigateur : image ou PDF. */
export function previewKind(name: string, mimeType: string | null): PreviewKind {
  const lower = name.toLowerCase()
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if ((mimeType ?? '').startsWith('image/') && mimeType !== 'image/svg+xml') return 'image'
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(lower)) return 'image'
  return 'none'
}

const KIND_PLURALS: Record<FileKind, string> = {
  quote: 'devis',
  invoice: 'factures',
  contract: 'contrats',
  brief: 'briefs',
  mockup: 'maquettes',
  feedback: 'retours',
  deliverable: 'livrables',
  asset: 'ressources',
  other: 'autres documents',
}

/** « Toujours ranger les devis de Ibé ainsi ». */
export function alwaysLabel(kind: FileKind, clientName: string | null): string {
  return `Toujours ranger les ${KIND_PLURALS[kind]}${clientName ? ` de ${clientName}` : ' de ce client'} ainsi`
}

/** « Rangé dans App Ibé › Devis ». */
export function filedPlaceLabel(projectName: string | null, folder: string): string {
  return `Rangé dans ${projectName ?? 'le projet'} › ${folder}`
}

/** Message affichable pour une erreur Supabase ou autre, en français. */
export function fileErrorText(error: unknown, fallback = 'Une erreur est survenue. Réessaie.'): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : ''
  if (code === '23503') return 'Ce fichier est utilisé par un livrable : il ne peut pas être supprimé définitivement.'
  if (code === '42501') return 'Tu n’as pas le droit de faire cette action.'
  if (code === '23505') return 'Un fichier existe déjà à cet emplacement.'
  return message || fallback
}

/* ---------- Dépôts ---------- */

export type IntakeState = 'pending' | 'error' | 'sure' | 'check' | 'auto' | 'filed' | 'cancelled'

/** État d'un dépôt pour l'interface : Sûr (validable en un clic), À vérifier, rangé seul, erreur… */
export function intakeState(intake: Pick<FileIntake, 'status' | 'proposal' | 'confidence' | 'auto_filed'>): IntakeState {
  switch (intake.status) {
    case 'error':
      return 'error'
    case 'uploaded':
    case 'classifying':
      return 'pending'
    case 'filed':
      return intake.auto_filed ? 'auto' : 'filed'
    case 'cancelled':
      return 'cancelled'
    case 'ready':
      return needsReview(intake) ? 'check' : 'sure'
  }
}

export const INTAKE_STATE_LABELS: Record<IntakeState, string> = {
  pending: 'Analyse…',
  error: 'Erreur',
  sure: 'Sûr',
  check: 'À vérifier',
  auto: 'Rangé automatiquement',
  filed: 'Rangé',
  cancelled: 'Annulé',
}

/** Les dépôts à ranger d'un clic (état Sûr). */
export function sureIntakes(intakes: readonly FileIntake[]): FileIntake[] {
  return intakes.filter((intake) => intakeState(intake) === 'sure')
}

/** Vrai tant que le serveur travaille : l'écran relit toutes les 2 s. */
export function isIntakeBusy(intake: Pick<FileIntake, 'status'>): boolean {
  return intake.status === 'uploaded' || intake.status === 'classifying'
}

/** Confiance en mots : Sûr ou À vérifier. */
export function confidenceWord(intake: Pick<FileIntake, 'status' | 'proposal' | 'confidence'>): 'Sûr' | 'À vérifier' {
  return intake.status === 'ready' && !needsReview(intake) ? 'Sûr' : 'À vérifier'
}

/* ---------- Écran de rangement : brouillon ---------- */

export interface IntakeDraft {
  clientId: string
  projectId: string
  kind: FileKind
  folder: string
  name: string
  quoteId: string
  invoiceId: string
  /** Fichier dont ce dépôt est la nouvelle version ('' = nouveau fichier). */
  versionFileId: string
}

export interface DirectoryProject {
  id: string
  name: string
  client_id: string | null
}

/** Brouillon de départ : la proposition de l'IA, corrigeable. */
export function initialDraft(intake: FileIntake, projects: readonly DirectoryProject[]): IntakeDraft {
  const proposal = intake.proposal
  const kind = proposal?.kind ?? 'other'
  const projectId = proposal?.project_id ?? ''
  const project = projects.find((candidate) => candidate.id === projectId)
  return {
    clientId: proposal?.client_id ?? project?.client_id ?? '',
    projectId,
    kind,
    folder: proposal?.folder?.trim() || FOLDER_BY_KIND[kind],
    name: intake.name,
    quoteId: proposal?.linked_quote_id ?? '',
    invoiceId: proposal?.linked_invoice_id ?? '',
    versionFileId: proposal?.previous_version_file_id ?? '',
  }
}

export function projectsOfClient<T extends DirectoryProject>(projects: readonly T[], clientId: string): T[] {
  return clientId === '' ? [...projects] : projects.filter((project) => project.client_id === clientId)
}

export function kindLabel(kind: FileKind): string {
  return LABELS.fileKind[kind]
}
