/**
 * Source « agenda » : Google Agenda du compte Sordulo OS (ligne `calendar` de `google_connections`, page
 * Connecteurs). Lecture seule de l'agenda principal, par le front avec un jeton d'accès donné par Rust.
 *
 * - Connecté à Sordulo OS avec une ligne qui a un jeton de rafraîchissement : la ligne est relue toutes les
 *   CONNECTION_CHECK_MS (elle change depuis la fenêtre principale ou un autre ordinateur) et les événements
 *   (12 h avant, 24 h après) toutes les EVENTS_REFRESH_MS. Ils vont dans le magasin partagé (calendarStore),
 *   lu par la source « appel » pour présélectionner le projet et titrer l'entrée.
 * - Jeton refusé par Google (`googleAccessToken` → refused) : la ligne est marquée perdue (« À reconnecter »),
 *   les événements sont oubliés, et « Reconnecte Google Agenda » part une seule fois par perte d'accès (de
 *   nouveau après une reconnexion puis une nouvelle perte). Une ligne relue sans jeton prévient de même.
 * - Rappel : 5 min avant le début d'un événement avec un lien de visio, ni refusé ni sur la journée entière,
 *   une seule fois par (id, début) : « <titre> dans 5 min », Rejoindre ouvre le lien. Le projet n'est cité que
 *   si l'agenda le désigne (participants, titre). Pas de rappel pour un événement déjà commencé.
 * - Déconnexion de Sordulo OS ou changement de compte : tout s'arrête, le magasin est vidé.
 *
 * Les opérations passent une à une (file). Jamais de jeton dans les journaux.
 */
import type { ClientDirectoryEntry } from '../../../../lib/clientDirectory'
import { googleConnectionState, type GoogleAccountConnection } from '../../../../lib/google'
import { GoogleCalendarError, type CalendarEvent } from '../../../../lib/googleCalendar'
import type { GoogleAccess, GoogleService } from '../../../../shared/desktop-contract'
import { createNotification } from '../../catalog'
import type { TimerId } from '../../coordinator/clock'
import type { IslandNotification } from '../../types'
import type { IslandProjectOption } from '../../view/types'
import { ONGOING_LEAD_MS, pickCalendarProject } from '../calendarMatch'
import { clearCalendarEvents, type CalendarEventsStore } from '../calendarStore'
import { projectNameOf } from '../callFlow'
import type { IslandSource } from '../source'

/** Relecture de la ligne du compte. */
export const CONNECTION_CHECK_MS = 60_000
/** Relecture des événements de l'agenda. */
export const EVENTS_REFRESH_MS = 5 * 60_000
/** Le rappel part 5 min avant le début. */
export const REMINDER_LEAD_MS = ONGOING_LEAD_MS

