import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CALENDAR_FIELDS,
  GoogleCalendarError,
  UNTITLED_EVENT,
  calendarEventsUrl,
  fetchCalendarEvents,
  findMeetingUrl,
  meetingAppName,
  normalizeCalendarEvent,
  normalizeCalendarEvents,
} from './googleCalendar'

const NOW = Date.parse('2026-11-25T10:00:00Z')

function raw(fields: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    status: 'confirmed',
    summary: 'Point Ibé',
    start: { dateTime: '2026-11-25T11:00:00+01:00' },
    end: { dateTime: '2026-11-25T11:30:00+01:00' },
    ...fields,
  }
}

describe('liens de visio', () => {
  it('app d’après le lien', () => {
    expect(meetingAppName('https://meet.google.com/abc-defg-hij')).toBe('Google Meet')
    expect(meetingAppName('https://us02web.zoom.us/j/123')).toBe('Zoom')
    expect(meetingAppName('https://teams.microsoft.com/l/meetup-join/x')).toBe('Teams')
    expect(meetingAppName('https://teams.live.com/meet/9')).toBe('Teams')
    expect(meetingAppName('https://sordulo.webex.com/meet/mael')).toBe('Webex')
    expect(meetingAppName('https://whereby.com/sordulo')).toBe('Visio')
    expect(meetingAppName('https://notzoom.us.example.com/x')).toBe('Visio')
  })

  it('trouve un lien connu dans un texte ou du HTML, sans la ponctuation de fin', () => {
    expect(findMeetingUrl('Rejoindre : https://us02web.zoom.us/j/123?pwd=abc. Merci')).toBe('https://us02web.zoom.us/j/123?pwd=abc')
    expect(findMeetingUrl('<a href="https://teams.microsoft.com/l/meetup-join/x?a=1&amp;b=2">Teams</a>')).toBe(
      'https://teams.microsoft.com/l/meetup-join/x?a=1&b=2',
    )
    expect(findMeetingUrl('Voir https://ibe.fr puis https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
    expect(findMeetingUrl('Bureau, 3e étage')).toBeNull()
    expect(findMeetingUrl(null)).toBeNull()
  })
})

describe('normalisation des événements', () => {
  it('événement complet : participants hors moi et hors salles, ma réponse, Meet', () => {
    const event = normalizeCalendarEvent(
      raw({
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
        attendees: [
          { email: 'mael@sordulo.fr', self: true, responseStatus: 'accepted' },
          { email: ' Lea@Ibe.fr ', responseStatus: 'needsAction' },
          { email: 'lea@ibe.fr' },
          { email: 'salle@resource.calendar.google.com', resource: true },
        ],
      }),
    )
    expect(event).toEqual({
      id: 'ev-1',
      title: 'Point Ibé',
      start: Date.parse('2026-11-25T10:00:00Z'),
      end: Date.parse('2026-11-25T10:30:00Z'),
      allDay: false,
      status: 'confirmed',
      myResponse: 'accepted',
      attendees: ['lea@ibe.fr'],
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      appName: 'Google Meet',
    })
  })

  it('point d’entrée vidéo, puis lien du lieu, puis de la description', () => {
    const conference = normalizeCalendarEvent(
      raw({
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+33-1' },
            { entryPointType: 'video', uri: 'https://zoom.us/j/42' },
          ],
        },
        location: 'https://teams.microsoft.com/l/x',
      }),
    )
    expect(conference).toMatchObject({ meetingUrl: 'https://zoom.us/j/42', appName: 'Zoom' })
    expect(normalizeCalendarEvent(raw({ location: 'https://teams.microsoft.com/l/x' }))).toMatchObject({ appName: 'Teams' })
    expect(normalizeCalendarEvent(raw({ description: 'Lien : https://ibe.webex.com/meet/lea' }))).toMatchObject({
      appName: 'Webex',
    })
    expect(normalizeCalendarEvent(raw())).toMatchObject({ meetingUrl: null, appName: null })
  })

  it('journée entière : minuit local, fin exclue', () => {
    const event = normalizeCalendarEvent(raw({ start: { date: '2026-11-25' }, end: { date: '2026-11-26' } }))
    expect(event).toMatchObject({
      allDay: true,
      start: new Date(2026, 10, 25).getTime(),
      end: new Date(2026, 10, 26).getTime(),
    })
  })

  it('annulé, sans id ou sans date : écarté ; sans titre : « (Sans titre) » ; sans invités : pas de réponse', () => {
    expect(normalizeCalendarEvent(raw({ status: 'cancelled' }))).toBeNull()
    expect(normalizeCalendarEvent(raw({ id: '' }))).toBeNull()
    expect(normalizeCalendarEvent(raw({ start: {} }))).toBeNull()
    expect(normalizeCalendarEvent(raw({ start: { dateTime: 'demain' } }))).toBeNull()
    expect(normalizeCalendarEvent('x')).toBeNull()
    const alone = normalizeCalendarEvent(raw({ summary: '  ', status: 'tentative' }))
    expect(alone).toMatchObject({ title: UNTITLED_EVENT, myResponse: null, attendees: [], status: 'tentative' })
  })

  it('liste : triée par début, éléments inutilisables écartés ; forme inattendue : null', () => {
    const events = normalizeCalendarEvents({
      items: [
        raw({ id: 'b', start: { dateTime: '2026-11-25T15:00:00Z' }, end: { dateTime: '2026-11-25T16:00:00Z' } }),
        raw({ id: 'a' }),
        raw({ id: 'c', status: 'cancelled' }),
        null,
      ],
    })
    expect(events?.map((e) => e.id)).toEqual(['a', 'b'])
    expect(normalizeCalendarEvents({})).toBeNull()
    expect(normalizeCalendarEvents({ items: [] })).toEqual([])
  })
})

