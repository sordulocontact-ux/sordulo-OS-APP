/**
 * Props du rendu de l'île. Le rendu ne décide rien : il affiche l'instantané de la coordination et les données
 * fournies par le contrôleur, et remonte les gestes par des callbacks.
 */
import type { ReactNode } from 'react'
import type { CallService, IslandRect } from '../../../shared/desktop-contract'
import type {
  Activity,
  ActivityKind,
  ClaudeSession,
  IslandNotification,
  IslandPlatform,
  IslandSnapshot,
  PermissionAsk,
  PermissionDecision,
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
  /** Projet de destination, affiché sous la zone « Fichiers ». */
  projectName: string | null
  /**
   * Zones affichées : transcribe seulement pour l'audio, analyse seulement pour un document, claude seulement si une session est active,
   * files masquée tant que les fichiers de projet n'existent pas. Chaque zone porte `data-zone`.
   */
  zones: Readonly<Record<IslandDropZone, boolean>>
}

export interface IslandProps {
  /** Instantané de la coordination : état, activités, notification, demande d'autorisation. */
  snapshot: IslandSnapshot
  /** Variante de forme ; 'win' par défaut (ACTIVE_PLATFORM). */
  platform?: IslandPlatform
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
  /** Jardin des Claude (autre lot), affiché dans `multi` au repos. Sans jardin : compte + pastilles. */
  garden?: ReactNode
  /** Force la réduction des animations (labo) ; par défaut : prefers-reduced-motion. */
  reducedMotion?: boolean
  /** Survol DOM de la forme (utile hors Tauri, dans le labo). */
  onHoverChange?: (hover: boolean) => void
  /** Clic sur la bulle : l'activité secondaire à épingler. */
  onBubbleClick: (activity: Activity) => void
  /** Bouton de la notification. */
  onNotificationAction: (notification: IslandNotification) => void
  /** Échap pendant une notification. */
  onNotificationDismiss: (notification: IslandNotification) => void
  /** Plus tard / Refuser / Autoriser. */
  onAskDecision: (decision: PermissionDecision, ask: PermissionAsk) => void
  /** « Transcrire » avec le projet choisi. */
  onCallAccept: (projectId: string | null) => void
  /** « Ignorer » (ou Échap) sur l'appel détecté. */
  onCallIgnore: () => void
  /** Changement de projet dans la liste de l'appel détecté. */
  onProjectChange: (projectId: string) => void
  /** « Arrêter » au survol de l'enregistrement. */
  onStopRecording: () => void
  /** « Répondre » sur une session en attente dans multiOpen. */
  onAnswerSession: (sessionId: string) => void
  /** Clic sur une session (agentOpen, multiOpen) : sa fenêtre VS Code. */
  onOpenSession: (sessionId: string) => void
  /**
   * Zones cliquables (forme + bulle), au plus toutes les ~50 ms pendant une animation et une dernière fois
   * au repos. Union de la taille courante et de la cible pendant une transition.
   */
  onHitRectsChange: (rects: IslandHitRect[]) => void
}
