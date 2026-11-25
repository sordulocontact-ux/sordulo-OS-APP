/**
 * Props du rendu de l'île. Le rendu ne décide rien : il affiche l'instantané de la coordination et les données
 * fournies par le contrôleur, et remonte les gestes par des callbacks.
 */
import type { ReactNode } from 'react'
import type { CallService, IslandDragStart, IslandMotion, IslandRect } from '../../../shared/desktop-contract'
import type { TicketType } from '../../../shared/types'
import type {
  Activity,
  ActivityKind,
  ChoiceDecision,
  IslandChoice,
  ClaudeSession,
  IslandEdge,
  IslandNotification,
  IslandMusic,
  NotificationAction,
  MusicLevelsReader,
  IslandPlatform,
  IslandSnapshot,
  MusicCommand,
  PermissionAsk,
  PermissionDecision,
  QuestionAnswers,
} from '../types'

/** Activité d'un genre donné, avec son id et son ordre. */
export type ActivityOfKind<K extends ActivityKind> = Extract<Activity, { kind: K }>

/** Rectangle cliquable, px CSS relatifs à la racine du composant (la fenêtre transparente). */
export type IslandHitRect = IslandRect

export interface IslandProjectOption {
  id: string
  name: string
}

/** Données de l'état `appel` (« Appel détecté dans <app> »). */
export interface IslandCallPrompt {
  /** Nom de l'app d'appel détectée. */
  appName: string
  /** Service reconnu (logo et couleur) ; null : inconnu, icône et couleur génériques. */
  service: CallService | null
  /** Projets proposés dans la liste. */
  projects: readonly IslandProjectOption[]
  /** Projet choisi ; null : aucun. */
  selectedProjectId: string | null
  /**
   * Pourquoi ce projet est présélectionné, affiché sous la liste (« D'après l'agenda : Point Ibé ») ; absent ou
   * null : rien (dernier projet utilisé).
   */
  reason?: string | null
}

/** Moments marqués pendant l'enregistrement (état `meet`). */
export interface IslandMarkers {
  /** Repères posés depuis le début de l'appel. */
  count: number
  /** Heure (epoch ms) du dernier repère ajouté : petite étoile brève dans l'île ; null : aucun. */
  lastAddedAt: number | null
  /** Jusqu'à quand (epoch ms) « Annuler » retire le dernier repère ; null : pas d'annulation possible. */
  undoUntil: number | null
}

/** Ticket proposé, tel que l'île le montre dans l'état `review`. */
export interface IslandReviewTicket {
  id: string
  type: TicketType
  title: string
  /** Description complète : la vue la raccourcit. */
  description: string
  /** Extrait de la réunion ou du retour (source_quote) ; null : aucun. */
  quote: string | null
  /** Personne attribuée (tâches du ticket) ; null : non attribué. */
  assignee: { name: string; initials: string } | null
  /** Vient d'un moment marqué pendant l'appel : étoile. */
  fromMarker: boolean
}

/** Données de l'état `review` (validation des tickets dans l'île). */
export interface IslandReview {
  inputTitle: string
  projectName: string
  /** Tickets encore proposés, dans l'ordre de l'écran de validation. Vide et `loading` faux : tout est traité. */
  tickets: readonly IslandReviewTicket[]
  /** Ticket affiché (« 2 sur 5 » = index 1 sur 5 tickets). */
  index: number
  loading: boolean
  /** Un enregistrement est en cours (boutons désactivés). */
  busy: boolean
  /** Erreur du dernier enregistrement, en français ; null : aucune. */
  error: string | null
  /** Dernier refus, annulable quelques secondes (« Annuler ») ; null : rien à annuler. */
  undo: { ticketTitle: string } | null
}

/** Geste de l'état `review` (boutons et clavier : flèches, Entrée, Retour arrière, Échap). */
export type IslandReviewAction =
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'validate' }
  | { type: 'reject' }
  | { type: 'validateAll' }
  /** « Modifier dans l'app » : écran de validation sur ce ticket. */
  | { type: 'openInApp' }
  /** « Annuler » le dernier refus. */
  | { type: 'undo' }
  | { type: 'close' }

export type IslandDropZone = 'transcribe' | 'analyse' | 'files' | 'claude'

/** Données des états `dragWake` / `dragOver`. */
export interface IslandDropInfo {
  /** Nom du fichier glissé (ou « Fichier audio », « Document » tant qu'il n'est pas connu). */
  fileName: string
  /** Projet de destination, affiché sous les zones « Transcrire » et « Analyser » (le dernier utilisé). */
  projectName: string | null
  /**
   * Zones affichées : transcribe seulement pour l'audio, analyse seulement pour un document, claude seulement si une session est active,
   * files (« Ranger », l'IA trouve le projet) pour tout fichier quand la connexion n'est pas absente. Chaque zone porte `data-zone`.
   */
  zones: Readonly<Record<IslandDropZone, boolean>>
}

/** Lecture de la vitesse du glisser à un instant (performance.now(), ms). */
export type DragMotionReader = (nowMs: number) => IslandMotion | null

