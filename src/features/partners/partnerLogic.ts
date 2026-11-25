import { formatMoney, moneyInputValue, parseMoneyInput } from '../../shared/billing'
import {
  LABELS,
  PARTNER_CATEGORIES,
  PARTNER_RATING_MAX,
  PARTNER_RATING_MIN,
  PARTNER_SKILL_MAX_LENGTH,
  PARTNER_SKILLS_MAX,
  type Partner,
  type PartnerCategory,
  type PartnerProject,
} from '../../shared/types'
import { emailError, normalizeName, normalizeWebsite, trimOrNull, websiteError } from '../clients/clientUtils'

/* ---------- Compétences (étiquettes) ---------- */

/**
 * Saisie « React, Figma ; Rust » → étiquettes, ordre de saisie gardé, sans vide ni doublon (casse ignorée).
 * Même nettoyage que la base (tg_partner_guard).
 */
export function parseSkills(raw: string): string[] {
  const seen = new Set<string>()
  const skills: string[] = []
  for (const part of raw.split(/[,;\n]/)) {
    const tag = part.trim().replace(/\s+/g, ' ')
    if (tag === '') continue
    const key = tag.toLocaleLowerCase('fr')
    if (seen.has(key)) continue
    seen.add(key)
    skills.push(tag)
  }
  return skills
}

/** Étiquettes → texte de saisie. */
export function skillsInputValue(skills: readonly string[]): string {
  return skills.join(', ')
}

