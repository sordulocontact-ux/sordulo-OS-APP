/**
 * Données simulées du labo : projets, sessions Claude Code, demandes d'autorisation, une notification d'exemple
 * par sorte du catalogue. Textes repris du prototype (design/prototypes/ile-sordulo-os.html).
 */
import { createNotification } from '../catalog'
import type { IslandDropInfo, IslandProjectOption } from '../view'
import type { ClaudeSession, IslandNotification, NotificationKind, PermissionAsk } from '../types'

export const LAB_PROJECTS: readonly IslandProjectOption[] = [
  { id: 'p-pds', name: 'PDS OS' },
  { id: 'p-airbnb', name: 'Airbnb des studios' },
  { id: 'p-site', name: 'Site Sordulo' },
]

export const LAB_CALL_APP = 'Google Meet'

const SESSION_BASE: ReadonlyArray<Pick<ClaudeSession, 'projectName' | 'task' | 'step'>> = [
  { projectName: 'PDS OS', task: 'Écran de validation', step: 'Modifie src/features/desktop/Island.tsx' },
  { projectName: 'PDS OS', task: 'Kanban glisser-déposer', step: 'Lit CLAUDE.md' },
  { projectName: 'Airbnb des studios', task: 'Page d’accueil', step: 'Cherche les tokens dans src/styles/tokens.css' },
  { projectName: 'Site Sordulo', task: 'Formulaire de contact', step: 'Modifie src/features/desktop/Island.module.css' },
  { projectName: 'Sordulo OS', task: 'Hooks Claude Code', step: 'Lance npm run typecheck' },
]

export const MAX_LAB_SESSIONS = SESSION_BASE.length

/** `count` sessions simulées (1 à 5). `waiting` : la troisième (ou la dernière) attend une autorisation. */
export function makeSessions(count: number, now: number, waiting = false): ClaudeSession[] {
  const list = SESSION_BASE.slice(0, Math.max(1, Math.min(MAX_LAB_SESSIONS, count))).map(
    (base, i): ClaudeSession => ({
      id: `lab-session-${i + 1}`,
      projectName: base.projectName,
      projectId: null,
      cwd: `C:/Projets/${base.projectName}`,
      branch: 'main',
      task: base.task,
      step: base.step,
      status: 'working',
      startedAt: now - (i * 97 + 40) * 1000,
      conflict: false,
      error: false,
      subagents: 0,
    }),
  )
  if (waiting && list.length > 1) {
    const target = list[Math.min(2, list.length - 1)]
    if (target) target.status = 'waiting'
  }
  return list
}

let askSequence = 0

export function makeAsk(sessionId: string, now: number): PermissionAsk {
  askSequence += 1
  return {
    id: `lab-ask-${askSequence}`,
    sessionId,
    toolName: 'Bash',
    summary: 'npm run build',
    title: 'Lancer une commande dans PDS OS',
    receivedAt: now,
    expiresAt: now + 60_000,
  }
}

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  tickets: 'Tickets à valider',
  analysisError: 'Erreur d’analyse',
  uploadError: 'Erreur d’envoi',
  pendingUpload: 'Envoi en attente',
  loginRequired: 'Connexion requise',
  callEnded: 'Appel terminé ?',
  recording: 'Enregistrement en cours',
  recordError: "Erreur d'enregistrement",
  assign: 'Tâche assignée',
  claudeDone: 'Claude a terminé',
  claudeStop: 'Claude attend tes consignes',
  multiDone: 'Une session a terminé',
  conflict: 'Conflit entre sessions',
  pathCopied: 'Chemin copié',
  digest: 'Regroupement',
  devis: 'Devis signé',
  paiement: 'Paiement reçu',
  echeance: 'Échéance',
  rappel: 'Rappel de call (interruption)',
  deployed: 'Déploiement en ligne',
  relecture: 'À relire',
  fileAdded: 'Fichier ajouté',
  conflictOk: 'Conflit résolu',
}

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_LABELS) as NotificationKind[]

const CLAUDE = { projectName: 'PDS OS', detail: '4 fichiers modifiés' }

