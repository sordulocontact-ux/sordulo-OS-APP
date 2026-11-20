import type { BadgeTone } from '../../components/ui'
import { isValidDepositPercent, quoteDisplayStatus, validateLines, hasLineErrors, type QuoteDisplayStatus } from '../../shared/billing'
import type { DocumentLine, Invoice, Quote, QuoteStatus } from '../../shared/types'

/** Devis de la liste ou de la fiche, avec le client et le projet liés. */
export type QuoteWithLinks = Quote & {
  client: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

/** Statuts affichables (« Expiré » est calculé, il n'existe pas en base). */
export const QUOTE_DISPLAY_STATUSES: readonly QuoteDisplayStatus[] = ['draft', 'sent', 'expired', 'accepted', 'refused']

export const QUOTE_DISPLAY_LABELS: Record<QuoteDisplayStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  expired: 'Expiré',
  accepted: 'Accepté',
  refused: 'Refusé',
}

export const QUOTE_DISPLAY_TONE: Record<QuoteDisplayStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  expired: 'warning',
  accepted: 'success',
  refused: 'danger',
}

export function parseStatusParam(value: string | null): QuoteDisplayStatus | '' {
  return QUOTE_DISPLAY_STATUSES.find((s) => s === value) ?? ''
}

export interface QuoteFilters {
  query: string
  status: QuoteDisplayStatus | ''
  clientId: string
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Recherche par numéro, titre ou client ; filtres statut (affiché) et client. */
export function filterQuotes(quotes: readonly QuoteWithLinks[], filters: QuoteFilters, today: string): QuoteWithLinks[] {
  const query = normalize(filters.query)
  return quotes.filter((q) => {
    if (filters.status && quoteDisplayStatus(q, today) !== filters.status) return false
    if (filters.clientId && q.client_id !== filters.clientId) return false
    if (!query) return true
    return [q.number, q.title, q.client?.name ?? ''].some((text) => normalize(text).includes(query))
  })
}

/** Plus récents d'abord (date du devis, puis création). */
export function sortQuotes<T extends Pick<Quote, 'issue_date' | 'created_at'>>(quotes: readonly T[]): T[] {
  return [...quotes].sort((a, b) =>
    a.issue_date === b.issue_date ? b.created_at.localeCompare(a.created_at) : b.issue_date.localeCompare(a.issue_date),
  )
}

export interface QuoteStats {
  /** Envoyés non expirés : somme TTC et nombre. */
  pending: { cents: number; count: number }
  /** Acceptés pendant l'année en cours. */
  accepted: { cents: number; count: number }
  /** Refusés ou expirés. */
  lost: { cents: number; count: number }
  /** Année utilisée pour « Acceptés ». */
  year: string
}

/** Date d'acceptation, à défaut la date du devis (AAAA-MM-JJ). */
function acceptedDay(q: Pick<Quote, 'accepted_at' | 'issue_date'>): string {
  return (q.accepted_at ?? q.issue_date).slice(0, 10)
}

export function quoteStats(quotes: readonly Quote[], today: string): QuoteStats {
  const year = today.slice(0, 4)
  const stats: QuoteStats = {
    pending: { cents: 0, count: 0 },
    accepted: { cents: 0, count: 0 },
    lost: { cents: 0, count: 0 },
    year,
  }
  for (const q of quotes) {
    const shown = quoteDisplayStatus(q, today)
    if (shown === 'sent') {
      stats.pending.cents += q.total_ttc_cents
      stats.pending.count += 1
    } else if (shown === 'accepted' && acceptedDay(q).startsWith(year)) {
      stats.accepted.cents += q.total_ttc_cents
      stats.accepted.count += 1
    } else if (shown === 'refused' || shown === 'expired') {
      stats.lost.cents += q.total_ttc_cents
      stats.lost.count += 1
    }
  }
  return stats
}

/** « 1 devis » / « 3 devis ». */
export function countLabel(count: number): string {
  return `${count} devis`
}

/* ---------- Transitions de statut ---------- */

const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'refused', 'draft'],
  accepted: [],
  refused: [],
}

export function allowedTransitions(status: QuoteStatus): readonly QuoteStatus[] {
  return TRANSITIONS[status]
}

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Un devis accepté ou refusé est figé (la base refuse aussi toute modification). */
export function isQuoteLocked(status: QuoteStatus): boolean {
  return status === 'accepted' || status === 'refused'
}

