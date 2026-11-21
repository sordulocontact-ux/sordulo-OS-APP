/**
 * Contrat partagé de l'île (src/features/island) : états, activités, notifications, sessions Claude Code.
 * Source de vérité visuelle : design/prototypes/ile-sordulo-os.html (objets S, SH, NOTIFS, PROGS, RANK, INTERRUPT).
 * Ce fichier n'importe ni React ni Tauri : il est utilisé par la coordination (coordinator/), le rendu (view/),
 * le contrôleur Tauri (controller/), le labo (lab/) et le jardin (garden/).
 */

import type { CallService, ClaudeQuestion, MusicCommand } from '../../shared/desktop-contract'

export type { MusicCommand }

/** Variante de forme : Windows (bord haut de l'écran) ou Mac (autour de l'encoche de la caméra). */
export type IslandPlatform = 'win' | 'mac'

/** État affiché dans l'île (prototype : variable `state`). */
export type IslandState =
  | 'repos'
  | 'appel'
  | 'meet'
  | 'music'
  | 'progress'
  | 'notif'
  | 'agent'
  | 'agentAsk'
  | 'multi'
  | 'dragWake'
  | 'dragOver'

/** États qui passent par-dessus l'activité principale (prototype : `isOverlay`). */
export type IslandOverlay = 'appel' | 'notif' | 'agentAsk' | 'dragWake' | 'dragOver'

/**
 * Clé de taille (prototype : objet `S`) : l'état, plus le survol et les variantes pendant un appel.
 * `meetOpen` n'existe pas dans le prototype : survol de l'enregistrement (mêmes dimensions que `agentOpen`).
 */
export type IslandSizeKey =
  | 'repos'
  | 'peek'
  | 'appel'
  | 'meet'
  | 'meetOpen'
  | 'music'
  | 'progress'
  | 'agent'
  | 'agentOpen'
  | 'agentAsk'
  | 'agentAskCall'
  | 'multi'
  | 'multiOpen'
  | 'musicOpen'
  | 'dragWake'
  | 'dragOver'
  | 'notif'
  | 'notifCall'

// ---------------------------------------------------------------------------
// Activités : une principale dans l'île, la suivante dans la bulle à droite
// ---------------------------------------------------------------------------

/** Ordre (prototype : RANK) : appel 1, progression 2, Claude 3, musique 4. */
export type ActivityKind = 'meet' | 'progress' | 'agent' | 'multi' | 'music'

/** Étapes de progression (prototype : PROGS). `file` et `deploy` sont prévues, pas branchées. */
export type ProgressStage = 'upload' | 'analyse' | 'file' | 'deploy'

export interface MeetActivity {
  kind: 'meet'
  /** Nom de l'app d'appel détectée (« Discord », « Google Meet »…). */
  appName: string
  /** Service reconnu (logo et couleur de l'appel) ; null : inconnu, icône et couleur génériques. */
  service: CallService | null
  projectId: string | null
  projectName: string | null
  /** Début de l'enregistrement, epoch ms (le minuteur part de là). */
  startedAt: number
}

export interface ProgressActivity {
  kind: 'progress'
  stage: ProgressStage
  /** Libellé affiché (« Import de l'audio », « Analyse de l'appel »). */
  label: string
  /** Avancement réel 0..1 quand il est connu ; null : anneau estimé à partir de `startedAt` et `estimatedMs`. */
  fraction: number | null
  /** epoch ms */
  startedAt: number
  /** Durée estimée de l'étape (ms), pour l'anneau quand `fraction` est null. */
  estimatedMs: number
  /** Entrée Sordulo OS concernée, si connue. */
  inputId?: string | null
}

export interface AgentActivity {
  kind: 'agent'
  /** Session Claude Code affichée (voir ClaudeSession.id). */
  sessionId: string
}

export interface MultiActivity {
  kind: 'multi'
}

/** Musique en lecture (ou en pause depuis peu) : les données affichées sont dans IslandMusic (view.music). */
export interface MusicActivity {
  kind: 'music'
}

/** Couleurs tirées de la pochette (couleurs CSS `rgb(…)`) : dégradé des barres et de la pochette de repli. */
export interface MusicPalette {
  start: string
  end: string
}

