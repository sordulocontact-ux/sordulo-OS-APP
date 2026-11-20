/** Logique pure des émetteurs de facturation (micro-entreprises, sociétés) : formulaire, validation, affichage, choix. */
import { formatSiret } from '../../shared/vat'
import { normalizeSiret, siretError } from '../../shared/siret'
import type { BillingIssuer } from '../../shared/types'
import { bicError, formatIban, ibanError, normalizeBic, normalizeIban } from './settingsLogic'

/** Colonnes saisies d'un émetteur (le reste est géré par la base). */
export type IssuerValues = Pick<
  BillingIssuer,
  | 'member_id' | 'display_name' | 'legal_name' | 'legal_form' | 'siret' | 'address_street' | 'address_postal_code'
  | 'address_city' | 'address_country' | 'vat_mention' | 'vat_number' | 'bank_iban' | 'bank_bic' | 'email' | 'phone'
>

/** Valeurs du formulaire : tout en texte, comme saisi. */
export interface IssuerForm {
  displayName: string
  memberId: string
  legalName: string
  legalForm: string
  siret: string
  street: string
  postalCode: string
  city: string
  country: string
  vatMention: string
  vatNumber: string
  iban: string
  bic: string
  email: string
  phone: string
}

export type IssuerFormErrors = Partial<Record<keyof IssuerForm, string>>

export const EMPTY_ISSUER_FORM: IssuerForm = {
  displayName: '',
  memberId: '',
  legalName: '',
  legalForm: '',
  siret: '',
  street: '',
  postalCode: '',
  city: '',
  country: '',
  vatMention: '',
  vatNumber: '',
  iban: '',
  bic: '',
  email: '',
  phone: '',
}

export function toIssuerForm(issuer: BillingIssuer | null): IssuerForm {
  if (!issuer) return EMPTY_ISSUER_FORM
  return {
    displayName: issuer.display_name,
    memberId: issuer.member_id ?? '',
    legalName: issuer.legal_name ?? '',
    legalForm: issuer.legal_form ?? '',
    siret: issuer.siret ? formatSiret(issuer.siret) : '',
    street: issuer.address_street ?? '',
    postalCode: issuer.address_postal_code ?? '',
    city: issuer.address_city ?? '',
    country: issuer.address_country ?? '',
    vatMention: issuer.vat_mention ?? '',
    vatNumber: issuer.vat_number ?? '',
    iban: formatIban(issuer.bank_iban ?? ''),
    bic: issuer.bank_bic ?? '',
    email: issuer.email ?? '',
    phone: issuer.phone ?? '',
  }
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/** Adresse e-mail plausible (une arobase, un point dans le domaine, sans espace) ; vide accepté. */
export function emailError(raw: string): string | null {
  const email = raw.trim()
  if (email === '') return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : 'Cette adresse e-mail n’est pas valide.'
}

/** Valide le formulaire et renvoie les colonnes à écrire (champs vides = null), ou les erreurs. */
export function buildIssuerValues(form: IssuerForm): { errors: IssuerFormErrors } | { values: IssuerValues } {
  const errors: IssuerFormErrors = {}
  if (form.displayName.trim() === '') errors.displayName = 'Le nom affiché est obligatoire.'
  const siret = siretError(form.siret)
  if (siret) errors.siret = siret
  const iban = ibanError(form.iban)
  if (iban) errors.iban = iban
  const bic = bicError(form.bic)
  if (bic) errors.bic = bic
  const email = emailError(form.email)
  if (email) errors.email = email
  if (Object.keys(errors).length > 0) return { errors }
  return {
    values: {
      member_id: form.memberId === '' ? null : form.memberId,
      display_name: form.displayName.trim(),
      legal_name: orNull(form.legalName),
      legal_form: orNull(form.legalForm),
      siret: normalizeSiret(form.siret) || null,
      address_street: orNull(form.street),
      address_postal_code: orNull(form.postalCode),
      address_city: orNull(form.city),
      address_country: orNull(form.country),
      vat_mention: orNull(form.vatMention),
      vat_number: orNull(form.vatNumber),
      bank_iban: normalizeIban(form.iban) || null,
      bank_bic: normalizeBic(form.bic) || null,
      email: orNull(form.email),
      phone: orNull(form.phone),
    },
  }
}

/** IBAN masqué : seuls les 4 derniers caractères restent lisibles (« •••• 0189 »). Vide si pas d'IBAN. */
export function maskIban(iban: string | null | undefined): string {
  const clean = normalizeIban(iban ?? '')
  if (clean === '') return ''
  return clean.length <= 4 ? clean : `•••• ${clean.slice(-4)}`
}

/** Défaut d'abord, actifs ensuite, archivés en dernier ; puis par nom. */
export function sortIssuers<T extends Pick<BillingIssuer, 'is_default' | 'archived_at' | 'display_name'>>(issuers: readonly T[]): T[] {
  const rank = (i: T) => (i.archived_at ? 2 : i.is_default ? 0 : 1)
  return [...issuers].sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name, 'fr'))
}

/** Émetteurs proposés à la création d'un document (non archivés), défaut en tête. */
export function activeIssuers<T extends Pick<BillingIssuer, 'is_default' | 'archived_at' | 'display_name'>>(issuers: readonly T[]): T[] {
  return sortIssuers(issuers.filter((i) => !i.archived_at))
}

/** Émetteur présélectionné : le défaut, à défaut le premier actif ; '' s'il n'y en a aucun. */
export function defaultIssuerId(issuers: readonly Pick<BillingIssuer, 'id' | 'is_default' | 'archived_at' | 'display_name'>[]): string {
  return activeIssuers(issuers)[0]?.id ?? ''
}

/**
 * Émetteurs proposés dans un Select de fiche : les actifs, plus l'émetteur actuel du document s'il est archivé
 * (pour ne pas le faire disparaître de la liste).
 */
export function issuerChoices<T extends Pick<BillingIssuer, 'id' | 'is_default' | 'archived_at' | 'display_name'>>(
  issuers: readonly T[],
  currentId: string | null,
): T[] {
  return sortIssuers(issuers.filter((i) => !i.archived_at || i.id === currentId))
}

/** Le sélecteur n'a de sens qu'avec au moins deux choix. */
export function showIssuerSelect(choices: readonly unknown[]): boolean {
  return choices.length > 1
}

/** Nom affiché d'un émetteur par son id, ou null s'il est inconnu (ou illisible pour ce rôle). */
export function issuerName(issuers: readonly Pick<BillingIssuer, 'id' | 'display_name'>[], id: string | null): string | null {
  if (!id) return null
  return issuers.find((i) => i.id === id)?.display_name ?? null
}

/** Ligne de détail d'une carte : raison sociale (ou forme) et SIRET groupé. */
export function issuerSubtitle(issuer: Pick<BillingIssuer, 'legal_name' | 'legal_form' | 'siret'>): string {
  const name = [issuer.legal_name?.trim(), issuer.legal_form?.trim()].filter(Boolean).join(', ')
  const siret = issuer.siret ? `SIRET ${formatSiret(issuer.siret)}` : ''
  return [name, siret].filter(Boolean).join(' · ')
}

/** Message d'erreur en français pour une écriture d'émetteur refusée. */
export function issuerErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501' || /row-level security|permission denied|^Seuls les admins/i.test(message)) {
    return 'Seuls les admins peuvent gérer les émetteurs.'
  }
  if (code === '23505') return 'Un seul émetteur peut être celui par défaut. Réessaie.'
  return 'Impossible d’enregistrer l’émetteur. Réessaie.'
}
