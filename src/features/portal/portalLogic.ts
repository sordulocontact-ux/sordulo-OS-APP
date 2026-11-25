/**
 * Logique pure du portail client : jeton du lien, adresse publique, avancement, libellés vus par le
 * client, nom mémorisé sur l'appareil du client.
 */
import type { BadgeTone } from '../../components/ui'
import { PORTAL_LIMITS, PORTAL_TOKEN_PATTERN, type PortalContract, type PortalInvoice, type PortalQuote } from './portalContract'

/** Octets d'aléa du jeton (256 bits) : 43 caractères en base64url. */
export const PORTAL_TOKEN_BYTES = 32

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Jeton aléatoire (WebCrypto) au format accepté par la base. */
export function generatePortalToken(): string {
  const bytes = new Uint8Array(PORTAL_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export function isPortalToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && PORTAL_TOKEN_PATTERN.test(value)
}

/**
 * Adresse publique de l'app pour le lien. Dans l'app de bureau, l'origine est celle de la webview
 * (tauri://localhost) : on prend alors l'URL de production (VITE_API_BASE_URL).
 */
export function publicAppOrigin(origin: string, apiBase: string | undefined): string {
  const desktop = origin.startsWith('tauri:') || /^https?:\/\/tauri\.localhost$/.test(origin)
  const base = desktop ? (apiBase ?? '').trim() : origin
  return (base || origin).replace(/\/+$/, '')
}

export function portalUrl(origin: string, token: string): string {
  return `${origin}/p/${token}`
}

/** Pourcentage arrondi des tâches faites ; null sans tâche. */
export function progressPercent(done: number, total: number): number | null {
  if (total <= 0) return null
  return Math.round((Math.min(done, total) / total) * 100)
}

/* ---------- Libellés vus par le client ---------- */

export function quoteClientStatus(quote: Pick<PortalQuote, 'status' | 'expired'>): { label: string; tone: BadgeTone } {
  if (quote.status === 'accepted') return { label: 'Accepté', tone: 'success' }
  if (quote.expired) return { label: 'Expiré', tone: 'neutral' }
  return { label: 'En attente de votre accord', tone: 'warning' }
}

export function contractClientStatus(contract: Pick<PortalContract, 'status'>): { label: string; tone: BadgeTone } {
  return contract.status === 'signed' ? { label: 'Signé', tone: 'success' } : { label: 'À signer', tone: 'warning' }
}

export function invoiceClientStatus(invoice: Pick<PortalInvoice, 'status' | 'overdue'>): { label: string; tone: BadgeTone } {
  if (invoice.status === 'paid') return { label: 'Payée', tone: 'success' }
  if (invoice.overdue) return { label: 'En retard', tone: 'danger' }
  return { label: 'À régler', tone: 'warning' }
}

export const INVOICE_KIND_CLIENT_LABEL: Record<PortalInvoice['kind'], string> = {
  invoice: 'Facture',
  deposit: 'Acompte',
  credit_note: 'Avoir',
}

/** Ce qui attend une action du client (compteur en tête de page). */
export function pendingActions(data: {
  deliverables: readonly { versions: readonly { version: number; status: string }[] }[]
  quotes: readonly Pick<PortalQuote, 'status' | 'expired'>[]
  contracts: readonly Pick<PortalContract, 'status'>[]
}): number {
  const toReview = data.deliverables.filter((d) => {
    const latest = d.versions.reduce<{ version: number; status: string } | null>(
      (best, v) => (best === null || v.version > best.version ? v : best),
      null,
    )
    return latest?.status === 'pending'
  }).length
  const quotes = data.quotes.filter((q) => q.status === 'sent' && !q.expired).length
  const contracts = data.contracts.filter((c) => c.status === 'sent').length
  return toReview + quotes + contracts
}

/* ---------- Nom du client mémorisé (localStorage, peut être indisponible) ---------- */

export const CLIENT_NAME_KEY = 'sordulo.portal.clientName'

type NameStorage = Pick<Storage, 'getItem' | 'setItem'>

function storage(): NameStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readClientName(store: NameStorage | null = storage()): string {
  try {
    return (store?.getItem(CLIENT_NAME_KEY) ?? '').slice(0, PORTAL_LIMITS.name)
  } catch {
    return ''
  }
}

export function saveClientName(name: string, store: NameStorage | null = storage()): void {
  try {
    store?.setItem(CLIENT_NAME_KEY, name.trim().slice(0, PORTAL_LIMITS.name))
  } catch {
    // Navigation privée ou stockage bloqué : le nom sera simplement redemandé.
  }
}
