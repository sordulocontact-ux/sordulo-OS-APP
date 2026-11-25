/**
 * Contrat d'une source du contrôleur de l'île (voir l'en-tête de ./runtime.ts pour le fonctionnement
 * d'ensemble et ./sources/index.ts pour l'enregistrement). Pur : ni React ni Tauri.
 */
import type { IslandCoordinator } from '../coordinator'
import type { IslandClock } from '../coordinator/clock'
import type { IslandNotification, NotificationAction } from '../types'
import type { IslandProps, IslandProjectOption } from '../view/types'
import type { IslandBus } from './bus'
import type { PatchStore, ReadableStore } from './store'

/** Données du rendu que les sources fournissent (le reste vient de la coordination). */
export type IslandViewData = Pick<
  IslandProps,
  'call' | 'audioLevels' | 'sessions' | 'drop' | 'hotZone' | 'garden' | 'music' | 'musicLevels' | 'markers' | 'review'
>

export const EMPTY_VIEW_DATA: IslandViewData = {
  call: null,
  audioLevels: undefined,
  sessions: [],
  drop: null,
  hotZone: null,
  garden: undefined,
  music: null,
  musicLevels: undefined,
  markers: null,
  review: null,
}

/** Gestes de l'île qu'une source peut prendre en charge (les autres sont gérés par le contrôleur). */
export type IslandGestures = Pick<
  IslandProps,
  | 'onCallAccept'
  | 'onCallIgnore'
  | 'onProjectChange'
  | 'onStopRecording'
  | 'onAskDecision'
  | 'onAnswerSession'
  | 'onOpenSession'
  | 'onChoiceDecision'
> & {
  /** Facultatif pour <Island> (labo, tests), toujours fourni par le contrôleur. */
  onMusicCommand: NonNullable<IslandProps['onMusicCommand']>
  onMarkMoment: NonNullable<IslandProps['onMarkMoment']>
  onUndoMarker: NonNullable<IslandProps['onUndoMarker']>
  onReviewAction: NonNullable<IslandProps['onReviewAction']>
}

export type IslandGestureName = keyof IslandGestures

/** Connexion à Sordulo OS : session Supabase ET membre d'une organisation. */
export type IslandSessionStatus = 'loading' | 'signedOut' | 'signedIn'

export interface IslandSessionInfo {
  status: IslandSessionStatus
  userId: string | null
  memberId: string | null
  organizationId: string | null
}

export const SIGNED_OUT: IslandSessionInfo = { status: 'signedOut', userId: null, memberId: null, organizationId: null }

/** Ce que reçoit chaque source à son démarrage. */
export interface IslandSourceContext {
  /** Coordination : activités, notifications, overlays (API en tête de ../coordinator/coordinator.ts). */
  coordinator: IslandCoordinator
  /** Horloge (injectée en test) : utiliser ses minuteurs plutôt que window.setTimeout. */
  clock: IslandClock
  /**
   * Données du rendu : appel détecté, niveaux sonores, sessions Claude Code, fichier glissé, jardin, musique,
   * lecteur du vrai son de la musique (objet stable, posé une fois : jamais de patch par analyse).
   */
  view: PatchStore<IslandViewData>
  /** Connexion courante. */
  session: ReadableStore<IslandSessionInfo>
  /** Projets visibles, triés par nom (vide hors connexion). */
  projects: ReadableStore<readonly IslandProjectOption[]>
  /** Événements entre sources. */
  bus: IslandBus
  /**
   * Attend une connexion complète (relit d'abord la session partagée avec la fenêtre principale).
   * Vrai dès qu'elle est là, faux après `timeoutMs` (2,5 s par défaut).
   */
  waitForSignedIn: (timeoutMs?: number) => Promise<boolean>
  /** Appelle `callback` une fois, dès que la connexion est complète (tout de suite si elle l'est). Renvoie l'annulation. */
  whenSignedIn: (callback: () => void) => () => void
  /** Vrai après l'arrêt de la source (démontage de la fenêtre) : ignorer les réponses tardives. */
  isDisposed: () => boolean
}

/** Exécute une action de notification d'un type donné. */
export type IslandActionHandler<T extends NotificationAction['type']> = (
  action: Extract<NotificationAction, { type: T }>,
  notification: IslandNotification,
) => void | Promise<void>

export type IslandActionHandlers = { [T in NotificationAction['type']]?: IslandActionHandler<T> }

/** Ce que renvoie une source démarrée. */
export interface IslandSourceHandle {
  /** Arrête la source : désabonnements, minuteurs. */
  dispose?: () => void
  /**
   * Actions de notification que la source sait exécuter. Si aucune source ne prend un type, le contrôleur
   * applique son comportement par défaut (dismiss : rien, openMain : fenêtre principale, openUrl : navigateur,
   * showSessions : rien). Plusieurs sources peuvent prendre le même type : toutes sont appelées.
   */
  actions?: IslandActionHandlers
  /** Gestes de l'île pris en charge par la source (plusieurs sources : toutes sont appelées). */
  gestures?: Partial<IslandGestures>
}

/**
 * Une source branche une origine d'événements (Tauri, Supabase, relais Claude Code…) sur la coordination.
 * Aucun état au niveau du module : tout ce qui vit pendant la fenêtre est créé dans `start` (la page peut
 * démarrer, arrêter et redémarrer les sources, en mode strict de React notamment).
 */
export interface IslandSource {
  /** Nom court, pour les journaux (« appel », « envoi »…). */
  id: string
  start: (ctx: IslandSourceContext) => IslandSourceHandle
}
