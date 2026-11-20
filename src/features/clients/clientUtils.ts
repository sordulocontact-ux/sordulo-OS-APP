import { normalizeSiret } from '../../shared/siret'
import type { Client, ClientContact } from '../../shared/types'

/** Nom comparable : sans casse, sans accents, espaces superflus retirés. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Valeur trimée ; vide devient null (colonnes facultatives en base). */
export function trimOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** SIRET affiché par groupes 3-3-3-5 (« 123 456 789 00012 ») ; une valeur incomplète est rendue telle quelle. */
export function formatSiret(value: string | null): string | null {
  if (!value) return null
  const siret = normalizeSiret(value)
  if (!/^\d{14}$/.test(siret)) return value
  return `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`
}

/** Ajoute https:// si le schéma est omis ; vide devient null. */
export function normalizeWebsite(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/** Message d'erreur pour un site web saisi, ou null s'il est vide ou plausible. */
export function websiteError(raw: string): string | null {
  const url = normalizeWebsite(raw)
  if (url === null) return null
  try {
    const { hostname } = new URL(url)
    return hostname.includes('.') ? null : 'Cette adresse de site ne semble pas valide.'
  } catch {
    return 'Cette adresse de site ne semble pas valide.'
  }
}

/** Lien externe sûr : seulement http(s), sinon null (une valeur en base n'est jamais de confiance). */
export function safeHref(url: string | null): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : null
}

/** Validation simple d'un email (vide accepté). */
export function emailError(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Cet email ne semble pas valide.'
}

export type DuplicateReason = 'name' | 'siret'

export interface DuplicateMatch {
  client: Client
  reason: DuplicateReason
}

/** Premier client (archivé compris) au même SIRET, sinon au même nom. Le SIRET prime : il est plus fiable. */
export function findDuplicate(
  clients: readonly Pick<Client, 'id' | 'name' | 'siret' | 'organization_id' | 'archived_at'>[],
  candidate: { name: string; siret: string },
  excludeId?: string,
): { client: (typeof clients)[number]; reason: DuplicateReason } | null {
  const name = normalizeName(candidate.name)
  const siret = normalizeSiret(candidate.siret)
  const others = clients.filter((c) => c.id !== excludeId)
  if (siret !== '') {
    const bySiret = others.find((c) => c.siret !== null && normalizeSiret(c.siret) === siret)
    if (bySiret) return { client: bySiret, reason: 'siret' }
  }
  if (name !== '') {
    const byName = others.find((c) => normalizeName(c.name) === name)
    if (byName) return { client: byName, reason: 'name' }
  }
  return null
}

/** Contact principal d'une liste, s'il y en a un. */
export function primaryContact(contacts: readonly ClientContact[]): ClientContact | null {
  return contacts.find((c) => c.is_primary) ?? null
}

/** Recherche sur nom, ville, SIRET, nom ou email de contact. Requête vide : tout passe. */
export function matchesQuery(
  client: Pick<Client, 'name' | 'billing_city' | 'siret'>,
  contacts: readonly Pick<ClientContact, 'name' | 'email'>[],
  query: string,
): boolean {
  const q = normalizeName(query)
  if (q === '') return true
  const digits = normalizeSiret(query)
  const haystack = [client.name, client.billing_city ?? '', ...contacts.flatMap((c) => [c.name, c.email ?? ''])].map(normalizeName)
  if (haystack.some((text) => text.includes(q))) return true
  return /^\d+$/.test(digits) && client.siret !== null && normalizeSiret(client.siret).includes(digits)
}

/** Fiche à compléter pour les devis : SIRET absent ou adresse de facturation (rue, code postal, ville) incomplète. */
export function needsCompletion(client: Pick<Client, 'siret' | 'billing_street' | 'billing_postal_code' | 'billing_city'>): boolean {
  const missing = (value: string | null) => value === null || value.trim() === ''
  return (
    missing(client.siret) || missing(client.billing_street) || missing(client.billing_postal_code) || missing(client.billing_city)
  )
}

export interface ClientStats {
  active: number
  withOngoingProject: number
  withoutPrimaryContact: number
  toComplete: number
}

/** Chiffres des clients non archivés. `projectStatuses` : statuts des projets du client. */
export function clientStats(
  clients: readonly (Pick<Client, 'archived_at' | 'siret' | 'billing_street' | 'billing_postal_code' | 'billing_city'> & {
    contacts: readonly Pick<ClientContact, 'is_primary'>[]
    project_statuses: readonly { status: string }[]
  })[],
): ClientStats {
  const stats: ClientStats = { active: 0, withOngoingProject: 0, withoutPrimaryContact: 0, toComplete: 0 }
  for (const c of clients) {
    if (c.archived_at) continue
    stats.active += 1
    if (c.project_statuses.some((p) => p.status === 'in_progress')) stats.withOngoingProject += 1
    if (!c.contacts.some((contact) => contact.is_primary)) stats.withoutPrimaryContact += 1
    if (needsCompletion(c)) stats.toComplete += 1
  }
  return stats
}