export interface IslandProps {
  /** Instantané de la coordination : état, activités, notification, demande d'autorisation. */
  snapshot: IslandSnapshot
  /**
   * Variante de forme ; 'win' par défaut (ACTIVE_PLATFORM). 'mac' (autour de l'encoche) ne vaut qu'avec
   * `edge` 'top' : sur les autres bords, l'île prend les tailles et positions 'win', même si la prop vaut 'mac'.
   */
  platform?: IslandPlatform
  /**
   * Bord de l'écran où l'île est collée, au milieu ; 'top' par défaut. En bas : forme miroir. À gauche et à
   * droite : pilule verticale pour les états compacts, carte horizontale collée au bord pour les états ouverts.
   * La fenêtre (racine) a la taille du bord (ISLAND_WINDOW_SIZE), réglée par l'app de bureau.
   */
  edge?: IslandEdge
  /**
   * Glisser de l'île en cours (piloté par l'app de bureau) : l'île reste fermée, aucun état ouvert au survol
   * ni au focus. Faux par défaut.
   */
  dragging?: boolean
  /**
   * Début d'un glisser : appui du bouton gauche sur la forme puis déplacement de plus de DRAG_THRESHOLD_PX
   * (geometry.ts), bouton toujours enfoncé. Appelé une fois par appui, avec la taille de la boîte cible
   * actuelle dans le repère du bord (en haut / en bas : along = largeur, depth = hauteur ; à gauche / à
   * droite : along = hauteur, depth = largeur ; zone de contenu, sans les arrondis concaves). Le clic qui suit
   * ce glisser est annulé ; un appui sans déplacement reste un clic normal. Absent : pas de glisser.
   */
  onDragStart?: (size: IslandDragStart) => void
  /**
   * Vitesse de la fenêtre pendant un glisser et son lancer (px CSS / s, desktop://island-motion), lue à chaque
   * image : la flaque traîne et ondule. null : immobile ou rien de récent. Absent : flaque immobile.
   */
  dragMotion?: DragMotionReader
  /** La souris est sur l'île (source : desktop://island-pointer côté Tauri, ou survol DOM dans le labo). */
  hover: boolean
  /** Données de l'état `appel` ; null hors de cet état. */
  call: IslandCallPrompt | null
  /** Moments marqués de l'enregistrement en cours ; null ou absent : aucun enregistrement, pas de bouton « Marquer ». */
  markers?: IslandMarkers | null
  /** Données de l'état `review` ; null ou absent hors de cet état. */
  review?: IslandReview | null
  /** Niveaux sonores récents 0..1 (le plus récent en dernier) ; absent : onde simulée comme le prototype. */
  audioLevels?: readonly number[]
  /** Sessions Claude Code connues (étape, tâche, statut). */
  sessions: readonly ClaudeSession[]
  /** Fichier glissé ; null hors du glisser-déposer. */
  drop: IslandDropInfo | null
  /** Zone de dépôt survolée. */
  hotZone: IslandDropZone | null
  /** Lecture en cours (états `music` / `musicOpen`, bulle) ; null ou absent : pochette et couleurs par défaut. */
  music?: IslandMusic | null
  /** Vrai son de la musique (Windows) pour l'égaliseur et le hochement des Claude ; absent : simulés. */
  musicLevels?: MusicLevelsReader
  /** Jardin des Claude (autre lot), affiché dans `multi` au repos. Sans jardin : compte + pastilles. */
  garden?: ReactNode
  /** Force la réduction des animations (labo) ; par défaut : prefers-reduced-motion. */
  reducedMotion?: boolean
  /** Survol DOM de la forme (utile hors Tauri, dans le labo). */
  onHoverChange?: (hover: boolean) => void
  /**
   * Afficher une activité dans l'île (l'épingler) : clic sur la bulle (l'activité secondaire) ou sur une ligne
   * « aussi en cours » Musique ou progression (cette activité).
   */
  onBubbleClick: (activity: Activity) => void
  /** Bouton de la notification ; `action` : celle du deuxième bouton (`secondary`), sinon `notification.action`. */
  onNotificationAction: (notification: IslandNotification, action?: NotificationAction) => void
  /** Échap pendant une notification. */
  onNotificationDismiss: (notification: IslandNotification) => void
  /** Plus tard / Refuser / Autoriser. */
  /** `answers` : choix faits dans l'île pour une question de Claude (AskUserQuestion), avec « allow ». */
  onAskDecision: (decision: PermissionDecision, ask: PermissionAsk, answers?: QuestionAnswers) => void
  /** « Transcrire » avec le projet choisi. */
  onCallAccept: (projectId: string | null) => void
  /** « Ignorer » (ou Échap) sur l'appel détecté. */
  onCallIgnore: () => void
  /**
   * Décision dans l'île (état `choice`, snapshot.choice) : bouton principal, secondaire, ou Échap (`dismiss`).
   * `always` : case « Toujours » cochée (faux sans case).
   */
  onChoiceDecision: (decision: ChoiceDecision, choice: IslandChoice, always: boolean) => void
  /** Changement de projet dans la liste de l'appel détecté. */
  onProjectChange: (projectId: string) => void
  /** « Arrêter » au survol de l'enregistrement. */
  onStopRecording: () => void
  /** « Marquer » dans la vue ouverte de l'enregistrement : repère au temps écoulé. */
  onMarkMoment?: () => void
  /** « Annuler » juste après un repère : retire le dernier. */
  onUndoMarker?: () => void
  /** Boutons et clavier de l'état `review`. */
  onReviewAction?: (action: IslandReviewAction) => void
  /** « Répondre » sur une session en attente (multiOpen, agentOpen, ligne « aussi en cours »). */
  onAnswerSession: (sessionId: string) => void
  /** Clic sur une session (agentOpen, multiOpen, ligne « aussi en cours ») : sa fenêtre VS Code. */
  onOpenSession: (sessionId: string) => void
  /**
   * musicOpen : précédent, lecture / pause, suivant, ou clic sur la pochette (`open`, lecteur au premier plan) ;
   * `open` aussi pour la ligne Musique sous un appel (l'île ne peut pas quitter l'appel).
   */
  onMusicCommand?: (command: MusicCommand) => void
  /**
   * Zones cliquables (forme + bulle), au plus toutes les ~50 ms pendant une animation et une dernière fois
   * au repos. Union de la taille courante et de la cible pendant une transition.
   */
  onHitRectsChange: (rects: IslandHitRect[]) => void
}