/** Lecture en cours affichée par l'île (source « musique » du contrôleur, d'après MusicState). */
export interface IslandMusic {
  title: string
  artist: string | null
  album: string | null
  /** Nom du lecteur (« Spotify »). */
  appName: string
  playing: boolean
  positionMs: number | null
  durationMs: number | null
  /** Epoch ms de positionMs ; en lecture, la position avance à partir de là. */
  positionAt: number
  /** URL (blob:) de la pochette ; null : pas de pochette (dégradé de repli). */
  artworkUrl: string | null
  /** Couleurs de la pochette ; null : tokens --island-music* par défaut. */
  palette: MusicPalette | null
}

export type ActivityPayload = MeetActivity | ProgressActivity | AgentActivity | MultiActivity | MusicActivity

/** Une activité en cours. `id` est stable (ex. « meet », « prog:upload », « agent », « multi »). */
export type Activity = ActivityPayload & {
  id: string
  /** Ordre d'arrivée, croissant (à rang égal, la plus récente passe devant). */
  order: number
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Catalogue (prototype : NOTIFS). Branchées : tickets, analysisError, uploadError, pendingUpload, loginRequired, callEnded,
 * recording, recordError,
 * assign, claudeDone, claudeStop, multiDone, conflict, pathCopied, digest.
 * Prévues, non branchées (modules à venir) : devis, paiement, echeance, rappel, deployed, relecture, fileAdded, conflictOk.
 */
export type NotificationKind =
  | 'tickets'
  | 'analysisError'
  | 'uploadError'
  | 'pendingUpload'
  | 'loginRequired'
  /** Le micro est redevenu inactif pendant l'enregistrement : « L'appel semble terminé », bouton Arrêter. */
  | 'callEnded'
  /** « Enregistrer un appel » demandé alors qu'un enregistrement tourne déjà : bouton Arrêter. */
  | 'recording'
  /** L'enregistrement n'a pas pu démarrer ou s'arrêter (erreur Rust), sans bouton. */
  | 'recordError'
  | 'assign'
  | 'claudeDone'
  | 'claudeStop'
  | 'multiDone'
  | 'conflict'
  | 'pathCopied'
  | 'digest'
  | 'devis'
  | 'paiement'
  | 'echeance'
  | 'rappel'
  | 'deployed'
  | 'relecture'
  | 'fileAdded'
  | 'conflictOk'

/** Icônes de l'île (prototype : objet I, tracés 24 × 24 en trait). */
export type IslandIconName =
  | 'check'
  | 'euro'
  | 'clock'
  | 'cal'
  | 'tickets'
  | 'agent'
  | 'upload'
  | 'sun'
  | 'cloud'
  | 'bell'
  | 'alert'
  | 'folder'

/** Couleur d'accent d'une notification ou d'une progression ; chaque valeur correspond à un token `--island-*`. */
export type IslandTone = 'neutral' | 'success' | 'alert' | 'danger' | 'info' | 'claude' | 'analysis' | 'call'

export type NotificationVisual =
  | { type: 'icon'; icon: IslandIconName }
  | { type: 'avatar'; initials: string }
  | { type: 'claude' }

/** Ce que fait le bouton de la notification. Le contrôleur exécute l'action, la coordination ne fait que la porter. */
export type NotificationAction =
  | { type: 'dismiss' }
  /** Montre la fenêtre principale sur cette route (ex. écran de validation). */
  | { type: 'openMain'; route: string }
  /** Arrête l'enregistrement en cours puis l'envoie. */
  | { type: 'stopRecording' }
  /** Relance l'envoi de l'enregistrement en attente. */
  | { type: 'retryUpload' }
  /** Relance l'analyse d'une entrée en erreur. */
  | { type: 'retryAnalysis'; inputId: string }
  /** Ouvre l'île sur la liste des sessions Claude Code. */
  | { type: 'showSessions' }
  /** Met au premier plan la fenêtre VS Code (ou l'app) de cette session Claude Code. */
  | { type: 'openSession'; sessionId: string }
  /** Prévu (rappel de call) : rejoindre l'appel. */
  | { type: 'openUrl'; url: string }

export interface IslandNotification {
  /** Unique par notification émise. */
  id: string
  kind: NotificationKind
  visual: NotificationVisual
  tone: IslandTone
  title: string
  subtitle: string
  /** Libellé du bouton ; null : pas de bouton. */
  button: string | null
  action: NotificationAction
  /** Durée d'affichage (ms) : 4 500 par défaut, 7 000 pour les rappels et les tickets à valider. */
  durationMs: number
  /** Passe devant tout le reste (prototype : INTERRUPT). Vrai pour `rappel`. */
  interrupt: boolean
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

/** `background` : tour fini mais Claude patiente (shell ou sous-agent lancé en arrière-plan). */
export type ClaudeSessionStatus = 'working' | 'waiting' | 'background' | 'done' | 'idle' | 'sleep'

export interface ClaudeSession {
  /** session_id de Claude Code. */
  id: string
  /** Nom du projet : projet Sordulo OS si un nom correspond au dossier, sinon nom du dossier. */
  projectName: string
  projectId: string | null
  cwd: string
  branch: string | null
  /** Ce que la session fait (début du premier prompt), affiché dans `multi`. */
  task: string | null
  /** Étape en cours tirée du dernier outil (« Lit CLAUDE.md », « Modifie src/… », « Lance npm run typecheck »). */
  step: string | null
  status: ClaudeSessionStatus
  /** epoch ms */
  startedAt: number
  /** Modifie un fichier modifié aussi par une autre session. */
  conflict: boolean
  /** Bloquée (outil en erreur, commande refusée). */
  error: boolean
  /** Sous-agents en cours (jardin). */
  subagents: number
}

/** Demande d'autorisation (hook PermissionRequest) en attente d'une réponse dans l'île. */
export interface PermissionAsk {
  /** requestId du relais, à renvoyer avec la décision. */
  id: string
  sessionId: string
  toolName: string
  /** Ce qui est demandé, affiché dans le bloc de code (« npm run build », « src/app/App.tsx »). */
  summary: string
  /** Sous-titre (« Lancer une commande dans PDS OS »). */
  title: string
  /** epoch ms */
  receivedAt: number
  /** epoch ms : au-delà, le relais a rendu la main au terminal (60 s). */
  expiresAt: number
  /** Questions à choix de Claude (outil AskUserQuestion) : on choisit dans l'île au lieu d'autoriser. */
  questions: readonly ClaudeQuestion[] | null
}

/** Réponses aux questions à choix : texte de la question → choix (plusieurs : « A, B »). */
export type QuestionAnswers = Record<string, string>

export type PermissionDecision = 'allow' | 'deny' | 'later'

// ---------------------------------------------------------------------------
// Instantané de la coordination, lu par le rendu
// ---------------------------------------------------------------------------

export interface IslandSnapshot {
  /** État à afficher. */
  state: IslandState
  /** Activité principale (dans l'île) ; null au repos. */
  primary: Activity | null
  /** Activité secondaire (dans la bulle à droite) ; null : pas de bulle. Toujours null pendant un appel, un import ou une analyse. */
  secondary: Activity | null
  /** Pendant un appel, un import ou une analyse : les autres activités, dans l'ordre (sous l'appel au survol). Vide sinon. */
  background: readonly Activity[]
  /** Nombre total d'activités ; badge « +N » de la bulle = activityCount - 2 quand > 2. */
  activityCount: number
  /** Activité épinglée par un clic sur la bulle. */
  pinnedId: string | null
  /** Notification affichée (state === 'notif'). */
  notification: IslandNotification | null
  /** Une notification ou une demande s'affiche pendant un appel : ligne d'appel au-dessus (tailles notifCall, agentAskCall). */
  withCall: boolean
  /** Demande d'autorisation affichée (state === 'agentAsk'). */
  ask: PermissionAsk | null
  /** « 1 sur N » quand d'autres interruptions attendent derrière la demande affichée. */
  askPosition: { index: number; total: number } | null
  /** Mode concentration : les notifications attendent la fin de l'appel. */
  focusMode: boolean
}
