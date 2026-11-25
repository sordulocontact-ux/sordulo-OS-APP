import { describe, expect, it } from 'vitest'
import type { ClientDirectoryEntry } from '../../../lib/clientDirectory'
import { UNTITLED_EVENT, type CalendarEvent } from '../../../lib/googleCalendar'
import type { IslandProjectOption } from '../view/types'
import {
  ONGOING_LEAD_MS,
  isEventOngoing,
  matchKey,
  ongoingEvent,
  pickCalendarProject,
  titleMentions,
} from './calendarMatch'

const NOW = 1_000_000_000
const MIN = 60_000

function event(fields: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    title: 'Point hebdo',
    start: NOW + 2 * MIN,
    end: NOW + 32 * MIN,
    allDay: false,
    status: 'confirmed',
    myResponse: 'accepted',
    attendees: [],
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    appName: 'Google Meet',
    ...fields,
  }
}

const PROJECTS: readonly IslandProjectOption[] = [
  { id: 'p-app', name: 'App Ibé' },
  { id: 'p-site', name: 'Site Sordulo' },
  { id: 'p-logo', name: 'Logo Kaïros' },
]

const DIRECTORY: readonly ClientDirectoryEntry[] = [
  {
    clientId: 'c-ibe',
    clientName: 'Ibé',
    emails: ['lea@ibe.fr'],
    projects: [
      { id: 'p-old', name: 'Ancien', status: 'in_progress', createdAt: '2026-01-01' },
      { id: 'p-app', name: 'App Ibé', status: 'in_progress', createdAt: '2026-10-01' },
    ],
  },
  {
    clientId: 'c-kairos',
    clientName: 'Kaïros Conseil',
    emails: ['paul@kairos.fr'],
    projects: [{ id: 'p-logo', name: 'Logo Kaïros', status: 'in_progress', createdAt: '2026-11-01' }],
  },
  {
    clientId: 'c-paid',
    clientName: 'Sordulo',
    emails: ['contact@sordulo.fr'],
    projects: [{ id: 'p-site', name: 'Site Sordulo', status: 'paid', createdAt: '2026-11-10' }],
  },
]

function pick(ev: CalendarEvent | null, overrides: { lastProjectId?: string | null; now?: number } = {}) {
  return pickCalendarProject({
    event: ev,
    directory: DIRECTORY,
    projects: PROJECTS,
    lastProjectId: overrides.lastProjectId ?? 'p-site',
    now: overrides.now ?? NOW,
  })
}

describe('événement en cours', () => {
  it('de 5 min avant le début jusqu’à la fin', () => {
    const ev = event({ start: NOW, end: NOW + 30 * MIN })
    expect(isEventOngoing(ev, NOW - ONGOING_LEAD_MS - 1)).toBe(false)
    expect(isEventOngoing(ev, NOW - ONGOING_LEAD_MS)).toBe(true)
    expect(isEventOngoing(ev, NOW + 29 * MIN)).toBe(true)
    expect(isEventOngoing(ev, NOW + 30 * MIN)).toBe(false)
  })

  it('jamais refusé ni sur la journée entière', () => {
    expect(isEventOngoing(event({ myResponse: 'declined' }), NOW)).toBe(false)
    expect(isEventOngoing(event({ allDay: true, start: NOW - MIN, end: NOW + 60 * MIN }), NOW)).toBe(false)
    expect(isEventOngoing(event({ myResponse: 'tentative' }), NOW)).toBe(true)
  })

  it('plusieurs : une visio plutôt qu’un bloc perso, puis le début le plus proche', () => {
    const workshop = event({ id: 'atelier', start: NOW - 60 * MIN, end: NOW + 60 * MIN })
    const call = event({ id: 'appel', start: NOW + 3 * MIN })
    const focus = event({ id: 'focus', start: NOW, meetingUrl: null, appName: null })
    expect(ongoingEvent([workshop, call, focus], NOW)?.id).toBe('appel')
    expect(ongoingEvent([focus], NOW)?.id).toBe('focus')
    expect(ongoingEvent([event({ start: NOW + 10 * MIN })], NOW)).toBeNull()
  })
})

