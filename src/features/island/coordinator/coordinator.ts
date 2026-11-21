/**
 * Coordination de l'île, sans interface (ni React ni Tauri). Reproduit la section « Priorités entre
 * activités » du prototype (design/prototypes/ile-sordulo-os.html : RANK, INTERRUPT, refresh, pushNotif,
 * pumpNotifs, setDigest, goHomeOr, endMeet), adaptée à l'app réelle.
 *
 * Utilisation
 * ```ts
 * const island = new IslandCoordinator()            // { clock } en option (tests : FakeClock)
 * const snap = useSyncExternalStore(island.subscribe, island.getSnapshot)
 * island.addActivity({ id: 'meet', kind: 'meet', appName: 'Discord', projectId, projectName, startedAt })
 * island.notify(createNotification('tickets', { ... }))   // voir ../catalog
 * island.dispose()
 * ```
 *
 * Lecture : `getSnapshot()` renvoie un IslandSnapshot gelé ; il garde la même identité tant que rien ne
 * change et en prend une nouvelle à chaque changement. `subscribe(listener)` renvoie la désinscription.
 * Ces deux méthodes sont des propriétés liées : on peut les passer telles quelles (useSyncExternalStore).
 *
 * Activités (une seule île, jamais de bulle : une principale, toutes les autres dans `background`,
 * `activityCount` pour le badge « +N »)
 * - `addActivity(input)` : ajoute, ou remplace si l'id existe (elle devient alors la plus récente).
 * - `updateActivity(id, patch)` : mise à jour partielle, garde le rang d'arrivée. Null si l'id est inconnu.
 * - `removeActivity(id)` : retire (et désépingle). Les progressions ne finissent jamais seules : le
 *   contrôleur les retire. Retirer le dernier appel libère les notifications mises de côté (voir endMeet).
 * - `endMeet()` : fin d'appel. Retire l'activité appel ; si le mode concentration a mis des notifications
 *   de côté, met en file « Pendant l'appel : N notifications ». N'ajoute aucune progression : c'est le
 *   contrôleur qui ajoute « Import de l'audio ».
 * - `pin(id)` : épingle l'activité `id`, qui passe devant (refusé pendant une activité exclusive).
 * - `pinSecondary()` : épingle la suivante dans l'ordre de priorité (héritage du clic sur la bulle).
 * Ordre : épinglée, puis appel, progression, Claude (agent, multi), musique ; à rang égal, la plus récente.
 * Exception : avec une musique, et sans Claude épinglé, la musique est la principale devant Claude (les
 * sessions marchent en bas de l'île, dans `background`).
 * Pendant un enregistrement, puis pendant l'import et l'analyse qui le suivent (écart au prototype, demande
 * de Maël) : l'appel, puis sa progression, reste seul dans l'île, même si une autre activité est épinglée,
 * Les autres activités passent dans `background` (affichées sous l'appel au
 * survol, meetOpen ; la progression n'a pas de survol).
 *
 * Par-dessus la principale, une seule chose à la fois : notification, demande d'autorisation ou overlay.
 * - `notify(notification)` : en file. Interruptions (`notification.interrupt`, demandes d'autorisation)
 *   d'abord ; plus de deux en attente au moment de dépiler : une notification `digest` « N nouveautés ».
 *   Chaque notification dure `durationMs`, puis l'île revient à la principale et la suivante part
 *   450 ms après. Pendant un appel en mode concentration, les non-interruptions sont mises de côté.
 * - `endNotification(id?)` : fin anticipée (bouton cliqué, fermeture). Avec un id : seulement si c'est
 *   elle qui s'affiche, sinon la retire de la file. Le contrôleur exécute l'action du bouton lui-même.
 * - `setHover(hover)` : au survol, le temps restant de la notification est mis en pause ; à la sortie,
 *   il reprend (au moins 300 ms).
 * - `requestAsk(ask)` : demande d'autorisation, en file comme interruption ; affichée en `agentAsk`,
 *   avec `askPosition` « 1 sur N » quand d'autres interruptions attendent derrière.
 * - `resolveAsk(id)` : décision prise ou délai expiré. Ferme la demande affichée (retour à la principale,
 *   file suivante 450 ms après) ou la retire de la file. Le contrôleur renvoie la décision lui-même.
 * - `showOverlay('appel' | 'dragWake' | 'dragOver')` / `hideOverlay(overlay?)` : états montrés par le
 *   contrôleur. La file attend tant qu'ils sont affichés ; la file repart 450 ms après hideOverlay.
 *   Un overlay qui arrive pendant une notification ou une demande la remet en tête de file.
 * - `setFocusMode(on)` : mode concentration (menu du soleil).
 * - `dispose()` : arrête les minuteurs et oublie les abonnés.
 */
