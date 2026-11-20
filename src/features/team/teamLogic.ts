import { LABELS, SKILL_LEVEL_MAX, SKILL_LEVEL_MIN, SKILLS, WEEKDAYS, type Member, type MemberRole, type SkillLevels, type Weekday } from '../../shared/types'

export type MemberStatus = 'active' | 'invited' | 'removed'

/** Membre avec, si on le connaît (RPC `member_sign_in_status`, admins seulement), le fait qu'il s'est déjà connecté. */
export type StatusMember = Pick<Member, 'removed_at' | 'invited_at' | 'user_id'> & { signed_in?: boolean }

/**
 * Retiré, invité (invité par un admin, jamais connecté) ou actif. L'invitation relie le compte tout de
 * suite (`user_id`) : seul `signed_in` dit si l'invité s'est connecté ; sans lui, on retombe sur `user_id`.
 */
export function memberStatus(member: StatusMember): MemberStatus {
  if (member.removed_at) return 'removed'
  if (member.invited_at && (member.signed_in === undefined ? !member.user_id : !member.signed_in)) return 'invited'
  return 'active'
}

/** Réponse de la RPC `member_sign_in_status` → id du membre → déjà connecté. */
export function signInMap(rows: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>()
  if (!Array.isArray(rows)) return map
  for (const row of rows as { member_id?: unknown; signed_in?: unknown }[]) {
    if (typeof row.member_id === 'string' && typeof row.signed_in === 'boolean') map.set(row.member_id, row.signed_in)
  }
  return map
}

/** Ajoute `signed_in` aux membres (statuts absents = membres inchangés). */
export function withSignIn<T extends { id: string }>(members: readonly T[], signedIn: ReadonlyMap<string, boolean> | undefined): (T & { signed_in?: boolean })[] {
  if (!signedIn) return [...members]
  return members.map((m) => (signedIn.has(m.id) ? { ...m, signed_in: signedIn.get(m.id) } : m))
}

export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Actif',
  invited: 'Invité, jamais connecté',
  removed: 'Retiré',
}

export type RemovalBlock = 'self' | 'last-admin' | null

/** Raison pour laquelle un membre ne peut pas être retiré (la base refuse aussi). */
export function removalBlock(target: Pick<Member, 'id' | 'role' | 'removed_at'>, currentId: string | undefined, members: readonly Pick<Member, 'id' | 'role' | 'removed_at'>[]): RemovalBlock {
  if (target.id === currentId) return 'self'
  if (target.role === 'admin' && !target.removed_at) {
    const activeAdmins = members.filter((m) => m.role === 'admin' && !m.removed_at)
    if (activeAdmins.length <= 1) return 'last-admin'
  }
  return null
}

export const REMOVAL_BLOCK_TEXT: Record<Exclude<RemovalBlock, null>, string> = {
  self: 'Tu ne peux pas te retirer toi-même.',
  'last-admin': 'Il doit rester au moins un admin actif.',
}

/** Niveau saisi dans le Select (« 0 » = ne pratique pas) vers la valeur stockée (absent). */
export function levelFromSelect(value: string): number | undefined {
  const n = Number(value)
  if (!Number.isInteger(n) || n < SKILL_LEVEL_MIN || n > SKILL_LEVEL_MAX) return undefined
  return n
}

/** Valeur stockée vers la valeur du Select (« 0 » si absent ou hors échelle). */
export function levelToSelect(level: number | undefined): string {
  return level !== undefined && level >= SKILL_LEVEL_MIN && level <= SKILL_LEVEL_MAX ? String(Math.round(level)) : '0'
}

/** Compétences à enregistrer : les clés non pratiquées sont retirées. */
export function buildSkills(levels: Record<(typeof SKILLS)[number], string>): SkillLevels {
  const skills: SkillLevels = {}
  for (const skill of SKILLS) {
    const level = levelFromSelect(levels[skill])
    if (level !== undefined) skills[skill] = level
  }
  return skills
}

/** « Design 4/5, Dev 2/5 » ou null si aucune compétence renseignée. */
export function skillsSummary(skills: SkillLevels): { skill: (typeof SKILLS)[number]; text: string }[] {
  return SKILLS.flatMap((skill) => {
    const level = skills[skill]
    return level !== undefined && level >= SKILL_LEVEL_MIN ? [{ skill, text: `${LABELS.skill[skill]} ${level}/${SKILL_LEVEL_MAX}` }] : []
  })
}

/** « 35 h / semaine » (virgule décimale). */
export function formatCapacity(hours: number): string {
  return `${String(hours).replace('.', ',')} h / semaine`
}

/** « Indisponible le mercredi » ou « Indisponible : lundi, mercredi », null si aucun. */
export function unavailableText(days: readonly Weekday[]): string | null {
  const sorted = WEEKDAYS.filter((d) => days.includes(d)).map((d) => LABELS.weekday[d].toLowerCase())
  if (sorted.length === 0) return null
  if (sorted.length === 1) return `Indisponible le ${sorted[0]}`
  return `Indisponible : ${sorted.join(', ')}`
}

/** Valide la capacité hebdomadaire saisie (0 à 80, pas de 0,5). */
export function parseCapacity(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(',', '.')
  if (text === '') return { error: 'Indique la capacité en heures par semaine.' }
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || value > 80) return { error: 'La capacité doit être comprise entre 0 et 80 heures.' }
  if (!Number.isInteger(value * 2)) return { error: 'La capacité va de demi-heure en demi-heure (par exemple 17,5).' }
  return { value }
}

/** Traduit une erreur de la base ou de l'API en message clair pour l'interface. */
export function translateMemberError(error: unknown, fallback = 'Une erreur est survenue. Réessaie.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : ''
  // Messages levés par la migration 0003 (trigger members_10_guard, RPC remove_member).
  if (/(au moins un|dernier|last)( \w+)? admin/i.test(message)) return 'Il doit rester au moins un admin actif.'
  if (/(toi|soi)-m[êe]me|yourself/i.test(message)) return 'Tu ne peux pas te retirer toi-même.'
  if (/row-level security|permission denied|42501|r[ée]serv[ée] aux admin|not allowed/i.test(message)) return 'Seuls les admins peuvent faire cette modification.'
  return fallback
}

export const ROLE_HELP: Record<MemberRole, string> = {
  admin: 'Admin : voit et modifie tout, y compris l’Équipe et les Paramètres.',
  membre: 'Membre : travaille sur les clients, les projets, les entrées et les tâches.',
  prospection: 'Prospection : voit l’Accueil et la Prospection (prospects, conversion en client), rien d’autre.',
  finance: 'Finance : voit l’Accueil, les Devis, les Factures, et lit les Clients et les Projets sans les modifier.',
}


/** « 70 h » (virgule décimale). */
export function formatHours(hours: number): string {
  return `${String(Math.round(hours * 100) / 100).replace('.', ',')} h`
}

export interface TeamStats {
  active: number
  invited: number
  /** Somme des heures hebdomadaires des membres actifs. */
  weeklyHours: number
}

/** Chiffres de l'équipe : les retirés n'y comptent pas ; les invités comptent à part, sans capacité. */
export function teamStats(members: readonly (StatusMember & Pick<Member, 'weekly_capacity_hours'>)[]): TeamStats {
  const stats: TeamStats = { active: 0, invited: 0, weeklyHours: 0 }
  for (const m of members) {
    const status = memberStatus(m)
    if (status === 'active') {
      stats.active += 1
      stats.weeklyHours += m.weekly_capacity_hours
    } else if (status === 'invited') stats.invited += 1
  }
  return stats
}