describe('comparaison des noms', () => {
  it('sans accents ni casse, mots entiers', () => {
    expect(matchKey('  Point IBÉ / Sordulo ')).toBe(' point ibe sordulo ')
    expect(titleMentions('Point Ibé / Sordulo', 'ibe')).toBe(true)
    expect(titleMentions('Atelier ibérique', 'Ibé')).toBe(false)
    expect(titleMentions('Revue App Ibé', 'App Ibé')).toBe(true)
    expect(titleMentions('Revue', '')).toBe(false)
  })
})

describe('présélection du projet', () => {
  it('participants ↔ contacts : projet en cours le plus récent du client', () => {
    expect(pick(event({ attendees: ['autre@gmail.com', 'lea@ibe.fr'] }))).toEqual({
      projectId: 'p-app',
      reason: "D'après l'agenda : Point hebdo",
      title: 'Point hebdo',
    })
  })

  it('plusieurs clients reconnus : le projet en cours le plus récent', () => {
    expect(pick(event({ attendees: ['lea@ibe.fr', 'paul@kairos.fr'] })).projectId).toBe('p-logo')
  })

  it('projet en cours hors de la liste proposée : ignoré', () => {
    const directory: ClientDirectoryEntry[] = [
      { ...DIRECTORY[0]!, projects: [{ id: 'p-hidden', name: 'Caché', status: 'in_progress', createdAt: '2026-11-20' }] },
    ]
    const result = pickCalendarProject({
      event: event({ attendees: ['lea@ibe.fr'] }),
      directory,
      projects: PROJECTS,
      lastProjectId: 'p-site',
      now: NOW,
    })
    expect(result).toEqual({ projectId: 'p-site', reason: null, title: 'Point hebdo' })
  })

  it('sinon titre ↔ nom du client (son projet en cours)', () => {
    expect(pick(event({ title: 'Point Kairos conseil' }))).toMatchObject({ projectId: 'p-logo', reason: expect.any(String) })
  })

  it('client du titre sans projet en cours : puis nom du projet', () => {
    expect(pick(event({ title: 'Recette site sordulo' }))).toMatchObject({ projectId: 'p-site', reason: expect.any(String) })
  })

  it('titre ↔ nom du projet, le plus long l’emporte', () => {
    const projects: IslandProjectOption[] = [...PROJECTS, { id: 'p-app-v2', name: 'App Ibé V2' }]
    const result = pickCalendarProject({
      event: event({ title: 'Démo App Ibé V2' }),
      directory: [],
      projects,
      lastProjectId: null,
      now: NOW,
    })
    expect(result.projectId).toBe('p-app-v2')
  })

  it('rien de reconnu : dernier projet, sans raison, mais le titre de l’événement', () => {
    expect(pick(event({ title: 'Déjeuner' }))).toEqual({ projectId: 'p-site', reason: null, title: 'Déjeuner' })
    expect(pick(event({ title: 'Déjeuner' }), { lastProjectId: 'inconnu' }).projectId).toBe('p-app')
  })

  it('sans événement en cours : dernier projet, ni raison ni titre', () => {
    expect(pick(null)).toEqual({ projectId: 'p-site', reason: null, title: null })
    expect(pick(event({ start: NOW + 20 * MIN, end: NOW + 50 * MIN, attendees: ['lea@ibe.fr'] }))).toEqual({
      projectId: 'p-site',
      reason: null,
      title: null,
    })
    expect(pick(event({ myResponse: 'declined', attendees: ['lea@ibe.fr'] })).reason).toBeNull()
  })

  it('événement sans titre : pas de titre pour l’entrée', () => {
    expect(pick(event({ title: UNTITLED_EVENT, attendees: ['lea@ibe.fr'] }))).toMatchObject({ projectId: 'p-app', title: null })
  })
})
