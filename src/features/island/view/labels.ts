/**
 * Textes calculés de l'île : annonce de l'état (prototype : label), résumé des sessions, minuteurs.
 */
import { MEET_BACKGROUND } from '../geometry'
import type { Activity, ClaudeSession, IslandSnapshot } from '../types'

/** mm:ss d'une durée en ms (prototype : mmss). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Résumé des sessions (« 3 en cours, 1 à autoriser, 1 terminée »), prototype : renderSessions. */
export function sessionsSummary(sessions: readonly ClaudeSession[]): string {
  let working = 0
  let waiting = 0
  let idle = 0
  let done = 0
  for (const s of sessions) {
    if (s.status === 'working') working++
    else if (s.status === 'waiting') waiting++
    else if (s.status === 'idle') idle++
    else if (s.status === 'done') done++
  }
  const parts: string[] = []
  if (working) parts.push(`${working} en cours`)
  if (waiting) parts.push(`${waiting} à autoriser`)
  if (idle) parts.push(`${idle} en pause`)
  if (done) parts.push(`${done} ${done > 1 ? 'terminées' : 'terminée'}`)
  return parts.join(', ')
}

/** Titre de multi : « 5 sessions Claude Code ». */
export function sessionsTitle(count: number): string {
  return `${count} ${count > 1 ? 'sessions' : 'session'} Claude Code`
}

/** Ligne « aussi en cours » sous l'appel (meetOpen). */
export interface BackgroundRow {
  id: string
  title: string
  detail: string
  status: string
  /** Couleur du statut : neutre, terminé, conflit, bloquée ou en attente de réponse. */
  tone: 'muted' | 'done' | 'conflict' | 'error' | 'waiting'
}

function sessionStatus(session: ClaudeSession): Pick<BackgroundRow, 'status' | 'tone'> {
  if (session.status === 'working' && session.conflict) return { status: 'Conflit', tone: 'conflict' }
  if (session.status === 'working' && session.error) return { status: 'Bloquée', tone: 'error' }
  if (session.status === 'working') return { status: 'En cours', tone: 'muted' }
  if (session.status === 'waiting') return { status: 'Attend ta réponse', tone: 'waiting' }
  if (session.status === 'done') return { status: 'Terminé', tone: 'done' }
  if (session.status === 'idle') return { status: 'En pause', tone: 'muted' }
  return { status: 'Inactive', tone: 'muted' }
}

/**
 * Lignes « aussi en cours » sous l'appel : une par progression, une par session Claude (agent : sa session,
 * multi : toutes), dans l'ordre des activités. Au-delà de MEET_BACKGROUND.maxRows, la dernière ligne
 * devient « N autres activités ».
 */
export function backgroundRows(background: readonly Activity[], sessions: readonly ClaudeSession[]): BackgroundRow[] {
  const rows: BackgroundRow[] = []
  const seen = new Set<string>()
  const addSession = (session: ClaudeSession | undefined) => {
    if (!session || seen.has(session.id)) return
    seen.add(session.id)
    rows.push({
      id: `claude:${session.id}`,
      title: session.projectName,
      detail: session.step ?? session.task ?? '',
      ...sessionStatus(session),
    })
  }
  for (const activity of background) {
    switch (activity.kind) {
      case 'progress':
        rows.push({
          id: activity.id,
          title: activity.label,
          detail: '',
          status: activity.fraction === null ? 'En cours' : `${Math.round(activity.fraction * 100)} %`,
          tone: 'muted',
        })
        break
      case 'agent':
        addSession(sessions.find((s) => s.id === activity.sessionId) ?? sessions[0])
        break
      case 'multi':
        sessions.forEach(addSession)
        break
      case 'music':
        rows.push({ id: activity.id, title: 'Musique', detail: '', status: '', tone: 'muted' })
        break
      case 'meet':
        break
    }
  }
  const max = MEET_BACKGROUND.maxRows
  if (rows.length <= max) return rows
  const rest = rows.length - (max - 1)
  return [
    ...rows.slice(0, max - 1),
    { id: 'more', title: `${rest} autres activités`, detail: '', status: '', tone: 'muted' },
  ]
}

const STATE_LABELS = {
  repos: 'Repos',
  appel: 'Appel détecté',
  meet: 'Appel en cours',
  music: 'Musique',
  agent: 'Session Claude',
  dragWake: 'Fichier en cours de glissement',
  dragOver: 'Dépôt d’un fichier',
} as const

/**
 * Annonce de la région aria-live (prototype : label), complétée du contenu utile pour un lecteur d'écran :
 * titre de la notification, commande demandée, app de l'appel détecté.
 */
export function islandLabel(snapshot: IslandSnapshot, sessionCount: number, callAppName: string | null): string {
  const { state } = snapshot
  switch (state) {
    case 'notif': {
      const base = snapshot.withCall ? 'Notification pendant un appel' : 'Notification'
      const n = snapshot.notification
      if (!n) return base
      return `${base} : ${n.title}${n.subtitle ? `, ${n.subtitle}` : ''}`
    }
    case 'progress':
      return snapshot.primary?.kind === 'progress' ? snapshot.primary.label : 'Progression'
    case 'agentAsk':
      return `Claude demande l’autorisation${snapshot.ask ? ` : ${snapshot.ask.summary}` : ''}`
    case 'multi':
      return sessionsTitle(sessionCount)
    case 'appel':
      // Nom d'app vide : enregistrement lancé à la main (menu du soleil, bouton du header).
      if (callAppName === '') return 'Enregistrer un appel'
      return callAppName ? `Appel détecté dans ${callAppName}` : STATE_LABELS.appel
    default:
      return STATE_LABELS[state]
  }
}
