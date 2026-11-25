/**
 * Présélection du projet d'un appel d'après l'agenda (Google Agenda) : logique pure, testée dans
 * calendarMatch.test.ts. Ni React ni Tauri.
 *
 * Événement « en cours » : de 5 min avant le début jusqu'à la fin, pas refusé, pas sur la journée entière.
 * Projet : 1) participants (hors moi) ↔ emails des contacts clients → projet en cours le plus récent ;
 * 2) sinon titre de l'événement ↔ noms des clients (leur projet en cours), puis noms des projets (mot entier,
 * sans accents ni casse) ; 3) sinon le dernier projet utilisé (pickDefaultProject).
 */
import { activeProjectOf, clientByEmail, type ClientDirectoryEntry, type DirectoryProject } from '../../../lib/clientDirectory'
import { UNTITLED_EVENT, type CalendarEvent } from '../../../lib/googleCalendar'
import type { IslandProjectOption } from '../view/types'
import { pickDefaultProject } from './callFlow'

/** Un événement compte comme « en cours » dès 5 min avant son début (et le rappel part à ce moment). */
export const ONGOING_LEAD_MS = 5 * 60 * 1000

/** L'événement peut être l'appel en cours : de 5 min avant le début à la fin, non refusé, pas sur la journée. */
export function isEventOngoing(event: CalendarEvent, now: number): boolean {
  if (event.allDay || event.myResponse === 'declined') return false
  return now >= event.start - ONGOING_LEAD_MS && now < event.end
}

/**
 * Événement de l'appel parmi ceux de l'agenda : en cours, avec visio ou participants de préférence, puis le
 * plus proche de maintenant par son début (un appel qui commence l'emporte sur un atelier commencé tôt).
 */
export function ongoingEvent(events: readonly CalendarEvent[], now: number): CalendarEvent | null {
  const ongoing = events.filter((e) => isEventOngoing(e, now))
  const isCall = (e: CalendarEvent) => (e.meetingUrl !== null || e.attendees.length > 0 ? 0 : 1)
  ongoing.sort((a, b) => isCall(a) - isCall(b) || Math.abs(a.start - now) - Math.abs(b.start - now))
  return ongoing[0] ?? null
}

/** Texte comparable : sans accents, minuscules, mots séparés par une espace, entouré d'espaces. */
export function matchKey(value: string): string {
  const words = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  return words.length > 0 ? ` ${words.join(' ')} ` : ''
}

/** `name` apparaît dans `title` en mots entiers (« Ibé » dans « Point Ibé / Sordulo », pas dans « Ibérique »). */
export function titleMentions(title: string, name: string): boolean {
  const key = matchKey(name)
  return key !== '' && matchKey(title).includes(key)
}

export interface CalendarProjectPick {
  /** Projet présélectionné ; null : aucun projet proposé. */
  projectId: string | null
  /** « D'après l'agenda : <titre> » quand l'agenda a désigné le projet ; null : dernier projet utilisé. */
  reason: string | null
  /** Titre de l'événement en cours (titre de l'entrée) ; null : aucun événement en cours. */
  title: string | null
}

function newest(projects: readonly DirectoryProject[]): DirectoryProject | null {
  return [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

/** Nom le plus long d'abord : « App Ibé » l'emporte sur « Ibé » quand les deux sont dans le titre. */
function byLongestName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => matchKey(nameOf(b)).length - matchKey(nameOf(a)).length)
}

export function agendaReason(title: string): string {
  return `D'après l'agenda : ${title}`
}

export function pickCalendarProject(params: {
  event: CalendarEvent | null
  directory: readonly ClientDirectoryEntry[]
  projects: readonly IslandProjectOption[]
  lastProjectId: string | null
  now: number
}): CalendarProjectPick {
  const { event, directory, projects, lastProjectId, now } = params
  const fallback = pickDefaultProject(projects, lastProjectId)
  if (!event || !isEventOngoing(event, now)) return { projectId: fallback, reason: null, title: null }

  // Un événement sans titre ne donne pas de titre à l'entrée (le serveur en met un par défaut).
  const title = event.title === UNTITLED_EVENT ? null : event.title
  const offered = new Set(projects.map((p) => p.id))
  const activeOffered = (client: ClientDirectoryEntry): DirectoryProject | null => {
    const active = activeProjectOf(client)
    return active && offered.has(active.id) ? active : null
  }
  const found = (projectId: string): CalendarProjectPick => ({
    projectId,
    reason: agendaReason(event.title),
    title,
  })

  // 1) Participants ↔ contacts clients : projet en cours le plus récent parmi les clients reconnus.
  const fromAttendees = event.attendees.flatMap((email) => {
    const client = clientByEmail(directory, email)
    const active = client ? activeOffered(client) : null
    return active ? [active] : []
  })
  const byAttendee = newest(fromAttendees)
  if (byAttendee) return found(byAttendee.id)

  // 2) Titre ↔ noms des clients (leur projet en cours), puis noms des projets proposés.
  for (const client of byLongestName(directory, (c) => c.clientName)) {
    if (!titleMentions(event.title, client.clientName)) continue
    const active = activeOffered(client)
    if (active) return found(active.id)
  }
  for (const project of byLongestName(projects, (p) => p.name)) {
    if (titleMentions(event.title, project.name)) return found(project.id)
  }

  // 3) Dernier projet utilisé ; le titre de l'événement reste celui de l'entrée.
  return { projectId: fallback, reason: null, title }
}
