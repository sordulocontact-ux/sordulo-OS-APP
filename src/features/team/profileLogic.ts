/**
 * Logique pure du profil d'un membre : compétences ouvertes, affinités, absences, barème de commission.
 * Aucune valeur de barème n'est écrite ici (données réelles hors git) : les formulaires démarrent vides.
 */
import { parseMoneyInput } from '../../shared/billing'
import { tieredAmountCents, validateTiers } from '../../shared/commission'
import {
  AFFINITIES_MAX,
  SKILL_KEY_MAX_LENGTH,
  SKILL_LEVEL_MAX,
  type AbsenceKind,
  type CommissionPlan,
  type CommissionTier,
  type MemberAbsence,
  type SkillLevels,
} from '../../shared/types'

/* ---------- Compétences ---------- */

/** Compétences toujours proposées dans la fenêtre (niveau 0 = ne pratique pas, jamais enregistrée). */
export const CORE_SKILLS = ['design', 'dev'] as const

export const SKILL_SUGGESTIONS = ['design', 'dev', 'dev front', 'dev back', 'motion', 'branding', 'UI', 'UX', 'rédaction'] as const

export interface SkillRow {
  name: string
  /** 0 = ne pratique pas. */
  level: number
}

/** Clé stockée : minuscules, espaces simplifiés. « Dev  Front » → « dev front ». */
export function normalizeSkillName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Erreur de saisie d'un nom de compétence, ou null. */
export function skillNameError(raw: string, existing: readonly string[]): string | null {
  const name = normalizeSkillName(raw)
  if (name === '') return 'Écris le nom de la compétence.'
  if (name.length > SKILL_KEY_MAX_LENGTH) return `Le nom ne dépasse pas ${SKILL_KEY_MAX_LENGTH} caractères.`
  if (existing.includes(name)) return 'Cette compétence est déjà dans la liste.'
  return null
}

/** Lignes à éditer : design et dev d'abord, puis les autres compétences par nom. */
export function skillsToRows(skills: SkillLevels): SkillRow[] {
  const levelOf = (name: string): number => {
    const level = skills[name]
    return typeof level === 'number' && Number.isFinite(level) ? Math.min(SKILL_LEVEL_MAX, Math.max(0, Math.round(level))) : 0
  }
  const others = Object.keys(skills)
    .filter((name) => !(CORE_SKILLS as readonly string[]).includes(name))
    .sort((a, b) => a.localeCompare(b, 'fr'))
  return [...CORE_SKILLS, ...others].map((name) => ({ name, level: levelOf(name) }))
}

/** Compétences à enregistrer : noms normalisés, niveau 1 à 5, doublons fusionnés (le dernier gagne), niveau 0 retiré. */
export function rowsToSkills(rows: readonly SkillRow[]): SkillLevels {
  const skills: SkillLevels = {}
  for (const row of rows) {
    const name = normalizeSkillName(row.name)
    if (name === '' || name.length > SKILL_KEY_MAX_LENGTH) continue
    if (Number.isInteger(row.level) && row.level >= 1 && row.level <= SKILL_LEVEL_MAX) skills[name] = row.level
    else delete skills[name]
  }
  return skills
}

/** Suggestions pas encore dans la liste, filtrées par la saisie (sans accents ni casse). */
export function suggestSkills(query: string, existing: readonly string[]): string[] {
  const fold = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const q = fold(query.trim())
  const taken = new Set(existing.map(normalizeSkillName))
  return SKILL_SUGGESTIONS.filter((s) => !taken.has(normalizeSkillName(s)) && fold(s).includes(q))
}

/** « dev front » → « Dev front » (affichage). */
export function skillLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/* ---------- Affinités ---------- */

export const AFFINITY_MAX_LENGTH = 40

function foldKey(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Ajoute une affinité (sans doublon, sans accents ni casse) ; renvoie la liste et une erreur éventuelle. */
export function addAffinity(list: readonly string[], raw: string): { list: string[]; error: string | null } {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text === '') return { list: [...list], error: null }
  if (text.length > AFFINITY_MAX_LENGTH) return { list: [...list], error: `Une affinité ne dépasse pas ${AFFINITY_MAX_LENGTH} caractères.` }
  if (list.some((a) => foldKey(a) === foldKey(text))) return { list: [...list], error: 'Cette affinité est déjà dans la liste.' }
  if (list.length >= AFFINITIES_MAX) return { list: [...list], error: `${AFFINITIES_MAX} affinités au plus.` }
  return { list: [...list, text], error: null }
}

/* ---------- Absences ---------- */

export interface AbsenceDraft {
  start_date: string
  end_date: string
  kind: AbsenceKind
  note: string
}

export const ABSENCE_NOTE_MAX_LENGTH = 500

