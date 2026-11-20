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
  }
  const patch: OrganizationPatch = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (next[key] !== org[key]) Object.assign(patch, { [key]: next[key] })
  }
  return { patch }
}
