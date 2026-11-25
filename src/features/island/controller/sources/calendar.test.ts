import { describe, expect, it, vi } from 'vitest'
import type { ClientDirectoryEntry } from '../../../../lib/clientDirectory'
import type { GoogleAccountConnection } from '../../../../lib/google'
import { GoogleCalendarError, type CalendarEvent } from '../../../../lib/googleCalendar'
import type { GoogleAccess } from '../../../../shared/desktop-contract'
import { createCalendarStore } from '../calendarStore'
import { SIGNED_OUT } from '../source'
import { SIGNED_IN, flush, setupRuntime } from '../testUtils'
import {
  CONNECTION_CHECK_MS,
  EVENTS_REFRESH_MS,
  createCalendarSource,
  minutesUntil,
  needsReminder,
  reminderKey,
  type CalendarSourceDeps,
} from './calendar'

const T0 = 1_000_000
const MIN = 60_000

function row(fields: Partial<GoogleAccountConnection> = {}): GoogleAccountConnection {
  return {
    service: 'calendar',
    refreshToken: 'rt-1',
    account: 'mael@sordulo.fr',
    cursorAt: null,
    createdAt: '2026-11-25T08:00:00Z',
    updatedAt: '2026-11-25T08:00:00Z',
    ...fields,
  }
}

function event(fields: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    title: 'Point Ibé',
    start: T0 + 30 * MIN,
    end: T0 + 60 * MIN,
    allDay: false,
    status: 'confirmed',
    myResponse: 'accepted',
    attendees: ['lea@ibe.fr'],
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    appName: 'Google Meet',
    ...fields,
  }
}

const DIRECTORY: ClientDirectoryEntry[] = [
  {
    clientId: 'c-ibe',
    clientName: 'Ibé',
    emails: ['lea@ibe.fr'],
    projects: [{ id: 'p-1', name: 'App Ibé', status: 'in_progress', createdAt: '2026-10-01' }],
  },
]

function setup(options: { row?: GoogleAccountConnection | null | Error; events?: CalendarEvent[]; signedIn?: boolean } = {}) {
  let current: GoogleAccountConnection | null | Error = options.row === undefined ? row() : options.row
  let events: CalendarEvent[] | Error = options.events ?? []
  let access: GoogleAccess = { status: 'ok', accessToken: 'at-1', expiresAt: T0 + 3_600_000 }
  const calendarEvents = createCalendarStore()
  const deps = {
    readGoogleConnection: vi.fn(async () => {
      if (current instanceof Error) throw current
      return current
    }),
    markGoogleConnectionLost: vi.fn(async () => {
      if (current && !(current instanceof Error)) current = { ...current, refreshToken: null }
    }),
    googleAccessToken: vi.fn(async (_args: { service: string; refreshToken: string; forceRefresh?: boolean }) => access),
    fetchCalendarEvents: vi.fn(async (_token: string, _now: number) => {
      if (events instanceof Error) throw events
      return events
    }),
    loadClientDirectory: vi.fn(async () => DIRECTORY),
    readLastProjectId: vi.fn(() => 'p-2'),
    calendarEvents,
  } satisfies CalendarSourceDeps
  const env = setupRuntime({ sources: [createCalendarSource(deps)], signedIn: options.signedIn })
  const notify = vi.spyOn(env.coordinator, 'notify')
  return {
    ...env,
    deps,
    calendarEvents,
    notify,
    notified: (kind: string) => notify.mock.calls.filter(([n]) => n.kind === kind).map(([n]) => n),
    setRow(next: GoogleAccountConnection | null | Error) {
      current = next
    },
    setEvents(next: CalendarEvent[] | Error) {
      events = next
    },
    setAccess(next: GoogleAccess) {
      access = next
    },
    async tick(ms: number) {
      env.clock.advance(ms)
      await flush()
    },
  }
}