/** Erreur du formulaire d'absence, ou null. Dates AAAA-MM-JJ. */
export function validateAbsence(draft: AbsenceDraft): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(draft.start_date)) return 'Choisis la date de début.'
  if (!iso.test(draft.end_date)) return 'Choisis la date de fin.'
  if (draft.end_date < draft.start_date) return 'La fin ne peut pas précéder le début.'
  if (draft.note.trim().length > ABSENCE_NOTE_MAX_LENGTH) return `La note ne dépasse pas ${ABSENCE_NOTE_MAX_LENGTH} caractères.`
  return null
}

/** Ligne à insérer (note vide = null). */
export function absenceRow(memberId: string, draft: AbsenceDraft) {
  const note = draft.note.trim()
  return { member_id: memberId, start_date: draft.start_date, end_date: draft.end_date, kind: draft.kind, note: note === '' ? null : note }
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function formatDay(iso: string): string {
  return dayFormat.format(new Date(`${iso}T00:00:00Z`))
}

/** « 3 déc. 2026 » pour un jour, « 3 déc. 2026 au 5 déc. 2026 » pour une période. */
export function formatPeriod(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} au ${formatDay(end)}`
}

/** Absences triées : celles à venir ou en cours d'abord (par début), puis les passées (récentes d'abord). */
export function sortAbsences<T extends Pick<MemberAbsence, 'start_date' | 'end_date'>>(absences: readonly T[], today: string): T[] {
  const upcoming = absences.filter((a) => a.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date))
  const past = absences.filter((a) => a.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date))
  return [...upcoming, ...past]
}

/* ---------- Barème de commission ---------- */

export interface TierDraft {
  /** Plafond en euros saisi (ignoré pour la dernière tranche). */
  upTo: string
  /** Taux en % saisi. */
  rate: string
}

export interface CommissionForm {
  tiers: TierDraft[]
  followupRate: string
  signWindow: string
  followupWindow: string
  active: boolean
}

/** Formulaire vide : une seule tranche sans plafond, aucun taux (les vraies valeurs sont saisies dans l'app). */
export function emptyCommissionForm(): CommissionForm {
  return { tiers: [{ upTo: '', rate: '' }], followupRate: '', signWindow: '6', followupWindow: '12', active: true }
}

function rateText(rate: number): string {
  return String(rate).replace('.', ',')
}

export function planToForm(plan: Pick<CommissionPlan, 'tiers' | 'followup_rate' | 'sign_window_months' | 'followup_window_months' | 'active'>): CommissionForm {
  return {
    tiers: plan.tiers.map((t) => ({ upTo: t.up_to_cents === null ? '' : String(t.up_to_cents / 100).replace('.', ','), rate: rateText(t.rate) })),
    followupRate: rateText(plan.followup_rate),
    signWindow: String(plan.sign_window_months),
    followupWindow: String(plan.followup_window_months),
    active: plan.active,
  }
}

function parseRate(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const value = Number(text)
  return value >= 0 && value <= 100 ? value : null
}

function parseMonths(raw: string, min: number): number | null {
  const text = raw.trim()
  if (!/^\d+$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= 120 ? value : null
}

export type PlanFields = Pick<CommissionPlan, 'tiers' | 'followup_rate' | 'sign_window_months' | 'followup_window_months' | 'active'>

/** Formulaire → champs enregistrables, ou le premier message d'erreur (même règle que la base). */
export function parseCommissionForm(form: CommissionForm): { ok: true; plan: PlanFields } | { ok: false; error: string } {
  const tiers: CommissionTier[] = []
  for (const [index, draft] of form.tiers.entries()) {
    const n = index + 1
    const rate = parseRate(draft.rate)
    if (rate === null) return { ok: false, error: `Tranche ${n} : saisis un taux entre 0 et 100 %.` }
    const last = index === form.tiers.length - 1
    if (last) {
      tiers.push({ up_to_cents: null, rate })
      continue
    }
    const cap = parseMoneyInput(draft.upTo)
    if (!cap.ok) return { ok: false, error: `Tranche ${n} : saisis un plafond en euros.` }
    tiers.push({ up_to_cents: cap.value, rate })
  }
  const tiersError = validateTiers(tiers)
  if (tiersError) return { ok: false, error: tiersError }
  const followup = parseRate(form.followupRate)
  if (followup === null) return { ok: false, error: 'Saisis le taux des devis suivants (0 à 100 %).' }
  const sign = parseMonths(form.signWindow, 1)
  if (sign === null) return { ok: false, error: 'La fenêtre de signature va de 1 à 120 mois.' }
  const window = parseMonths(form.followupWindow, 0)
  if (window === null) return { ok: false, error: 'La fenêtre des devis suivants va de 0 à 120 mois.' }
  return { ok: true, plan: { tiers, followup_rate: followup, sign_window_months: sign, followup_window_months: window, active: form.active } }
}

/** Commission du premier devis pour un montant HT saisi en euros, ou null si barème ou montant invalide. */
export function previewCommission(form: CommissionForm, amountText: string): number | null {
  const parsed = parseCommissionForm(form)
  const amount = parseMoneyInput(amountText)
  if (!parsed.ok || !amount.ok || amount.value <= 0) return null
  return tieredAmountCents(parsed.plan.tiers, amount.value)
}
