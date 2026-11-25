/**
 * Logique pure des livrables : épingles (positions en fractions 0..1), numérotation, aperçu selon
 * le type de fichier, statuts affichés, chemin dans le bucket « files ». Partagée avec le portail.
 */
import type { BadgeTone } from '../../components/ui'
import type { DeliverableStatus, DeliverableVersionStatus } from '../../shared/types'

/** Commentaire tel que l'affiche la visionneuse (équipe ou portail). */
export interface ViewerComment {
  id: string
  x: number | null
  y: number | null
  body: string
  authorName: string
  fromClient: boolean
  resolved: boolean
  createdAt: string
}

export interface PinPoint {
  x: number
  y: number
}

/** Taille maximale d'un fichier du bucket « files » (migration 0010). */
export const DELIVERABLE_MAX_BYTES = 100 * 1024 * 1024

export const DELIVERABLE_ACCEPT = 'image/*,application/pdf'

/** Dossier et type des fichiers de livrables dans les fichiers du projet. */
export const DELIVERABLE_FOLDER = 'Livrables'
export const DELIVERABLE_FILE_KIND = 'deliverable'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Arrondi à 4 décimales (un dixième de pixel sur une image de 1000 px suffit). */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** Position d'un clic dans le rectangle affiché de l'image, en fractions 0..1. Null si le rectangle est vide. */
export function pointFromClick(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): PinPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: round4(clamp01((clientX - rect.left) / rect.width)),
    y: round4(clamp01((clientY - rect.top) / rect.height)),
  }
}

export function isPinned(comment: Pick<ViewerComment, 'x' | 'y'>): comment is { x: number; y: number } {
  return comment.x !== null && comment.y !== null
}

/** Numéro de chaque épingle (ordre de création), par id de commentaire. Les commentaires généraux n'en ont pas. */
export function pinNumbers(comments: readonly ViewerComment[]): Map<string, number> {
  const numbers = new Map<string, number>()
  const pinned = comments.filter(isPinned).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  pinned.forEach((comment, index) => numbers.set(comment.id, index + 1))
  return numbers
}

/** Ordre de la liste : non résolus d'abord, puis par date. */
export function sortComments<T extends Pick<ViewerComment, 'resolved' | 'createdAt'>>(comments: readonly T[]): T[] {
  return [...comments].sort((a, b) =>
    a.resolved === b.resolved ? a.createdAt.localeCompare(b.createdAt) : a.resolved ? 1 : -1,
  )
}

export type PreviewKind = 'image' | 'pdf' | 'other'

export function previewKind(mimeType: string | null, name = ''): PreviewKind {
  const mime = (mimeType ?? '').toLowerCase()
  const lower = name.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(lower)) return 'image'
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  return 'other'
}

/** Erreur à afficher pour un fichier refusé, ou null s'il convient. */
export function validateDeliverableFile(file: { name: string; type: string; size: number }): string | null {
  if (previewKind(file.type, file.name) === 'other') return 'Choisis une image (PNG, JPG, WebP…) ou un PDF.'
  if (file.size <= 0) return 'Ce fichier est vide.'
  if (file.size > DELIVERABLE_MAX_BYTES) return 'Ce fichier dépasse 100 Mo.'
  return null
}

const MAX_NAME_LENGTH = 100

/** Nom sûr pour un chemin de Storage : [A-Za-z0-9._-], sans accents, jamais vide. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  let clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (clean.length > MAX_NAME_LENGTH) {
    const dot = clean.lastIndexOf('.')
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ''
    clean = clean.slice(0, MAX_NAME_LENGTH - ext.length).replace(/[-.]+$/, '') + ext
  }
  return clean || 'fichier'
}

/** `<org>/<project_id>/<uuid>-<nom>` (politiques du bucket « files » : 1er segment = organisation). */
export function deliverableStoragePath(organizationId: string, projectId: string, uuid: string, name: string): string {
  return `${organizationId}/${projectId}/${uuid}-${safeFileName(name)}`
}

export const DELIVERABLE_STATUS_TONE: Record<DeliverableStatus, BadgeTone> = {
  in_progress: 'neutral',
  in_review: 'info',
  approved: 'success',
  changes_requested: 'warning',
}

export const VERSION_STATUS_TONE: Record<DeliverableVersionStatus, BadgeTone> = {
  pending: 'info',
  approved: 'success',
  changes_requested: 'warning',
}

/** Libellés vus par le client (portail) : formulés de son point de vue. */
export const CLIENT_DELIVERABLE_LABEL: Record<DeliverableStatus, string> = {
  in_progress: 'En préparation',
  in_review: 'À valider',
  approved: 'Validé',
  changes_requested: 'Modifications demandées',
}

export function latestVersion<T extends { version: number }>(versions: readonly T[]): T | null {
  return versions.reduce<T | null>((best, v) => (best === null || v.version > best.version ? v : best), null)
}

/** Le client peut répondre (valider / demander des modifications) : dernière version, encore en attente. */
export function canDecide(version: { version: number; status: DeliverableVersionStatus }, versions: readonly { version: number }[]): boolean {
  const latest = latestVersion(versions)
  return version.status === 'pending' && latest !== null && latest.version === version.version
}

/** Compte des commentaires non résolus. */
export function openCount(comments: readonly Pick<ViewerComment, 'resolved'>[]): number {
  return comments.filter((c) => !c.resolved).length
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' })
}