/** Seul un brouillon se supprime. */
export function canDeleteQuote(status: QuoteStatus): boolean {
  return status === 'draft'
}

/** Colonnes à écrire pour passer à un statut (horodatages comme la base les attend). */
export function transitionPatch(to: QuoteStatus, nowIso: string): Record<string, string | null> {
  switch (to) {
    case 'draft':
      return { status: 'draft', sent_at: null }
    case 'sent':
      return { status: 'sent', sent_at: nowIso }
    case 'accepted':
      return { status: 'accepted', accepted_at: nowIso }
    case 'refused':
      return { status: 'refused', refused_at: nowIso }
  }
}

/* ---------- Édition ---------- */

export interface QuoteDraftFields {
  title: string
  lines: DocumentLine[]
  notes: string
  validUntil: string
}

/** Valeurs éditables d'un devis enregistré. */
export function fieldsOf(quote: Pick<Quote, 'title' | 'lines' | 'notes' | 'valid_until'>): QuoteDraftFields {
  return { title: quote.title, lines: quote.lines, notes: quote.notes ?? '', validUntil: quote.valid_until ?? '' }
}

export function hasUnsavedChanges(saved: QuoteDraftFields, draft: QuoteDraftFields): boolean {
  return (
    saved.title !== draft.title ||
    saved.notes !== draft.notes ||
    saved.validUntil !== draft.validUntil ||
    JSON.stringify(saved.lines) !== JSON.stringify(draft.lines)
  )
}

export interface QuoteFormErrors {
  title?: string
  lines?: string
  validUntil?: string
}

export function validateQuoteFields(fields: QuoteDraftFields, issueDate: string): QuoteFormErrors {
  const errors: QuoteFormErrors = {}
  if (fields.title.trim() === '') errors.title = 'Donne un titre au devis.'
  if (fields.lines.length === 0) errors.lines = 'Ajoute au moins une ligne.'
  else if (hasLineErrors(validateLines(fields.lines))) errors.lines = 'Corrige les lignes signalées avant d’enregistrer.'
  if (fields.validUntil !== '' && fields.validUntil < issueDate) {
    errors.validUntil = 'La date de validité ne peut pas précéder la date du devis.'
  }
  return errors
}

/** Pourcentage d'acompte saisi (virgule ou point) ; null si illisible ou hors 1 à 100. */
export function parseDepositPercent(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  const value = Number(normalized)
  return isValidDepositPercent(value) ? value : null
}

/* ---------- Facture de solde ---------- */

export type QuoteDeposit = Pick<Invoice, 'id' | 'number' | 'status' | 'lines' | 'created_at'>

export const DRAFT_DEPOSIT_WARNING = 'L’acompte en brouillon n’est pas déduit : émets-le d’abord.'

/**
 * Acomptes d'un devis : `deducted` = émis ou payés (déduits de la facture de solde, par numéro croissant),
 * `drafts` = brouillons (non déduits, à signaler). Les annulés (par un avoir) sont ignorés.
 */
export function splitQuoteDeposits<T extends Pick<Invoice, 'number' | 'status'>>(
  deposits: readonly T[],
): { deducted: T[]; drafts: T[] } {
  const deducted = deposits
    .filter((d) => d.status === 'issued' || d.status === 'paid')
    .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''))
  const drafts = deposits.filter((d) => d.status === 'draft')
  return { deducted, drafts }
}

/** Libellé du bouton de facturation d'un devis accepté. */
export function finalInvoiceLabel(deductedCount: number): string {
  return deductedCount > 0 ? 'Créer la facture de solde' : 'Créer la facture'
}

/* ---------- Erreurs ---------- */

/** Message français pour une erreur Supabase ou autre. */
export function quoteErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const lower = message.toLowerCase()
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'Seuls les admins et la finance peuvent modifier les devis.'
  }
  if (lower.includes('accepted') || lower.includes('refused') || lower.includes('accepté') || lower.includes('refusé')) {
    return 'Ce devis est accepté ou refusé : il ne peut plus être modifié ni supprimé. Duplique-le pour repartir d’une copie.'
  }
  if (code === '23503') return 'Le client ou le projet choisi n’existe plus.'
  if (code === '23505') return 'Un devis porte déjà ce numéro. Réessaie.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}
