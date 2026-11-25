/**
 * Google Agenda : lecture des événements de l'agenda principal du compte Google (API REST Calendar v3,
 * CORS ouvert : appelée directement depuis la fenêtre de l'île avec le jeton d'accès donné par Rust).
 *
 * Utilisé par la source « agenda » de l'île (rappel avant une visio, présélection du projet d'un appel).
 * Les réponses de Google sont normalisées ici, par des fonctions pures testées : le reste du code ne voit
 * jamais le JSON brut.
 *
 * Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur, et ne passe jamais dans une URL.
 */
import { normalizeEmail } from './clientDirectory'

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** Fenêtre lue autour de maintenant : les réunions en cours (longues comprises) et celles des 24 h à venir. */
export const CALENDAR_LOOKBEHIND_MS = 12 * 60 * 60 * 1000
export const CALENDAR_LOOKAHEAD_MS = 24 * 60 * 60 * 1000
/** Plafond d'événements lus (une seule page : 36 h d'agenda). */
const MAX_RESULTS = 100

/** Champs demandés à Google (réponse plus légère). */
export const CALENDAR_FIELDS =
  'items(id,status,summary,location,description,hangoutLink,start,end,' +
  'attendees(email,self,responseStatus,resource),conferenceData(entryPoints(entryPointType,uri)))'

/** Titre d'un événement sans titre. */
export const UNTITLED_EVENT = '(Sans titre)'

/** Ma réponse à l'invitation ; null : pas d'invités (événement à moi seul) ou réponse inconnue. */
export type CalendarResponse = 'accepted' | 'declined' | 'tentative' | 'needsAction'

/** Événement de l'agenda, normalisé. Dates en epoch ms. */
export interface CalendarEvent {
  id: string
  title: string
  start: number
  /** Fin (exclue pour une journée entière : minuit du lendemain). */
  end: number
  /** Événement sur la journée entière (pas d'heure). */
  allDay: boolean
  status: 'confirmed' | 'tentative'
  myResponse: CalendarResponse | null
  /** Emails des participants, hors moi et hors salles, en minuscules, sans doublon. */
  attendees: string[]
  /** Lien de la visio (Meet, Zoom, Teams, Webex…) ; null : pas de visio. */
  meetingUrl: string | null
  /** App de la visio d'après le lien (« Google Meet », « Zoom »…) ; null sans lien. */
  appName: string | null
}