import { createNotification } from '../catalog'
import type {
  Activity,
  ActivityKind,
  ActivityPayload,
  IslandNotification,
  IslandSnapshot,
  IslandState,
  PermissionAsk,
} from '../types'
import { systemClock, type IslandClock, type TimerId } from './clock'
import { digestTexts } from './digest'
import { sortActivities, stateOfActivity } from './ranking'

/** Délai entre le retour à la principale et la notification suivante (prototype : 450 ms). */
export const NEXT_IN_QUEUE_DELAY_MS = 450
/** Temps minimal laissé à une notification quand le curseur quitte l'île (prototype : 300 ms). */
export const HOVER_RESUME_MIN_MS = 300
/** Au-delà de ce nombre de notifications en attente, on les regroupe. */
export const DIGEST_THRESHOLD = 2

/** Overlays montrés et retirés par le contrôleur (les notifications et demandes sont gérées ici). */
export type ControllerOverlay = 'appel' | 'dragWake' | 'dragOver'

/** Activité à ajouter : l'ordre d'arrivée est donné par la coordination. */
export type ActivityInput = ActivityPayload & { id: string }

/** Mise à jour partielle d'une activité (ni `id`, ni `kind`, ni `order`). */
export type ActivityPatch = {
  [K in ActivityKind]: Partial<Omit<Extract<ActivityPayload, { kind: K }>, 'kind'>>
}[ActivityKind]

export interface IslandCoordinatorOptions {
  clock?: IslandClock
  /** Mode concentration au démarrage. */
  focusMode?: boolean
}

interface NotificationEntry {
  type: 'notification'
  notification: IslandNotification
  /** Titres regroupés : le sien, ou ceux d'un digest (pour un regroupement de regroupements). */
  sources: readonly string[]
}

interface AskEntry {
  type: 'ask'
  ask: PermissionAsk
}

type QueueEntry = NotificationEntry | AskEntry

type Current =
  | { type: 'notification'; entry: NotificationEntry; remaining: number; startedAt: number; timer: TimerId | null }
  | { type: 'ask'; ask: PermissionAsk }
  | { type: 'overlay'; overlay: ControllerOverlay }

function isInterrupt(entry: QueueEntry): boolean {
  return entry.type === 'ask' || entry.notification.interrupt
}

function notificationEntry(notification: IslandNotification): NotificationEntry {
  return { type: 'notification', notification, sources: [notification.title] }
}

/**
 * Activité qui reste seule dans l'île, sans bulle : l'appel le plus récent, sinon l'import ou l'analyse la
 * plus récente (après l'appel, ou après un dépôt). Null : règle normale (principale + bulle).
 */
function exclusiveActivity(activities: Iterable<Activity>): Activity | null {
  let meet: Activity | null = null
  let progress: Activity | null = null
  for (const activity of activities) {
    if (activity.kind === 'meet' && (!meet || activity.order > meet.order)) meet = activity
    if (
      activity.kind === 'progress' &&
      (activity.stage === 'upload' || activity.stage === 'analyse') &&
      (!progress || activity.order > progress.order)
    ) {
      progress = activity
    }
  }
  return meet ?? progress
}

function sameSnapshot(a: IslandSnapshot, b: IslandSnapshot): boolean {
  return (
    a.state === b.state &&
    a.primary === b.primary &&
    a.secondary === b.secondary &&
    a.background.length === b.background.length &&
    a.background.every((activity, i) => activity === b.background[i]) &&
    a.activityCount === b.activityCount &&
    a.pinnedId === b.pinnedId &&
    a.notification === b.notification &&
    a.withCall === b.withCall &&
    a.ask === b.ask &&
    a.askPosition?.index === b.askPosition?.index &&
    a.askPosition?.total === b.askPosition?.total &&
    a.focusMode === b.focusMode
  )
}

