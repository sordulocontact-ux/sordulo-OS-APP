/**
 * Textes calculés de l'île : annonce de l'état (prototype : label), résumé des sessions, minuteurs.
 */
import { MEET_BACKGROUND } from '../geometry'
import type { Activity, ClaudeSession, IslandMusic, IslandSnapshot } from '../types'

/** mm:ss d'une durée en ms (prototype : mmss). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Résumé des sessions (« 3 en cours, 1 à autoriser, 1 terminée »), prototype : renderSessions. */
export function sessionsSummary(sessions: readonly ClaudeSession[]): string {
  let working = 0
  let waiting = 0
  let patient = 0
  let idle = 0
  let done = 0
  for (const s of sessions) {
    if (s.status === 'working') working++
    else if (s.status === 'waiting') waiting++
    else if (s.status === 'background') patient++
    else if (s.status === 'idle') idle++
    else if (s.status === 'done') done++
  }
  const parts: string[] = []
  if (working) parts.push(`${working} en cours`)
  if (waiting) parts.push(`${waiting} à autoriser`)
  if (patient) parts.push(`${patient} ${patient > 1 ? 'patientent' : 'patiente'}`)
  if (idle) parts.push(`${idle} en pause`)
  if (done) parts.push(`${done} ${done > 1 ? 'terminées' : 'terminée'}`)
  return parts.join(', ')
}

/** Titre de multi : « 5 sessions Claude Code ». */
export function sessionsTitle(count: number): string {
  return `${count} ${count > 1 ? 'sessions' : 'session'} Claude Code`
}

/**
 * Ce que fait le clic sur une ligne « aussi en cours » :
 * - `session` : ouvre la fenêtre VS Code de la session, ou remontre sa demande si elle attend une réponse
 *   (`waiting`, même règle que la vue agent) ;
 * - `activity` : affiche cette activité dans l'île (épinglée, comme la bulle « Afficher X dans l'île ») ;
 * - `player` : pendant un appel, l'île reste à l'appel (activité exclusive) : la ligne Musique ouvre le lecteur ;
 * - `more` : déplie la liste complète sur place (`hidden` : lignes résumées par « N autres activités »).
 */
export type BackgroundTarget =
  | { type: 'session'; sessionId: string; waiting: boolean }
  | { type: 'activity'; activityId: string; kind: 'music' | 'progress' }
  | { type: 'player' }
  | { type: 'more'; hidden: number }

/** Ligne « aussi en cours » sous l'appel (meetOpen) et sous la musique (musicOpen). */
export interface BackgroundRow {
  id: string
  title: string
  detail: string
  status: string
  /** Couleur du statut : neutre, terminé, conflit, bloquée ou en attente de réponse. */
  tone: 'muted' | 'done' | 'conflict' | 'error' | 'waiting'
  /** Action du clic ; null : ligne d'information seule (progression pendant un appel, que l'île ne peut pas afficher). */
  target: BackgroundTarget | null
}

export interface BackgroundRowsOptions {
  /** Liste dépliée (« N autres activités » cliqué) : toutes les lignes, sans résumé. */
  expanded?: boolean
  /**
   * Appel en cours : activité exclusive, l'île ne peut pas afficher autre chose (le coordinateur refuse
   * l'épinglage). La musique ouvre alors le lecteur, une progression n'est qu'une ligne d'information.
   */
  duringCall?: boolean
}

function sessionStatus(session: ClaudeSession): Pick<BackgroundRow, 'status' | 'tone'> {
  if (session.status === 'working' && session.conflict) return { status: 'Conflit', tone: 'conflict' }
  if (session.status === 'working' && session.error) return { status: 'Bloquée', tone: 'error' }
  if (session.status === 'working') return { status: 'En cours', tone: 'muted' }
  if (session.status === 'waiting') return { status: 'Attend ta réponse', tone: 'waiting' }
  if (session.status === 'background') return { status: 'Patiente', tone: 'muted' }
  if (session.status === 'done') return { status: 'Terminé', tone: 'done' }
  if (session.status === 'idle') return { status: 'En pause', tone: 'muted' }
  return { status: 'Inactive', tone: 'muted' }
}

/** « Titre, artiste » d'un morceau (artiste absent : le titre seul). */
export function musicTrackLine(music: IslandMusic): string {
  return music.artist ? `${music.title}, ${music.artist}` : music.title
}

/**
 * Annonce de l'état `music` : « Musique : <titre>, <artiste> », « Musique en pause : … » ; « Musique » sans
 * données (ou « Musique en pause » sans titre).
 */
export function musicLabel(music: IslandMusic | null | undefined): string {
  if (!music) return STATE_LABELS.music
  const base = music.playing ? STATE_LABELS.music : 'Musique en pause'
  return music.title ? `${base} : ${musicTrackLine(music)}` : base
}

