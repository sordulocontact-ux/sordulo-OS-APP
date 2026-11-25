/**
 * Props du rendu de l'île. Le rendu ne décide rien : il affiche l'instantané de la coordination et les données
 * fournies par le contrôleur, et remonte les gestes par des callbacks.
 */
import type { ReactNode } from 'react'
import type { CallService, IslandDragStart, IslandMotion, IslandRect } from '../../../shared/desktop-contract'
import type {
  Activity,
  ActivityKind,
  ChoiceDecision,
  IslandChoice,
  ClaudeSession,
  IslandEdge,
  IslandNotification,
  IslandMusic,
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
}

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
   * image : la goutte s'étire et tremble. null : immobile ou rien de récent. Absent : goutte immobile.
   */
  dragMotion?: DragMotionReader
  /** La souris est sur l'île (source : desktop://island-pointer côté Tauri, ou survol DOM dans le labo). */
  hover: boolean
  /** Données de l'état `appel` ; null hors de cet état. */
  call: IslandCallPrompt | null
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
  /** Bouton de la notification. */
  onNotificationAction: (notification: IslandNotification) => void
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
