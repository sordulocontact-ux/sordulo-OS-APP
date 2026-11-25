/**
 * Événements Google Agenda courants, partagés entre la source « agenda » (sources/calendar.ts), qui les lit
 * toutes les 5 min, et la source « appel » (sources/call.ts), qui s'en sert pour présélectionner le projet et
 * titrer l'entrée. Une seule instance par fenêtre, passée aux deux sources par leurs accès (desktopDeps.ts).
 * Vide : pas de connexion Google Agenda, hors connexion à Sordulo OS, ou pas encore lu.
 */
import type { CalendarEvent } from '../../../lib/googleCalendar'
import { createStore, type ReadableStore, type Store } from './store'

export type CalendarEventsStore = Store<readonly CalendarEvent[]>
export type ReadableCalendarEvents = ReadableStore<readonly CalendarEvent[]>

const NO_EVENTS: readonly CalendarEvent[] = Object.freeze([])

export function createCalendarStore(): CalendarEventsStore {
  return createStore<readonly CalendarEvent[]>(NO_EVENTS)
}

/** Vide le magasin (déconnexion, accès perdu) sans prévenir les abonnés s'il l'était déjà. */
export function clearCalendarEvents(store: CalendarEventsStore): void {
  if (store.get().length > 0) store.set(NO_EVENTS)
}
