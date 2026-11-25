import type { MemberRole, Note, NoteVisibility } from '../../shared/types'
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from '../../shared/types'
import { normalizeName } from '../clients/clientUtils'

/** Note telle que lue par la liste : auteur, projet et client joints (null si la RLS les cache). */
export type NoteWithLinks = Note & {
  author: { id: string; name: string } | null
  project: { id: string; name: string } | null
  client: { id: string; name: string } | null
}

/* ---------- Titre et extrait ---------- */

/** Retire les marques du Markdown léger (titres, puces, gras, italique). */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*#{1,3}\s+/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/_(.+?)_/g, '$1')
    .trim()
}

/** Titre affiché : le titre, sinon la première ligne du contenu, sinon « Sans titre ». */
export function noteTitle(note: Pick<Note, 'title' | 'body'>): string {
  const title = note.title.trim()
  if (title) return title
  const first = note.body
    .split('\n')
    .map(stripMarkdown)
    .find((line) => line !== '')
  if (!first) return 'Sans titre'
  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first
}

/** Extrait d'une ligne, sans Markdown ; sans la ligne déjà reprise comme titre. */
export function noteExcerpt(note: Pick<Note, 'title' | 'body'>, max = 120): string {
  const lines = note.body
    .split('\n')
    .map(stripMarkdown)
    .filter((line) => line !== '')
  const rest = note.title.trim() ? lines : lines.slice(1)
  const text = rest.join(' ').replace(/\s+/g, ' ')
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/* ---------- Tri, filtres ---------- */

/** Épinglées en tête, puis de la plus récemment modifiée à la plus ancienne. */
export function sortNotes<T extends Pick<Note, 'pinned' | 'updated_at' | 'id'>>(notes: readonly T[]): T[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  )
}

export type NoteVisibilityFilter = 'all' | NoteVisibility

export interface NoteFilters {
  query: string
  projectId: string
  clientId: string
  visibility: NoteVisibilityFilter
}

export const EMPTY_NOTE_FILTERS: NoteFilters = { query: '', projectId: '', clientId: '', visibility: 'all' }

export const VISIBILITY_FILTER_LABELS: Record<NoteVisibilityFilter, string> = {
  all: 'Toutes',
  personal: 'Perso',
  team: 'Équipe',
}

export function activeNoteFilterCount(filters: NoteFilters): number {
  return (filters.projectId ? 1 : 0) + (filters.clientId ? 1 : 0) + (filters.visibility !== 'all' ? 1 : 0)
}

/** Recherche (titre, contenu, projet, client) et filtres, puis tri (épinglées en tête). */
export function filterNotes<T extends NoteWithLinks>(notes: readonly T[], filters: NoteFilters): T[] {
  const needle = normalizeName(filters.query)
  return sortNotes(
    notes.filter((note) => {
      if (filters.projectId && note.project_id !== filters.projectId) return false
      if (filters.clientId && note.client_id !== filters.clientId) return false
      if (filters.visibility !== 'all' && note.visibility !== filters.visibility) return false
      if (needle === '') return true
      return normalizeName([note.title, note.body, note.project?.name, note.client?.name].filter(Boolean).join(' ')).includes(needle)
    }),
  )
}

/* ---------- Droits (miroir de la RLS de 0020, pour l'interface) ---------- */

export interface NoteViewer {
  memberId: string
  role: MemberRole
}

/** Rôles qui lisent les notes d'équipe, projets et clients. */
const TEAM_ROLES: readonly MemberRole[] = ['admin', 'membre', 'finance']

/** Peut écrire des notes d'équipe et rattacher une note à un projet ou un client. */
export function canUseTeamNotes(role: MemberRole): boolean {
  return TEAM_ROLES.includes(role)
}

/** Modifier ou supprimer : l'auteur ; pour une note d'équipe, aussi un admin. */
export function canEditNote(note: Pick<Note, 'author_id' | 'visibility'>, viewer: NoteViewer): boolean {
  if (note.visibility === 'personal') return note.author_id === viewer.memberId
  if (!canUseTeamNotes(viewer.role)) return false
  return note.author_id === viewer.memberId || viewer.role === 'admin'
}

/** Seul l'auteur peut rendre une note perso (sinon elle disparaîtrait pour lui comme pour l'équipe). */
export function canChangeVisibility(note: Pick<Note, 'author_id'>, viewer: NoteViewer): boolean {
  return note.author_id === viewer.memberId && canUseTeamNotes(viewer.role)
}

/* ---------- Brouillon et enregistrement ---------- */

export interface NoteDraft {
  title: string
  body: string
  visibility: NoteVisibility
  projectId: string
  clientId: string
}

export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'visibility' | 'project_id' | 'client_id'>>

export function draftFromNote(note: Pick<Note, 'title' | 'body' | 'visibility' | 'project_id' | 'client_id'>): NoteDraft {
  return { title: note.title, body: note.body, visibility: note.visibility, projectId: note.project_id ?? '', clientId: note.client_id ?? '' }
}

/** Colonnes qui ont changé entre le brouillon et la dernière version enregistrée (vide = rien à faire). */
export function notePatch(draft: NoteDraft, saved: NoteDraft): NotePatch {
  const patch: NotePatch = {}
  if (draft.title !== saved.title) patch.title = draft.title
  if (draft.body !== saved.body) patch.body = draft.body
  if (draft.visibility !== saved.visibility) patch.visibility = draft.visibility
  if (draft.projectId !== saved.projectId) patch.project_id = draft.projectId || null
  if (draft.clientId !== saved.clientId) patch.client_id = draft.clientId || null
  return patch
}

export function isEmptyPatch(patch: NotePatch): boolean {
  return Object.keys(patch).length === 0
}

/** Erreur bloquante du brouillon (longueurs de la base), ou null. */
export function noteDraftError(draft: NoteDraft): string | null {
  if (draft.title.length > NOTE_TITLE_MAX_LENGTH) return `Le titre fait ${NOTE_TITLE_MAX_LENGTH} caractères au plus.`
  if (draft.body.length > NOTE_BODY_MAX_LENGTH) return 'La note est trop longue.'
  return null
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function saveStateLabel(state: SaveState): string {
  switch (state) {
    case 'dirty':
      return 'Modifications non enregistrées'
    case 'saving':
      return 'Enregistrement…'
    case 'saved':
      return 'Enregistré'
    case 'error':
      return 'Échec de l’enregistrement'
    default:
      return ''
  }
}

/* ---------- Dates ---------- */

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const yearFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** « 14:05 » aujourd'hui, « 3 nov. » cette année, « 3 nov. 2025 » sinon. */
export function formatNoteDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date)
  return date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : yearFormat.format(date)
}

/** « modifiée à 14:05 » aujourd'hui, « modifiée le 3 nov. » sinon. */
export function formatModified(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === now.toDateString()
  return `modifiée ${sameDay ? 'à' : 'le'} ${formatNoteDate(iso, now)}`
}