describe('fetchCalendarEvents (fetch simulé)', () => {
  const SECRET = 'ya29.SECRET_ACCESS_TOKEN'
  afterEach(() => vi.unstubAllGlobals())

  const stub = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  async function fail(): Promise<GoogleCalendarError> {
    const error = await fetchCalendarEvents(SECRET, NOW).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(GoogleCalendarError)
    expect((error as Error).message).not.toContain(SECRET)
    return error as GoogleCalendarError
  }

  it('URL : agenda principal, événements uniques triés, de 12 h avant à 24 h après, champs utiles', () => {
    const url = new URL(calendarEventsUrl(NOW))
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('orderBy')).toBe('startTime')
    expect(url.searchParams.get('timeMin')).toBe('2026-11-24T22:00:00.000Z')
    expect(url.searchParams.get('timeMax')).toBe('2026-11-26T10:00:00.000Z')
    expect(url.searchParams.get('fields')).toBe(CALENDAR_FIELDS)
  })

  it('succès : jeton dans l’en-tête (jamais dans l’URL), événements normalisés', async () => {
    stub(200, { items: [raw()] })
    await expect(fetchCalendarEvents(SECRET, NOW)).resolves.toMatchObject([{ id: 'ev-1', title: 'Point Ibé' }])
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).not.toContain(SECRET)
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`)
  })

  it('401 : jeton à rafraîchir', async () => {
    stub(401, { error: { code: 401, message: 'Invalid Credentials' } })
    expect(await fail()).toMatchObject({ status: 401, unauthorized: true })
  })

  it('403 et autres : erreur, pas un jeton à rafraîchir', async () => {
    stub(403, { error: { code: 403, message: 'Calendar API has not been used' } })
    const e = await fail()
    expect(e).toMatchObject({ status: 403, unauthorized: false })
    expect(e.message).toContain('403')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 500 })))
    expect(await fail()).toMatchObject({ status: 500, unauthorized: false })
  })

  it('réponse 200 de forme inattendue : erreur', async () => {
    stub(200, { nope: true })
    expect((await fail()).message).toContain('inattendue')
  })

  it('erreur réseau : status 0, sans le jeton', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError(`Failed to fetch Bearer ${SECRET}`)
    }))
    expect(await fail()).toMatchObject({ status: 0, unauthorized: false })
  })
})