export interface CalendarSourceDeps {
  readGoogleConnection: (service: GoogleService) => Promise<GoogleAccountConnection | null>
  markGoogleConnectionLost: (service: GoogleService) => Promise<void>
  googleAccessToken: (args: { service: GoogleService; refreshToken: string; forceRefresh?: boolean }) => Promise<GoogleAccess>
  fetchCalendarEvents: (accessToken: string, now: number) => Promise<CalendarEvent[]>
  /** Clients, contacts et projets : projet cité dans le rappel. */
  loadClientDirectory: () => Promise<ClientDirectoryEntry[]>
  readLastProjectId: () => string | null
  /** Magasin partagé avec la source « appel ». */
  calendarEvents: CalendarEventsStore
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Clé du rappel : un événement déplacé a droit à un nouveau rappel. */
export function reminderKey(event: Pick<CalendarEvent, 'id' | 'start'>): string {
  return `${event.id}@${event.start}`
}

/** L'événement mérite un rappel : visio, non refusé, pas sur la journée, pas encore commencé à `now`. */
export function needsReminder(event: CalendarEvent, now: number): event is CalendarEvent & { meetingUrl: string } {
  return event.meetingUrl !== null && !event.allDay && event.myResponse !== 'declined' && event.start > now
}

/** Minutes avant le début, arrondies (au moins 1). */
export function minutesUntil(start: number, now: number): number {
  return Math.max(1, Math.round((start - now) / 60_000))
}

export function reminderNotification(params: {
  event: CalendarEvent & { meetingUrl: string }
  now: number
  projectName: string | null
}): IslandNotification {
  const { event, now, projectName } = params
  return createNotification('rappel', {
    meetingTitle: event.title,
    minutes: minutesUntil(event.start, now),
    appName: event.appName ?? 'Visio',
    projectName,
    url: event.meetingUrl,
  })
}

/** Projet cité dans le rappel : seulement s'il vient de l'agenda (pas le dernier projet utilisé). */
export function reminderProjectName(params: {
  event: CalendarEvent
  directory: readonly ClientDirectoryEntry[]
  projects: readonly IslandProjectOption[]
  lastProjectId: string | null
  now: number
}): string | null {
  const pick = pickCalendarProject({ ...params, now: Math.max(params.now, params.event.start - ONGOING_LEAD_MS) })
  return pick.reason ? projectNameOf(params.projects, pick.projectId) : null
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface Stoppable {
  stop: () => void
}

function warn(label: string) {
  return (e: unknown) => console.warn(`[île] Google Agenda, ${label} :`, e)
}

export function createCalendarSource(deps: CalendarSourceDeps): IslandSource {
  return {
    id: 'agenda',
    start(ctx) {
      const { clock } = ctx
      const store = deps.calendarEvents
      /** Accès perdu déjà signalé : pas de seconde notification avant le retour de la connexion. */
      let lostNotified = false
      /** Rappels déjà partis (id@début), pour toute la vie de la fenêtre. */
      const reminded = new Set<string>()
      /**
       * Dernier jeton refusé par Google : s'il est encore sur la ligne (perte non enregistrée), il n'est pas
       * réessayé et la ligne compte comme perdue.
       */
      let refusedToken: string | null = null

      function startRun(): Stoppable {
        let stopped = false
        let checkTimer: TimerId | null = null
        let eventsTimer: TimerId | null = null
        const reminderTimers = new Map<string, TimerId>()
        /** Jeton de rafraîchissement de la dernière ligne lue ; null : pas connecté. */
        let refreshToken: string | null = null
        let queue: Promise<void> = Promise.resolve()

        const alive = () => !stopped && !ctx.isDisposed()

        function enqueue(task: () => Promise<void>): void {
          queue = queue.then(() => (alive() ? task() : undefined)).catch(warn('suivi'))
        }

        function clearReminders(): void {
          for (const timer of reminderTimers.values()) clock.clearTimeout(timer)
          reminderTimers.clear()
        }

        function forgetEvents(): void {
          clearReminders()
          if (eventsTimer !== null) clock.clearTimeout(eventsTimer)
          eventsTimer = null
          clearCalendarEvents(store)
        }

        function notifyIfLost(row: GoogleAccountConnection | null): void {
          const refused = !!row?.refreshToken && row.refreshToken === refusedToken
          const state = refused ? 'lost' : googleConnectionState(row)
          if (state !== 'lost') lostNotified = false
          if (state !== 'lost' || lostNotified) return
          lostNotified = true
          ctx.coordinator.notify(createNotification('googleReconnect', { service: 'calendar' }))
        }

        /** Rappel dû à `now` ; l'ordinateur était en veille et l'événement a commencé : on ne prévient plus. */
        async function remind(event: CalendarEvent & { meetingUrl: string }, now: number): Promise<void> {
          const key = reminderKey(event)
          if (reminded.has(key) || event.start <= now) return
          reminded.add(key)
          let directory: readonly ClientDirectoryEntry[] = []
          try {
            directory = await deps.loadClientDirectory()
          } catch (e) {
            warn('annuaire des clients')(e)
          }
          if (!alive()) return
          const projectName = reminderProjectName({
            event,
            directory,
            projects: ctx.projects.get(),
            lastProjectId: deps.readLastProjectId(),
            now,
          })
          ctx.coordinator.notify(reminderNotification({ event, now, projectName }))
        }

        /** Programme les rappels des événements lus à `readAt` (déjà commencés à la lecture : aucun). */
        function scheduleReminders(events: readonly CalendarEvent[], readAt: number): void {
          clearReminders()
          for (const event of events) {
            if (!needsReminder(event, readAt) || reminded.has(reminderKey(event))) continue
            const key = reminderKey(event)
            const delay = event.start - REMINDER_LEAD_MS - clock.now()
            if (delay <= 0) {
              // Moins de 5 min avant le début à la lecture : le rappel part tout de suite.
              const now = clock.now()
              enqueue(() => remind(event, now))
              continue
            }
            reminderTimers.set(
              key,
              clock.setTimeout(() => {
                reminderTimers.delete(key)
                const now = clock.now()
                enqueue(() => remind(event, now))
              }, delay),
            )
          }
        }

        function scheduleEvents(): void {
          if (eventsTimer !== null) clock.clearTimeout(eventsTimer)
          eventsTimer = clock.setTimeout(() => {
            eventsTimer = null
            enqueue(refreshEvents)
          }, EVENTS_REFRESH_MS)
        }

        /** Jeton refusé par Google : la ligne passe « À reconnecter ». */
        async function onRefused(token: string): Promise<void> {
          console.warn('[île] Google Agenda refuse le jeton du compte : à reconnecter')
          refusedToken = token
          try {
            await deps.markGoogleConnectionLost('calendar')
          } catch (e) {
            warn("perte d'accès non enregistrée")(e)
          }
          if (!alive() || refreshToken !== token) return
          refreshToken = null
          forgetEvents()
          if (!lostNotified) {
            lostNotified = true
            ctx.coordinator.notify(createNotification('googleReconnect', { service: 'calendar' }))
          }
        }

        async function refreshEvents(forceRefresh = false): Promise<void> {
          const token = refreshToken
          if (!token) return
          let retried = false
          try {
            const access = await deps.googleAccessToken({ service: 'calendar', refreshToken: token, forceRefresh })
            if (!alive() || refreshToken !== token) return
            if (access.status === 'refused') {
              await onRefused(token)
              return
            }
            const readAt = clock.now()
            let events: CalendarEvent[]
            try {
              events = await deps.fetchCalendarEvents(access.accessToken, readAt)
            } catch (e) {
              // 401 : le jeton d'accès gardé par Rust n'est plus bon ; un seul nouvel essai avec un jeton neuf.
              if (!forceRefresh && e instanceof GoogleCalendarError && e.unauthorized) {
                retried = true
                await refreshEvents(true)
                return
              }
              throw e
            }
            if (!alive() || refreshToken !== token) return
            store.set(events)
            scheduleReminders(events, readAt)
          } catch (e) {
            // Réseau, 401 (jeton d'accès à rafraîchir), 403 : on garde les événements lus, nouvel essai plus tard.
            warn('événements illisibles')(e)
          } finally {
            if (!retried && alive() && refreshToken === token) scheduleEvents()
          }
        }

        /** Relit la ligne ; nouveau jeton (connexion, autre ordinateur) : relit tout de suite les événements. */
        async function check(): Promise<void> {
          let row: GoogleAccountConnection | null
          try {
            row = await deps.readGoogleConnection('calendar')
          } catch (e) {
            warn('connexion illisible')(e)
            return
          }
          if (!alive()) return
          notifyIfLost(row)
          const token = row?.refreshToken ?? null
          const next = token !== null && token !== refusedToken ? token : null
          if (next === refreshToken) return
          refreshToken = next
          if (next) await refreshEvents()
          else forgetEvents()
        }

        function scheduleCheck(): void {
          checkTimer = clock.setTimeout(() => {
            checkTimer = null
            enqueue(check)
            enqueue(async () => scheduleCheck())
          }, CONNECTION_CHECK_MS)
        }

        enqueue(check)
        enqueue(async () => scheduleCheck())

        return {
          stop() {
            stopped = true
            if (checkTimer !== null) clock.clearTimeout(checkTimer)
            checkTimer = null
            forgetEvents()
          },
        }
      }

      let run: Stoppable | null = null
      let runUser: string | null = null

      function refresh(): void {
        if (ctx.isDisposed()) return
        const session = ctx.session.get()
        if (session.status === 'loading') return
        const user = session.status === 'signedIn' ? (session.userId ?? '') : null
        if (run && runUser !== user) {
          run.stop()
          run = null
          runUser = null
          lostNotified = false
          refusedToken = null
        }
        if (user !== null && !run) {
          runUser = user
          run = startRun()
        }
      }

      const stopSession = ctx.session.subscribe(refresh)
      refresh()

      return {
        dispose() {
          stopSession()
          run?.stop()
          run = null
          runUser = null
        },
      }
    },
  }
}