describe('agenda : fonctions pures', () => {
  it('rappel seulement pour une visio non refusée, pas sur la journée, pas commencée', () => {
    expect(needsReminder(event(), T0)).toBe(true)
    expect(needsReminder(event({ meetingUrl: null }), T0)).toBe(false)
    expect(needsReminder(event({ myResponse: 'declined' }), T0)).toBe(false)
    expect(needsReminder(event({ allDay: true }), T0)).toBe(false)
    expect(needsReminder(event({ start: T0 }), T0)).toBe(false)
  })

  it('clé (id, début) et minutes arrondies', () => {
    expect(reminderKey(event())).toBe(`ev-1@${T0 + 30 * MIN}`)
    expect(minutesUntil(T0 + 5 * MIN, T0)).toBe(5)
    expect(minutesUntil(T0 + 4.6 * MIN, T0)).toBe(5)
    expect(minutesUntil(T0 + 10_000, T0)).toBe(1)
  })
})

describe('source « agenda »', () => {
  it('connecté : jeton par Rust, événements dans le magasin partagé, relus toutes les 5 min', async () => {
    const t = setup({ events: [event()] })
    await flush()
    expect(t.deps.googleAccessToken).toHaveBeenCalledWith({ service: 'calendar', refreshToken: 'rt-1', forceRefresh: false })
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledWith('at-1', T0)
    expect(t.calendarEvents.get()).toEqual([event()])
    t.setEvents([event(), event({ id: 'ev-2' })])
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(2)
    expect(t.calendarEvents.get()).toHaveLength(2)
  })

  it('401 de Google Agenda : un seul nouvel essai avec un jeton neuf, puis attente du tour suivant', async () => {
    const t = setup()
    t.setEvents(new GoogleCalendarError(401, 'Unauthorized', true))
    await flush()
    expect(t.deps.googleAccessToken.mock.calls.map(([a]) => a.forceRefresh)).toEqual([false, true])
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(2)
    t.setEvents([event()])
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(3)
    expect(t.calendarEvents.get()).toEqual([event()])
  })

  it('ligne relue toutes les 60 s ; nouveau jeton : événements relus tout de suite', async () => {
    const t = setup()
    await flush()
    expect(t.deps.readGoogleConnection).toHaveBeenCalledWith('calendar')
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.deps.readGoogleConnection).toHaveBeenCalledTimes(2)
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(1)
    t.setRow(row({ refreshToken: 'rt-2' }))
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.deps.googleAccessToken).toHaveBeenLastCalledWith({ service: 'calendar', refreshToken: 'rt-2', forceRefresh: false })
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(2)
  })

  it('sans ligne ou hors connexion : rien lu chez Google', async () => {
    const t = setup({ row: null })
    await flush()
    expect(t.deps.googleAccessToken).not.toHaveBeenCalled()
    const out = setup({ signedIn: false })
    await flush()
    expect(out.deps.readGoogleConnection).not.toHaveBeenCalled()
  })

  it('déconnexion de Sordulo OS : magasin vidé, plus de lecture', async () => {
    const t = setup({ events: [event()] })
    await flush()
    expect(t.calendarEvents.get()).toHaveLength(1)
    t.session.set(SIGNED_OUT)
    expect(t.calendarEvents.get()).toEqual([])
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(1)
    t.session.set(SIGNED_IN)
    await flush()
    expect(t.deps.fetchCalendarEvents).toHaveBeenCalledTimes(2)
  })

  it('jeton refusé : ligne marquée perdue, magasin vidé, « Reconnecte Google Agenda » une seule fois', async () => {
    const t = setup({ events: [event()] })
    await flush()
    t.setAccess({ status: 'refused' })
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.deps.markGoogleConnectionLost).toHaveBeenCalledWith('calendar')
    expect(t.calendarEvents.get()).toEqual([])
    expect(t.notified('googleReconnect')).toHaveLength(1)
    expect(t.notified('googleReconnect')[0]).toMatchObject({ title: 'Reconnecte Google Agenda' })
    await t.tick(CONNECTION_CHECK_MS)
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.notified('googleReconnect')).toHaveLength(1)

    // Reconnexion puis nouvelle perte : nouvelle notification.
    t.setAccess({ status: 'ok', accessToken: 'at-2', expiresAt: T0 + 9_000_000 })
    t.setRow(row({ refreshToken: 'rt-2' }))
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.deps.fetchCalendarEvents).toHaveBeenLastCalledWith('at-2', expect.any(Number))
    t.setAccess({ status: 'refused' })
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.notified('googleReconnect')).toHaveLength(2)
  })

  it('perte non enregistrée : le jeton refusé n’est pas réessayé ni signalé deux fois', async () => {
    const t = setup()
    await flush()
    t.deps.markGoogleConnectionLost.mockRejectedValueOnce(new Error('réseau'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.setAccess({ status: 'refused' })
    await t.tick(EVENTS_REFRESH_MS)
    await t.tick(CONNECTION_CHECK_MS)
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.deps.googleAccessToken).toHaveBeenCalledTimes(2)
    expect(t.notified('googleReconnect')).toHaveLength(1)
    warn.mockRestore()
  })

  it('ligne déjà perdue à la lecture : notification une fois', async () => {
    const t = setup({ row: row({ refreshToken: null }) })
    await flush()
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.notified('googleReconnect')).toHaveLength(1)
    expect(t.deps.googleAccessToken).not.toHaveBeenCalled()
  })

  it('lecture des événements en échec : on garde les précédents, nouvel essai plus tard', async () => {
    const t = setup({ events: [event()] })
    await flush()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.setEvents(new Error('401'))
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.calendarEvents.get()).toHaveLength(1)
    t.setEvents([])
    await t.tick(EVENTS_REFRESH_MS)
    expect(t.calendarEvents.get()).toEqual([])
    warn.mockRestore()
  })

  describe('rappel', () => {
    it('5 min avant : « Point Ibé dans 5 min », visio et projet de l’agenda, Rejoindre', async () => {
      const t = setup({ events: [event()] })
      await flush()
      await t.tick(25 * MIN - 1)
      expect(t.notified('rappel')).toHaveLength(0)
      await t.tick(1)
      const [reminder] = t.notified('rappel')
      expect(reminder).toMatchObject({
        title: 'Point Ibé dans 5 min',
        subtitle: 'Google Meet, App Ibé',
        button: 'Rejoindre',
        action: { type: 'openUrl', url: 'https://meet.google.com/abc-defg-hij' },
      })
    })

    it('une seule fois par événement, même après plusieurs relectures ; déplacé : nouveau rappel', async () => {
      const t = setup({ events: [event({ start: T0 + 7 * MIN, end: T0 + 40 * MIN })] })
      await flush()
      await t.tick(2 * MIN)
      expect(t.notified('rappel')).toHaveLength(1)
      await t.tick(EVENTS_REFRESH_MS)
      expect(t.notified('rappel')).toHaveLength(1)
      t.setEvents([event({ start: T0 + 30 * MIN, end: T0 + 60 * MIN })])
      await t.tick(EVENTS_REFRESH_MS)
      await t.tick(30 * MIN)
      expect(t.notified('rappel')).toHaveLength(2)
    })

    it('événement à moins de 5 min à la lecture : rappel tout de suite, minutes arrondies', async () => {
      const t = setup({ events: [event({ start: T0 + 3 * MIN })] })
      await flush()
      expect(t.notified('rappel')[0]).toMatchObject({ title: 'Point Ibé dans 3 min' })
    })

    it('déjà commencé, refusé, sur la journée ou sans visio : pas de rappel', async () => {
      const t = setup({
        events: [
          event({ id: 'commence', start: T0 - MIN }),
          event({ id: 'refus', myResponse: 'declined' }),
          event({ id: 'jour', allDay: true }),
          event({ id: 'sans-visio', meetingUrl: null, appName: null }),
        ],
      })
      await flush()
      await t.tick(60 * MIN)
      expect(t.notified('rappel')).toHaveLength(0)
    })

    it('événement retiré ou refusé entre deux lectures : rappel annulé', async () => {
      const t = setup({ events: [event()] })
      await flush()
      t.setEvents([event({ myResponse: 'declined' })])
      await t.tick(EVENTS_REFRESH_MS)
      await t.tick(30 * MIN)
      expect(t.notified('rappel')).toHaveLength(0)
    })

    it('projet non désigné par l’agenda : seulement l’app de visio', async () => {
      const t = setup({ events: [event({ attendees: [], title: 'Déjeuner', start: T0 + 2 * MIN, appName: 'Zoom' })] })
      await flush()
      expect(t.notified('rappel')[0]).toMatchObject({ title: 'Déjeuner dans 2 min', subtitle: 'Zoom' })
    })
  })
})