/** Une notification d'exemple par sorte du catalogue. */
export function sampleNotification(kind: NotificationKind): IslandNotification {
  switch (kind) {
    case 'tickets':
      return createNotification('tickets', { count: 6, inputTitle: 'Call Ibé', projectName: 'PDS OS', route: '/review' })
    case 'analysisError':
      return createNotification('analysisError', { message: 'Le modèle n’a pas répondu', inputId: 'input-1' })
    case 'uploadError':
      return createNotification('uploadError', { message: 'Connexion perdue' })
    case 'pendingUpload':
      return createNotification('pendingUpload', { detail: 'Call Ibé, 42 min' })
    case 'loginRequired':
      return createNotification('loginRequired', { appName: LAB_CALL_APP })
    case 'callEnded':
      return createNotification('callEnded', { appName: LAB_CALL_APP, projectName: 'PDS OS' })
    case 'recording':
      return createNotification('recording', { appName: LAB_CALL_APP, projectName: 'PDS OS' })
    case 'recordError':
      return createNotification('recordError', { phase: 'start', message: 'Aucun micro détecté' })
    case 'assign':
      return createNotification('assign', {
        assignerName: 'Maël',
        assignerInitials: 'MA',
        taskTitle: 'Refaire l’écran de validation',
        route: '/tasks',
      })
    case 'claudeDone':
      return createNotification('claudeDone', CLAUDE)
    case 'claudeStop':
      return createNotification('claudeStop', { projectName: 'PDS OS', detail: 'Commande refusée : npm run build' })
    case 'multiDone':
      return createNotification('multiDone', { projectName: 'Sordulo OS', detail: 'Hooks Claude Code' })
    case 'conflict':
      return createNotification('conflict', { projectName: 'PDS OS', detail: 'Island.tsx modifié par les sessions 1 et 2' })
    case 'pathCopied':
      return createNotification('pathCopied', { fileName: 'cahier-des-charges.pdf' })
    case 'digest':
      return createNotification('digest', { title: '3 nouveautés', subtitle: 'Paiement reçu, Tâche assignée et 1 autre' })
    case 'devis':
      return createNotification('devis', { clientName: 'Ibé', projectName: 'Airbnb des studios', amountEur: 4200, route: '/p' })
    case 'paiement':
      return createNotification('paiement', {
        clientName: 'Ibé',
        invoiceTitle: 'Airbnb des studios',
        amountEur: 1200,
        route: '/p',
      })
    case 'echeance':
      return createNotification('echeance', { projectName: 'PDS OS', when: 'demain', remainingTasks: 3, route: '/p' })
    case 'rappel':
      return createNotification('rappel', {
        meetingTitle: 'Call Ibé',
        minutes: 5,
        appName: 'Google Meet',
        projectName: 'PDS OS',
        url: 'https://meet.example/ibe',
      })
    case 'deployed':
      return createNotification('deployed', { projectName: 'PDS OS', url: 'https://pds.example' })
    case 'relecture':
      return createNotification('relecture', {
        authorInitials: 'MA',
        taskTitle: 'Partage du ticket depuis l’iPhone',
        route: '/t',
      })
    case 'fileAdded':
      return createNotification('fileAdded', { projectName: 'PDS OS', fileName: 'maquette.fig', route: '/p' })
    case 'conflictOk':
      return createNotification('conflictOk', { projectName: 'PDS OS', detail: 'La session 2 attend que la 1 ait fini' })
  }
}

export type DropFile = 'audio' | 'document'

export interface DropOptions {
  /** Zone « Fichiers » (masquée dans l'app tant que les fichiers de projet n'existent pas). */
  files: boolean
  /** Zone « Claude Code » (seulement si une session est active). */
  claude: boolean
}

export function makeDrop(file: DropFile, options: DropOptions): IslandDropInfo {
  return {
    fileName: file === 'audio' ? 'Appel Ibé.m4a' : 'Cahier des charges.pdf',
    projectName: 'PDS OS',
    zones: { transcribe: file === 'audio', analyse: file === 'document', files: options.files, claude: options.claude },
  }
}