/** Erreur de l'API Google Agenda. `unauthorized` (401) : jeton d'accès à rafraîchir. */
export class GoogleCalendarError extends Error {
  readonly status: number
  readonly unauthorized: boolean
  constructor(status: number, message: string, unauthorized: boolean) {
    super(message)
    this.name = 'GoogleCalendarError'
    this.status = status
    this.unauthorized = unauthorized
  }
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Liens de visio
// ---------------------------------------------------------------------------

type MeetingApp = 'Google Meet' | 'Zoom' | 'Teams' | 'Webex'

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function knownApp(url: string): MeetingApp | null {
  const host = hostOf(url)
  if (!host) return null
  if (host === 'meet.google.com') return 'Google Meet'
  if (hostIs(host, 'zoom.us') || hostIs(host, 'zoom.com')) return 'Zoom'
  if (hostIs(host, 'teams.microsoft.com') || hostIs(host, 'teams.live.com')) return 'Teams'
  if (hostIs(host, 'webex.com')) return 'Webex'
  return null
}

/** Nom de l'app d'après le lien de la visio ; « Visio » pour un lien inconnu. */
export function meetingAppName(url: string): string {
  return knownApp(url) ?? 'Visio'
}

/** Premier lien Meet, Zoom, Teams ou Webex trouvé dans un texte (lieu, description, HTML compris). */
export function findMeetingUrl(raw: string | null): string | null {
  if (!raw) return null
  const candidates = raw.match(/https?:\/\/[^\s"'<>()[\]{}]+/gi) ?? []
  for (const candidate of candidates) {
    // Ponctuation de fin de phrase et entités HTML collées au lien.
    const url = candidate.replace(/&amp;/g, '&').replace(/[.,;:!?]+$/, '')
    if (knownApp(url)) return url
  }
  return null
}

/** Lien de la visio : Google Meet (hangoutLink), point d'entrée vidéo, sinon un lien du lieu ou de la description. */
export function meetingUrlOf(raw: Json): string | null {
  const hangout = text(raw.hangoutLink)
  if (hangout && hostOf(hangout)) return hangout
  const conference = isObject(raw.conferenceData) ? raw.conferenceData : null
  const entryPoints = conference && Array.isArray(conference.entryPoints) ? conference.entryPoints : []
  for (const entry of entryPoints) {
    if (!isObject(entry) || entry.entryPointType !== 'video') continue
    const uri = text(entry.uri)
    if (uri && hostOf(uri)) return uri
  }
  return findMeetingUrl(text(raw.location)) ?? findMeetingUrl(text(raw.description))
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** « 2026-11-25 » → minuit local de ce jour (epoch ms) ; null si la date est illisible. */
function localDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  return Number.isFinite(time) ? time : null
}

function instant(raw: unknown): { time: number; allDay: boolean } | null {
  if (!isObject(raw)) return null
  const dateTime = text(raw.dateTime)
  if (dateTime) {
    const time = Date.parse(dateTime)
    return Number.isFinite(time) ? { time, allDay: false } : null
  }
  const date = text(raw.date)
  if (date) {
    const time = localDay(date)
    return time === null ? null : { time, allDay: true }
  }
  return null
}

function responseOf(value: unknown): CalendarResponse | null {
  return value === 'accepted' || value === 'declined' || value === 'tentative' || value === 'needsAction' ? value : null
}

/** Événement brut de Google → événement, ou null (annulé, sans date, inutilisable). */
export function normalizeCalendarEvent(raw: unknown): CalendarEvent | null {
  if (!isObject(raw)) return null
  const id = text(raw.id)
  if (!id || raw.status === 'cancelled') return null
  const start = instant(raw.start)
  const end = instant(raw.end)
  if (!start || !end) return null
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.filter(isObject) : []
  const self = attendees.find((a) => a.self === true)
  const emails = attendees
    .filter((a) => a.self !== true && a.resource !== true)
    .map((a) => normalizeEmail(a.email))
    .filter((e): e is string => e !== null)
  const meetingUrl = meetingUrlOf(raw)
  return {
    id,
    title: text(raw.summary) ?? UNTITLED_EVENT,
    start: start.time,
    end: Math.max(end.time, start.time),
    allDay: start.allDay,
    status: raw.status === 'tentative' ? 'tentative' : 'confirmed',
    myResponse: self ? responseOf(self.responseStatus) : null,
    attendees: [...new Set(emails)],
    meetingUrl,
    appName: meetingUrl ? meetingAppName(meetingUrl) : null,
  }
}

/** Réponse de events.list → événements utilisables, triés par début. */
export function normalizeCalendarEvents(body: unknown): CalendarEvent[] | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null
  return body.items
    .map(normalizeCalendarEvent)
    .filter((e): e is CalendarEvent => e !== null)
    .sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------------------
// Appel REST
// ---------------------------------------------------------------------------

/** URL de lecture des événements autour de `now` (sans jeton : il part dans l'en-tête). */
export function calendarEventsUrl(now: number): string {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date(now - CALENDAR_LOOKBEHIND_MS).toISOString(),
    timeMax: new Date(now + CALENDAR_LOOKAHEAD_MS).toISOString(),
    maxResults: String(MAX_RESULTS),
    fields: CALENDAR_FIELDS,
  })
  return `${EVENTS_URL}?${params.toString()}`
}

/** Événements de l'agenda principal de 12 h avant à 24 h après `now`. */
export async function fetchCalendarEvents(accessToken: string, now: number, signal?: AbortSignal): Promise<CalendarEvent[]> {
  let response: Response
  try {
    response = await fetch(calendarEventsUrl(now), { headers: { Authorization: `Bearer ${accessToken}` }, signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new GoogleCalendarError(0, 'Google Agenda ne répond pas. Vérifie la connexion internet.', false)
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 401) {
    throw new GoogleCalendarError(401, "Google Agenda refuse le jeton d'accès : il faut le rafraîchir.", true)
  }
  if (!response.ok) {
    const error = isObject(body) && isObject(body.error) ? body.error : {}
    const detail = text(error.message)
    throw new GoogleCalendarError(
      response.status,
      `Google Agenda a répondu ${response.status}${detail ? ` : ${detail}` : ''}.`,
      false,
    )
  }
  const events = normalizeCalendarEvents(body)
  if (!events) throw new GoogleCalendarError(response.status, 'Réponse de Google Agenda inattendue.', false)
  return events
}