/** Toutes les compétences du réseau, sans doublon (casse ignorée), triées. */
export function partnerSkills(partners: readonly Pick<Partner, 'skills'>[]): string[] {
  const byKey = new Map<string, string>()
  for (const partner of partners) {
    for (const skill of partner.skills) {
      const key = skill.toLocaleLowerCase('fr')
      if (!byKey.has(key)) byKey.set(key, skill)
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
}

/* ---------- Formulaire ---------- */

export interface PartnerDraft {
  name: string
  company: string
  category: PartnerCategory
  skills: string
  dayRate: string
  email: string
  phone: string
  website: string
  city: string
  rating: string
  availability: string
  notes: string
}

export type PartnerPayload = Pick<
  Partner,
  'name' | 'company' | 'category' | 'skills' | 'day_rate_cents' | 'email' | 'phone' | 'website' | 'city' | 'rating' | 'availability' | 'notes'
>

export interface PartnerErrors {
  name?: string
  skills?: string
  dayRate?: string
  email?: string
  website?: string
  rating?: string
  any: boolean
}

export function emptyPartnerDraft(): PartnerDraft {
  return {
    name: '',
    company: '',
    category: 'freelance',
    skills: '',
    dayRate: '',
    email: '',
    phone: '',
    website: '',
    city: '',
    rating: '',
    availability: '',
    notes: '',
  }
}

export function draftFromPartner(partner: Partner): PartnerDraft {
  return {
    name: partner.name,
    company: partner.company ?? '',
    category: partner.category,
    skills: skillsInputValue(partner.skills),
    dayRate: partner.day_rate_cents === null ? '' : moneyInputValue(partner.day_rate_cents),
    email: partner.email ?? '',
    phone: partner.phone ?? '',
    website: partner.website ?? '',
    city: partner.city ?? '',
    rating: partner.rating === null ? '' : String(partner.rating),
    availability: partner.availability ?? '',
    notes: partner.notes ?? '',
  }
}

/** Montant facultatif en euros → centimes ; vide = null. */
export function parseOptionalMoney(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw.trim() === '') return { ok: true, value: null }
  const parsed = parseMoneyInput(raw)
  if (!parsed.ok) return parsed
  if (parsed.value < 0) return { ok: false, error: 'Le montant ne peut pas être négatif.' }
  return parsed
}

function parseRating(raw: string): number | null {
  if (raw === '') return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= PARTNER_RATING_MIN && value <= PARTNER_RATING_MAX ? value : Number.NaN
}

export function validatePartnerDraft(draft: PartnerDraft): PartnerErrors {
  const errors: PartnerErrors = { any: false }
  if (draft.name.trim() === '') errors.name = 'Saisis un nom.'
  else if (draft.name.trim().length > 200) errors.name = '200 caractères au plus.'

  const skills = parseSkills(draft.skills)
  if (skills.length > PARTNER_SKILLS_MAX) errors.skills = `${PARTNER_SKILLS_MAX} compétences au plus.`
  else if (skills.some((s) => s.length > PARTNER_SKILL_MAX_LENGTH)) errors.skills = `Une compétence fait ${PARTNER_SKILL_MAX_LENGTH} caractères au plus.`

  const rate = parseOptionalMoney(draft.dayRate)
  if (!rate.ok) errors.dayRate = rate.error

  const email = emailError(draft.email)
  if (email) errors.email = email
  const website = websiteError(draft.website)
  if (website) errors.website = website
  if (Number.isNaN(parseRating(draft.rating))) errors.rating = `Une note de ${PARTNER_RATING_MIN} à ${PARTNER_RATING_MAX}.`

  errors.any = Boolean(errors.name || errors.skills || errors.dayRate || errors.email || errors.website || errors.rating)
  return errors
}

/** Brouillon validé → colonnes envoyées à la base (vide devient null). */
export function partnerPayload(draft: PartnerDraft): PartnerPayload {
  const rate = parseOptionalMoney(draft.dayRate)
  const rating = parseRating(draft.rating)
  return {
    name: draft.name.trim(),
    company: trimOrNull(draft.company),
    category: draft.category,
    skills: parseSkills(draft.skills),
    day_rate_cents: rate.ok ? rate.value : null,
    email: trimOrNull(draft.email),
    phone: trimOrNull(draft.phone),
    website: normalizeWebsite(draft.website),
    city: trimOrNull(draft.city),
    rating: rating === null || Number.isNaN(rating) ? null : rating,
    availability: trimOrNull(draft.availability),
    notes: trimOrNull(draft.notes),
  }
}

/* ---------- Liste ---------- */

export interface PartnerFilters {
  query: string
  category: PartnerCategory | ''
  skill: string
  showArchived: boolean
}

export const EMPTY_PARTNER_FILTERS: PartnerFilters = { query: '', category: '', skill: '', showArchived: false }

export function activePartnerFilterCount(filters: PartnerFilters): number {
  return (filters.category ? 1 : 0) + (filters.skill ? 1 : 0) + (filters.showArchived ? 1 : 0)
}

/** Recherche (nom, société, ville, compétences, métier) et filtres ; tri par nom, archivés en dernier. */
export function filterPartners<T extends Partner>(partners: readonly T[], filters: PartnerFilters): T[] {
  const needle = normalizeName(filters.query)
  const skillKey = filters.skill.toLocaleLowerCase('fr')
  return partners
    .filter((p) => filters.showArchived || p.archived_at === null)
    .filter((p) => !filters.category || p.category === filters.category)
    .filter((p) => !skillKey || p.skills.some((s) => s.toLocaleLowerCase('fr') === skillKey))
    .filter((p) => {
      if (needle === '') return true
      const haystack = normalizeName([p.name, p.company, p.city, LABELS.partnerCategory[p.category], ...p.skills].filter(Boolean).join(' '))
      return haystack.includes(needle)
    })
    .sort((a, b) => Number(a.archived_at !== null) - Number(b.archived_at !== null) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
}

/** Métiers dans l'ordre de la liste, pour le filtre. */
export const PARTNER_CATEGORY_OPTIONS = PARTNER_CATEGORIES.map((value) => ({ value, label: LABELS.partnerCategory[value] }))

/* ---------- Affichage ---------- */

/** « 450,00 € / jour » ou null. */
export function formatDayRate(cents: number | null): string | null {
  return cents === null ? null : `${formatMoney(cents)} / jour`
}

/** « 4 / 5 » ou null. */
export function formatRating(rating: number | null): string | null {
  return rating === null ? null : `${rating} / ${PARTNER_RATING_MAX}`
}

/** Sous-titre d'un partenaire : métier, société, ville. */
export function partnerSubtitle(partner: Pick<Partner, 'category' | 'company' | 'city'>): string {
  return [LABELS.partnerCategory[partner.category], partner.company, partner.city].filter(Boolean).join(' · ')
}

/** Total des montants renseignés sur les projets liés (null si aucun). */
export function totalPartnerAmount(links: readonly Pick<PartnerProject, 'amount_cents'>[]): number | null {
  const amounts = links.map((l) => l.amount_cents).filter((a): a is number => a !== null)
  return amounts.length === 0 ? null : amounts.reduce((sum, a) => sum + a, 0)
}

/** Projets que l'on peut encore lier (pas déjà liés), triés par nom. */
export function linkableProjects<T extends { id: string; name: string }>(projects: readonly T[], links: readonly Pick<PartnerProject, 'project_id'>[]): T[] {
  const linked = new Set(links.map((l) => l.project_id))
  return projects.filter((p) => !linked.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
}
