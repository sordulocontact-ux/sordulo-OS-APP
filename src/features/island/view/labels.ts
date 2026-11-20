/**
 * Textes calculés de l'île : annonce de l'état (prototype : label), résumé des sessions, minuteurs.
 */
import type { ClaudeSession, IslandSnapshot } from '../types'

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
