import { normalizeSiret, siretError } from '../../shared/siret'
import type { Organization } from '../../shared/types'

/** Valeurs du formulaire : tout en texte, comme saisi. */
export interface SettingsForm {
  name: string
  legalName: string
  legalForm: string
  siret: string
  street: string
  postalCode: string
  city: string
  country: string
  vatMention: string
  dailyRate: string
  hourlyRate: string
  vatRate: string
  paymentTermsDays: string
  quoteValidityDays: string
  iban: string
  bic: string
}

/** IBAN : majuscules, sans espaces ni tirets. */
export function normalizeIban(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

/** « FR76 3000 6000 … » : groupes de 4 caractères pour la lecture. */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, '$1 ')
}

/** BIC : majuscules, sans espaces. */
export function normalizeBic(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

/** Clé modulo 97 (ISO 7064) : on déplace les 4 premiers caractères à la fin, les lettres valent 10 à 35. */
function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** Message d'erreur en français pour un IBAN saisi, ou null s'il est vide ou valide. */
export function ibanError(raw: string): string | null {
  const iban = normalizeIban(raw)
  if (iban === '') return null
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return 'L’IBAN doit commencer par 2 lettres et 2 chiffres, puis 11 à 30 caractères.'
  if (!ibanChecksumValid(iban)) return 'Cet IBAN n’est pas valide : vérifie les caractères.'
  return null
}

/** Message d'erreur en français pour un BIC saisi (8 ou 11 caractères), ou null s'il est vide ou valide. */
export function bicError(raw: string): string | null {
  const bic = normalizeBic(raw)
  if (bic === '') return null
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) return 'Le BIC fait 8 ou 11 caractères (par exemple BNPAFRPP).'
  return null
}

function parseVatRate(raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(',', '.')
  if (text === '') return { error: 'Indique un taux de TVA (0 si tu n’en factures pas).' }
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || value > 100) return { error: 'Le taux de TVA doit être compris entre 0 et 100.' }
  return { value: Math.round(value * 100) / 100 }
}

function parseDays(raw: string, min: number, max: number, label: string): { value: number } | { error: string } {
  const text = raw.trim()
  if (text === '') return { error: `Indique ${label}.` }
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) return { error: `Indique un nombre entier de jours entre ${min} et ${max}.` }
  return { value }
}

/** Vrai quand la TVA saisie est nulle : la mention légale devient obligatoire sur les factures. */
export function isZeroVat(raw: string): boolean {
  const parsed = parseVatRate(raw)
  return 'value' in parsed && parsed.value === 0
}

export const LEGAL_FORMS = ['Micro-entreprise / EI', 'EURL', 'SARL', 'SAS', 'SASU', 'SA', 'Association', 'Autre'] as const

export function toForm(org: Organization): SettingsForm {
  return {
    name: org.name,
    legalName: org.legal_name ?? '',
    legalForm: org.legal_form ?? '',
    siret: org.siret ?? '',
    street: org.address_street ?? '',
    postalCode: org.address_postal_code ?? '',
    city: org.address_city ?? '',
    country: org.address_country ?? '',
    vatMention: org.vat_mention ?? '',
    dailyRate: org.default_daily_rate === null ? '' : String(org.default_daily_rate),
    hourlyRate: org.default_hourly_rate === null ? '' : String(org.default_hourly_rate),
    vatRate: String(org.default_vat_rate).replace('.', ','),
    paymentTermsDays: String(org.payment_terms_days),
    quoteValidityDays: String(org.quote_validity_days),
    iban: formatIban(org.bank_iban ?? ''),
    bic: org.bank_bic ?? '',
  }
}

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>

function parseRate(raw: string): { value: number | null } | { error: string } {
  const text = raw.trim().replace(',', '.')
  if (text === '') return { value: null }
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return { error: 'Indique un montant positif ou nul.' }
  return { value: Math.round(value * 100) / 100 }
}

export type OrganizationPatch = Partial<
  Pick<
    Organization,
    | 'name' | 'legal_name' | 'legal_form' | 'siret' | 'address_street' | 'address_postal_code' | 'address_city'
    | 'address_country' | 'vat_mention' | 'default_daily_rate' | 'default_hourly_rate'
    | 'default_vat_rate' | 'payment_terms_days' | 'quote_validity_days' | 'bank_iban' | 'bank_bic'
  >
>

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/**
 * Valide le formulaire et calcule les seuls champs modifiés par rapport à l'organisation.
 * Patch vide = aucune modification.
 */
export function buildPatch(form: SettingsForm, org: Organization): { errors: SettingsErrors } | { patch: OrganizationPatch } {
  const errors: SettingsErrors = {}
  if (form.name.trim() === '') errors.name = 'Le nom de l’organisation est obligatoire.'
  const siretProblem = siretError(form.siret)
  if (siretProblem) errors.siret = siretProblem
  const daily = parseRate(form.dailyRate)
  if ('error' in daily) errors.dailyRate = daily.error
  const hourly = parseRate(form.hourlyRate)
  if ('error' in hourly) errors.hourlyRate = hourly.error
  const vat = parseVatRate(form.vatRate)
  if ('error' in vat) errors.vatRate = vat.error
  const terms = parseDays(form.paymentTermsDays, 0, 60, 'le délai de paiement')
  if ('error' in terms) errors.paymentTermsDays = terms.error
  const validity = parseDays(form.quoteValidityDays, 1, 365, 'la validité des devis')
  if ('error' in validity) errors.quoteValidityDays = validity.error
  const ibanProblem = ibanError(form.iban)
  if (ibanProblem) errors.iban = ibanProblem
  const bicProblem = bicError(form.bic)
  if (bicProblem) errors.bic = bicProblem
  if (Object.keys(errors).length > 0) return { errors }

  const next: Required<OrganizationPatch> = {
    name: form.name.trim(),
    legal_name: orNull(form.legalName),
    legal_form: orNull(form.legalForm),
    siret: normalizeSiret(form.siret) || null,
    address_street: orNull(form.street),
    address_postal_code: orNull(form.postalCode),
    address_city: orNull(form.city),
    address_country: orNull(form.country),
    vat_mention: orNull(form.vatMention),
    default_daily_rate: 'value' in daily ? daily.value : null,
    default_hourly_rate: 'value' in hourly ? hourly.value : null,
    default_vat_rate: 'value' in vat ? vat.value : org.default_vat_rate,
    payment_terms_days: 'value' in terms ? terms.value : org.payment_terms_days,
    quote_validity_days: 'value' in validity ? validity.value : org.quote_validity_days,
    bank_iban: normalizeIban(form.iban) || null,
    bank_bic: normalizeBic(form.bic) || null,
  }
  const patch: OrganizationPatch = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (next[key] !== org[key]) Object.assign(patch, { [key]: next[key] })
  }
  return { patch }
}
