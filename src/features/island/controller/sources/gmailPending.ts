/**
 * Mails clients en attente de la source « gmail » (relance unique, décision de Maël) : état gardé, moment calme,
 * texte de la relance. Pur, testé dans gmailPending.test.ts.
 *
 * Cycle d'un mail proposé (« Ibé a envoyé un retour ») :
 * - `proposed` : notification partie, ni Analyser ni Ignorer. Gardé en localStorage (par utilisateur) pour
 *   survivre à un redémarrage : seulement id, Message-ID, client, projet, objet et dates, jamais le contenu.
 * - Au premier moment calme (au moins RELANCE_DELAY_MS après la première proposition, île au repos, pas d'appel,
 *   pas de demande Claude, entre 9 h et 19 h, heure locale ; sinon le lendemain à partir de 9 h) : tous les mails
 *   `proposed` passent `reminded`, une seule notification « N mails clients pas encore traités ».
 * - « Voir » : les mails `reminded` passent `replay` et sont reproposés un par un ; chacun est oublié dès qu'il
 *   est traité ou que sa notification est partie. Relance partie sans « Voir » : les mails sont oubliés.
 * - Après un redémarrage, seuls les mails `proposed` sont repris (leur relance n'a pas encore eu lieu).
 */
import type { NotificationParams } from '../../catalog'
import type { ClaudeSession, IslandSnapshot } from '../../types'

/** Délai minimal entre la première proposition et la relance. */
export const REMINDER_DELAY_MS = 60 * 60_000
/** Heures (locales) où une relance peut partir : de 9 h à 19 h. */
export const CALM_START_HOUR = 9
export const CALM_END_HOUR = 19

export type PendingStage = 'proposed' | 'reminded' | 'replay'

export interface PendingMail {
  /** Message-ID normalisé (external_ref). */
  messageId: string
  /** id Gmail (propre à la boîte). */
  gmailId: string
  clientId: string
  clientName: string
  /** Projet actif du client au moment de la proposition. */
  projectId: string
  subject: string
  /** Réception du mail, epoch ms. */
  receivedAt: number
  /** Proposition dans l'île (horloge de l'île), ms. */
  proposedAt: number
  stage: PendingStage
}

/** Clé du stockage local, par utilisateur. */
export function pendingStorageKey(userId: string): string {
  return `sordulo.island.gmail.pending.${userId}`
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStage(value: unknown): value is PendingStage {
  return value === 'proposed' || value === 'reminded' || value === 'replay'
}

function normalizePending(raw: unknown): PendingMail | null {
  if (!isObject(raw)) return null
  const { messageId, gmailId, clientId, clientName, projectId, subject, receivedAt, proposedAt, stage } = raw
  if (
    typeof messageId !== 'string' ||
    !messageId ||
    typeof gmailId !== 'string' ||
    !gmailId ||
    typeof clientId !== 'string' ||
    typeof clientName !== 'string' ||
    typeof projectId !== 'string' ||
    !projectId ||
    typeof subject !== 'string' ||
    typeof receivedAt !== 'number' ||
    !Number.isFinite(receivedAt) ||
    typeof proposedAt !== 'number' ||
    !Number.isFinite(proposedAt) ||
    !isStage(stage)
  ) {
    return null
  }
  return { messageId, gmailId, clientId, clientName, projectId, subject, receivedAt, proposedAt, stage }
}

/** Texte du stockage → mails en attente encore à relancer (`proposed`), sans doublon. Illisible : aucun. */
export function parsePending(raw: string | null): PendingMail[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const list = isObject(parsed) && Array.isArray(parsed.mails) ? parsed.mails : []
  const seen = new Set<string>()
  return list.flatMap((item): PendingMail[] => {
    const mail = normalizePending(item)
    if (!mail || mail.stage !== 'proposed' || seen.has(mail.messageId)) return []
    seen.add(mail.messageId)
    return [mail]
  })
}

/** Mails en attente → texte du stockage ; null s'il n'y en a plus (la clé est retirée). */
export function serializePending(mails: readonly PendingMail[]): string | null {
  if (mails.length === 0) return null
  return JSON.stringify({
    version: 1,
    mails: mails.map((m) => ({
      messageId: m.messageId,
      gmailId: m.gmailId,
      clientId: m.clientId,
      clientName: m.clientName,
      projectId: m.projectId,
      subject: m.subject,
      receivedAt: m.receivedAt,
      proposedAt: m.proposedAt,
      stage: m.stage,
    })),
  })
}

/** Heure locale où une relance peut partir (9 h inclus, 19 h exclu). */
export function isCalmHour(hour: number): boolean {
  return hour >= CALM_START_HOUR && hour < CALM_END_HOUR
}

/** États où le contrôleur montre quelque chose par-dessus la principale. */
const OVERLAY_STATES: ReadonlySet<IslandSnapshot['state']> = new Set(['appel', 'dragWake', 'dragOver', 'review'])

/** Un appel est en cours (activité meet principale ou en arrière-plan). */
export function hasCall(snapshot: Pick<IslandSnapshot, 'primary' | 'background'>): boolean {
  return snapshot.primary?.kind === 'meet' || snapshot.background.some((a) => a.kind === 'meet')
}

/**
 * L'île est au repos : aucune notification affichée (la file se vide toute seule tant que rien n'est affiché),
 * aucune demande, aucun état du contrôleur, pas d'appel (le mode concentration y met des notifications de côté).
 */
export function islandIsIdle(snapshot: IslandSnapshot): boolean {
  return snapshot.notification === null && snapshot.ask === null && !OVERLAY_STATES.has(snapshot.state) && !hasCall(snapshot)
}

/** Moment calme : île au repos, aucune demande Claude en attente (même mise de côté), entre 9 h et 19 h. */
export function isCalmMoment(snapshot: IslandSnapshot, sessions: readonly ClaudeSession[], hour: number): boolean {
  return isCalmHour(hour) && islandIsIdle(snapshot) && !sessions.some((s) => s.status === 'waiting')
}

/**
 * Mails à relancer maintenant (tous les `proposed`, regroupés) si la première proposition date d'au moins
 * REMINDER_DELAY_MS ; sinon aucun.
 */
export function reminderCandidates(mails: readonly PendingMail[], now: number): PendingMail[] {
  const proposed = mails.filter((m) => m.stage === 'proposed')
  if (proposed.length === 0) return []
  const first = Math.min(...proposed.map((m) => m.proposedAt))
  return now - first >= REMINDER_DELAY_MS ? [...proposed].sort((a, b) => a.receivedAt - b.receivedAt) : []
}

/** Paramètres de la notification de relance. */
export function reminderParams(mails: readonly PendingMail[]): NotificationParams['mailReminder'] {
  const clientNames = [...new Set(mails.map((m) => m.clientName))]
  const first = mails[0]
  return {
    count: mails.length,
    clientNames,
    ...(first ? { first: { clientName: first.clientName, subject: first.subject } } : {}),
  }
}