export class IslandCoordinator {
  private readonly clock: IslandClock
  private readonly listeners = new Set<() => void>()
  private readonly activities = new Map<string, Activity>()
  private order = 0
  private pinnedId: string | null = null
  private queue: QueueEntry[] = []
  /** Mises de côté par le mode concentration pendant l'appel. */
  private held: IslandNotification[] = []
  private current: Current | null = null
  private pumpTimer: TimerId | null = null
  private hovered = false
  private focusMode: boolean
  private disposed = false
  private snapshot: IslandSnapshot

  constructor(options: IslandCoordinatorOptions = {}) {
    this.clock = options.clock ?? systemClock
    this.focusMode = options.focusMode ?? false
    this.snapshot = this.buildSnapshot()
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  /** Instantané courant (gelé). Propriété liée : utilisable telle quelle par useSyncExternalStore. */
  readonly getSnapshot = (): IslandSnapshot => this.snapshot

  /** Abonnement aux changements d'instantané. Renvoie la désinscription. Propriété liée. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Activité par id (y compris celles qui ne sont ni principale ni secondaire). */
  getActivity(id: string): Activity | null {
    return this.activities.get(id) ?? null
  }

  // -------------------------------------------------------------------------
  // Activités
  // -------------------------------------------------------------------------

  /** Ajoute une activité, ou la remplace si l'id existe (elle devient la plus récente). */
  addActivity(input: ActivityInput): Activity {
    this.order += 1
    const activity: Activity = Object.freeze({ ...input, order: this.order })
    this.activities.set(activity.id, activity)
    this.commit()
    return activity
  }

  /** Mise à jour partielle ; garde l'id, la sorte et l'ordre d'arrivée. Null si l'id est inconnu. */
  updateActivity(id: string, patch: ActivityPatch): Activity | null {
    const existing = this.activities.get(id)
    if (!existing) return null
    const activity = Object.freeze({
      ...existing,
      ...patch,
      id: existing.id,
      kind: existing.kind,
      order: existing.order,
    }) as Activity
    this.activities.set(id, activity)
    this.commit()
    return activity
  }

  /** Retire une activité (et la désépingle). Faux si l'id est inconnu. */
  removeActivity(id: string): boolean {
    const existing = this.activities.get(id)
    if (!existing) return false
    this.activities.delete(id)
    if (this.pinnedId === id) this.pinnedId = null
    if (existing.kind === 'meet' && !this.hasMeet()) this.releaseHeld()
    this.commit()
    return true
  }

  /** Fin d'appel : retire l'activité appel et résume ce que le mode concentration a mis de côté. */
  endMeet(): void {
    for (const activity of [...this.activities.values()]) {
      if (activity.kind !== 'meet') continue
      this.activities.delete(activity.id)
      if (this.pinnedId === activity.id) this.pinnedId = null
    }
    this.releaseHeld()
    this.commit()
  }

  /**
   * Épingle l'activité `id`, qui passe devant les autres (même la musique devant Claude). Refuse (faux) si
   * l'id est inconnu ou pendant une activité exclusive (appel, import, analyse), qui reste seule devant.
   */
  pin(id: string): boolean {
    if (!this.activities.has(id)) return false
    if (exclusiveActivity(this.activities.values())) return false
    this.pinnedId = id
    this.commit()
    return true
  }

  /**
   * Épingle la suivante dans l'ordre de priorité, qui passe devant (héritage du clic sur l'ancienne bulle,
   * encore utilisé par le laboratoire). Renvoie l'id épinglé, null s'il n'y en a pas ou pendant une
   * activité exclusive.
   */
  pinSecondary(): string | null {
    if (exclusiveActivity(this.activities.values())) return null
    const secondary = this.sorted()[1]
    if (!secondary) return null
    this.pinnedId = secondary.id
    this.commit()
    return secondary.id
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  /** Met une notification en file (ou de côté pendant un appel en mode concentration). */
  notify(notification: IslandNotification): void {
    if (this.disposed || this.knowsNotification(notification.id)) return
    if (this.focusMode && this.hasMeet() && !notification.interrupt) {
      this.held.push(notification)
      return
    }
    this.queue.push(notificationEntry(notification))
    this.pump()
    this.commit()
  }

  /**
   * Termine la notification affichée (bouton, fermeture) : retour à la principale, suivante 450 ms après.
   * Avec un id : ne fait rien si une autre s'affiche, et retire celle-ci de la file si elle y attend.
   */
  endNotification(id?: string): void {
    const current = this.current
    if (current?.type === 'notification' && (id === undefined || current.entry.notification.id === id)) {
      this.stopNotificationTimer(current)
      this.current = null
      this.schedulePump()
      this.commit()
      return
    }
    if (id === undefined) return
    this.queue = this.queue.filter((entry) => entry.type !== 'notification' || entry.notification.id !== id)
    this.held = this.held.filter((notification) => notification.id !== id)
    this.commit()
  }

  /** Survol de l'île : met en pause le temps restant de la notification, puis le reprend (au moins 300 ms). */
  setHover(hover: boolean): void {
    if (hover === this.hovered) return
    this.hovered = hover
    const current = this.current
    if (current?.type !== 'notification') return
    if (hover) {
      if (current.timer === null) return
      this.stopNotificationTimer(current)
      current.remaining -= this.clock.now() - current.startedAt
    } else {
      this.stopNotificationTimer(current)
      this.startNotificationTimer(current, Math.max(HOVER_RESUME_MIN_MS, current.remaining))
    }
  }

  /** Mode concentration : pendant un appel, les notifications (hors interruptions) attendent la fin. */
  setFocusMode(on: boolean): void {
    this.focusMode = on
    this.commit()
  }

  // -------------------------------------------------------------------------
  // Demandes d'autorisation
  // -------------------------------------------------------------------------

  /** Met une demande d'autorisation en file, comme interruption. Ignorée si cet id est déjà connu. */
  requestAsk(ask: PermissionAsk): void {
    if (this.disposed || this.knowsAsk(ask.id)) return
    this.queue.push({ type: 'ask', ask })
    this.pump()
    this.commit()
  }

  /**
   * Décision prise ou délai expiré : ferme la demande affichée (retour à la principale, file suivante
   * 450 ms après) ou la retire de la file. Faux si l'id est inconnu.
   */
  resolveAsk(id: string): boolean {
    if (this.current?.type === 'ask' && this.current.ask.id === id) {
      this.goHome()
      return true
    }
    const index = this.queue.findIndex((entry) => entry.type === 'ask' && entry.ask.id === id)
    if (index < 0) return false
    this.queue.splice(index, 1)
    this.commit()
    return true
  }

  // -------------------------------------------------------------------------
  // Overlays du contrôleur
  // -------------------------------------------------------------------------

  /** Montre un overlay du contrôleur ; la file attend. Une notification ou demande affichée repasse en tête. */
  showOverlay(overlay: ControllerOverlay): void {
    if (this.disposed) return
    const current = this.current
    if (current?.type === 'notification') {
      this.stopNotificationTimer(current)
      this.queue.unshift(current.entry)
    } else if (current?.type === 'ask') {
      this.queue.unshift({ type: 'ask', ask: current.ask })
    }
    this.current = { type: 'overlay', overlay }
    this.commit()
  }

  /** Retire l'overlay affiché (celui-ci seulement si précisé) ; la file repart 450 ms après. */
  hideOverlay(overlay?: ControllerOverlay): void {
    if (this.current?.type !== 'overlay') return
    if (overlay !== undefined && this.current.overlay !== overlay) return
    this.goHome()
  }

  /** Arrête les minuteurs et oublie les abonnés. La coordination ne doit plus servir ensuite. */
  dispose(): void {
    this.disposed = true
    if (this.current?.type === 'notification') this.stopNotificationTimer(this.current)
    if (this.pumpTimer !== null) this.clock.clearTimeout(this.pumpTimer)
    this.pumpTimer = null
    this.listeners.clear()
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  private sorted(): Activity[] {
    return sortActivities(this.activities.values(), this.pinnedId)
  }

  private hasMeet(): boolean {
    for (const activity of this.activities.values()) if (activity.kind === 'meet') return true
    return false
  }

  private knowsNotification(id: string): boolean {
    if (this.current?.type === 'notification' && this.current.entry.notification.id === id) return true
    if (this.held.some((notification) => notification.id === id)) return true
    return this.queue.some((entry) => entry.type === 'notification' && entry.notification.id === id)
  }

  private knowsAsk(id: string): boolean {
    if (this.current?.type === 'ask' && this.current.ask.id === id) return true
    return this.queue.some((entry) => entry.type === 'ask' && entry.ask.id === id)
  }

  /** Fin d'appel : ce qui a été mis de côté devient « Pendant l'appel : N notifications ». */
  private releaseHeld(): void {
    if (this.held.length === 0) return
    const titles = this.held.map((notification) => notification.title)
    this.held = []
    this.queue.push({
      type: 'notification',
      notification: createNotification('digest', digestTexts(titles, true)),
      sources: titles,
    })
    this.pump()
  }

  /** Prototype : goHomeOr. Retour à la principale, file suivante 450 ms après. */
  private goHome(): void {
    if (this.current?.type === 'notification') this.stopNotificationTimer(this.current)
    this.current = null
    this.schedulePump()
    this.commit()
  }

  private schedulePump(): void {
    if (this.disposed) return
    if (this.pumpTimer !== null) this.clock.clearTimeout(this.pumpTimer)
    this.pumpTimer = this.clock.setTimeout(() => {
      this.pumpTimer = null
      this.pump()
      this.commit()
    }, NEXT_IN_QUEUE_DELAY_MS)
  }

  /** Prototype : pumpNotifs. Affiche la suivante si rien n'est par-dessus la principale. */
  private pump(): void {
    if (this.disposed || this.current !== null || this.queue.length === 0) return
    const interruptIndex = this.queue.findIndex(isInterrupt)
    if (interruptIndex >= 0) {
      const [entry] = this.queue.splice(interruptIndex, 1)
      if (entry) this.display(entry)
      return
    }
    if (this.queue.length > DIGEST_THRESHOLD) {
      const titles = this.queue.splice(0).flatMap((entry) => (entry.type === 'notification' ? entry.sources : []))
      this.display({
        type: 'notification',
        notification: createNotification('digest', digestTexts(titles)),
        sources: titles,
      })
      return
    }
    const next = this.queue.shift()
    if (next) this.display(next)
  }

  private display(entry: QueueEntry): void {
    if (entry.type === 'ask') {
      this.current = { type: 'ask', ask: entry.ask }
      return
    }
    const duration = entry.notification.durationMs
    const current: Current = {
      type: 'notification',
      entry,
      remaining: duration,
      startedAt: this.clock.now(),
      timer: null,
    }
    this.current = current
    if (!this.hovered) this.startNotificationTimer(current, duration)
  }

  private startNotificationTimer(current: Extract<Current, { type: 'notification' }>, ms: number): void {
    const id = current.entry.notification.id
    current.startedAt = this.clock.now()
    current.timer = this.clock.setTimeout(() => {
      current.timer = null
      this.endNotification(id)
    }, ms)
  }

  private stopNotificationTimer(current: Extract<Current, { type: 'notification' }>): void {
    if (current.timer !== null) this.clock.clearTimeout(current.timer)
    current.timer = null
  }

  private buildSnapshot(): IslandSnapshot {
    const sorted = this.sorted()
    // Appel en cours, ou import / analyse : seul dans l'île, devant tout, même une activité épinglée.
    const exclusive = exclusiveActivity(sorted)
    let primary = exclusive ?? sorted[0] ?? null
    // Une seule île, jamais de bulle (décision de Maël, 21/11) : avec de la musique, la musique tient l'île et
    // les sessions Claude marchent en bas (jardin dans l'état music), sauf si Claude a été épinglé.
    if (!exclusive && primary && (primary.kind === 'agent' || primary.kind === 'multi') && primary.id !== this.pinnedId) {
      primary = sorted.find((activity) => activity.kind === 'music') ?? primary
    }
    const others = sorted.filter((activity) => activity !== primary)
    const current = this.current
    let state: IslandState = stateOfActivity(primary)
    if (current?.type === 'notification') state = 'notif'
    else if (current?.type === 'ask') state = 'agentAsk'
    else if (current?.type === 'overlay') state = current.overlay
    const notification = current?.type === 'notification' ? current.entry.notification : null
    const ask = current?.type === 'ask' ? current.ask : null
    const waiting = ask ? this.queue.filter(isInterrupt).length : 0
    return Object.freeze({
      state,
      primary,
      secondary: null,
      background: Object.freeze(others),
      activityCount: sorted.length,
      pinnedId: this.pinnedId,
      notification,
      withCall: (notification !== null || ask !== null) && this.hasMeet(),
      ask,
      askPosition: waiting > 0 ? Object.freeze({ index: 1, total: waiting + 1 }) : null,
      focusMode: this.focusMode,
    })
  }

  /** Recalcule l'instantané ; nouvelle identité et abonnés prévenus seulement s'il a changé. */
  private commit(): void {
    if (this.disposed) return
    const next = this.buildSnapshot()
    if (sameSnapshot(next, this.snapshot)) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