/**
 * Lignes « aussi en cours » sous l'appel et sous la musique : une par progression, une par session Claude
 * (agent : sa session, multi : toutes), une pour la musique (son titre), dans l'ordre des activités. Repliée,
 * au-delà de MEET_BACKGROUND.maxRows, la dernière ligne devient « N autres activités » (cible `more`) ; dépliée
 * (`expanded`), toutes les lignes.
 */
export function backgroundRows(
  background: readonly Activity[],
  sessions: readonly ClaudeSession[],
  music: IslandMusic | null = null,
  { expanded = false, duringCall = false }: BackgroundRowsOptions = {},
): BackgroundRow[] {
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
      target: { type: 'session', sessionId: session.id, waiting: session.status === 'waiting' },
    })
  }
  for (const activity of background) {
    switch (activity.kind) {
      case 'progress':
        rows.push({
          id: activity.id,
          title: activity.label,
          detail: activity.detail ?? '',
          status: activity.fraction === null ? 'En cours' : `${Math.round(activity.fraction * 100)} %`,
          tone: 'muted',
          target: duringCall ? null : { type: 'activity', activityId: activity.id, kind: 'progress' },
        })
        break
      case 'agent':
        addSession(sessions.find((s) => s.id === activity.sessionId) ?? sessions[0])
        break
      case 'multi':
        sessions.forEach(addSession)
        break
      case 'music':
        rows.push({
          id: activity.id,
          title: 'Musique',
          detail: music ? musicTrackLine(music) : '',
          status: music && !music.playing ? 'En pause' : '',
          tone: 'muted',
          target: duringCall ? { type: 'player' } : { type: 'activity', activityId: activity.id, kind: 'music' },
        })
        break
      case 'meet':
        break
    }
  }
  const max = MEET_BACKGROUND.maxRows
  if (expanded || rows.length <= max) return rows
  const rest = rows.length - (max - 1)
  return [
    ...rows.slice(0, max - 1),
    {
      id: 'more',
      title: `${rest} autres activités`,
      detail: '',
      status: '',
      tone: 'muted',
      target: { type: 'more', hidden: rest },
    },
  ]
}

/**
 * Nom accessible du bouton d'une ligne « aussi en cours » : l'action, puis le statut entre parenthèses
 * (« Ouvrir PDS OS dans son éditeur (En cours) »). null : ligne sans action.
 */
export function backgroundRowLabel(row: BackgroundRow): string | null {
  const { target } = row
  if (!target) return null
  let action: string
  switch (target.type) {
    case 'session':
      action = target.waiting ? `Répondre à la session ${row.title}` : `Ouvrir ${row.title} dans son éditeur`
      break
    case 'activity':
      action = target.kind === 'music' ? 'Afficher la musique dans l’île' : `Afficher ${row.title} dans l’île`
      break
    case 'player':
      action = 'Ouvrir le lecteur de musique'
      break
    case 'more':
      return `Afficher les ${target.hidden} autres activités`
  }
  // Musique : le morceau en plus (le titre de la ligne ne dit que « Musique »).
  const musicRow = target.type === 'player' || (target.type === 'activity' && target.kind === 'music')
  const extra = [musicRow ? row.detail : '', row.status].filter(Boolean)
  return extra.length > 0 ? `${action} (${extra.join(', ')})` : action
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
 * titre de la notification, commande demandée, app de l'appel détecté, morceau en cours.
 */
export function islandLabel(
  snapshot: IslandSnapshot,
  sessionCount: number,
  callAppName: string | null,
  music: IslandMusic | null = null,
): string {
  const { state } = snapshot
  switch (state) {
    case 'notif': {
      const base = snapshot.withCall ? 'Notification pendant un appel' : 'Notification'
      const n = snapshot.notification
      if (!n) return base
      return `${base} : ${n.title}${n.subtitle ? `, ${n.subtitle}` : ''}`
    }
    case 'progress': {
      const p = snapshot.primary?.kind === 'progress' ? snapshot.primary : null
      if (!p) return 'Progression'
      return p.detail ? `${p.label} : ${p.detail}` : p.label
    }
    case 'agentAsk':
      return `Claude demande l’autorisation${snapshot.ask ? ` : ${snapshot.ask.summary}` : ''}`
    case 'multi':
      return sessionsTitle(sessionCount)
    case 'music':
      return musicLabel(music)
    case 'choice': {
      const c = snapshot.choice
      return c ? `${c.title}, ${c.eyebrow} : ${c.secondary ? `${c.secondary} ou ` : ''}${c.primary}` : 'Décision à prendre'
    }
    case 'appel':
      // Nom d'app vide : enregistrement lancé à la main (menu du soleil, bouton du header).
      if (callAppName === '') return 'Enregistrer un appel'
      return callAppName ? `Appel détecté dans ${callAppName}` : STATE_LABELS.appel
    default:
      return STATE_LABELS[state]
  }
}
