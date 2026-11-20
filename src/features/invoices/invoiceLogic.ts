/** Logique pure des écrans Factures : filtres, cartes de chiffres, statut affiché, conditions d'émission, erreurs. */
import { daysLate, isOverdue, NEGATIVE_INVOICE_TOTAL_ERROR, type LineErrors } from '../../shared/billing'
import {
  INVOICE_KINDS,
  LABELS,
  type Client,
  type Invoice,
  type InvoiceKind,
  type InvoiceStatus,
  type Organization,
} from '../../shared/types'

/** Statut affiché : « en retard » est calculé (émise et échéance passée). */
export type InvoiceDisplayStatus = InvoiceStatus | 'overdue'

export function invoiceDisplayStatus(invoice: Pick<Invoice, 'status' | 'due_date'>, today: string): InvoiceDisplayStatus {
  return isOverdue(invoice, today) ? 'overdue' : invoice.status
}

export const DISPLAY_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: LABELS.invoiceStatus.draft,
  issued: LABELS.invoiceStatus.issued,
  overdue: 'En retard',
  paid: LABELS.invoiceStatus.paid,
  cancelled: LABELS.invoiceStatus.cancelled,
}

export const DISPLAY_STATUSES: readonly InvoiceDisplayStatus[] = ['draft', 'issued', 'overdue', 'paid', 'cancelled']

export type InvoiceTone = 'neutral' | 'info' | 'danger' | 'success'

export const DISPLAY_STATUS_TONE: Record<InvoiceDisplayStatus, InvoiceTone> = {
  draft: 'neutral',
  issued: 'info',
  overdue: 'danger',
  paid: 'success',
  cancelled: 'neutral',
}

/** Libellé de la pastille : « En retard de 12 j » pour une facture en retard. */
export function statusBadgeLabel(invoice: Pick<Invoice, 'status' | 'due_date'>, today: string): string {
  const status = invoiceDisplayStatus(invoice, today)
  if (status !== 'overdue') return DISPLAY_STATUS_LABELS[status]
  return `En retard de ${daysLate(invoice, today)} j`
}

/** Numéro, ou « Brouillon » tant que la facture n'est pas émise. */
export function invoiceNumberLabel(invoice: Pick<Invoice, 'number'>): string {
  return invoice.number ?? 'Brouillon'
}

/** Seconde ligne d'une facture : « Acompte : Site vitrine », sans doubler le type s'il ouvre déjà le titre (« Avoir sur F-2026-0002 »). */
export function invoiceSecondLine(invoice: Pick<Invoice, 'kind' | 'title'>): string {
  const label = LABELS.invoiceKind[invoice.kind]
  const title = invoice.title.trim()
  if (title.toLocaleLowerCase('fr').startsWith(label.toLocaleLowerCase('fr'))) return title
  return `${label} : ${title}`
}

/* ---------- Filtres (dans l'URL) ---------- */

export interface InvoiceFilters {
  query: string
  status: InvoiceDisplayStatus | ''
  kind: InvoiceKind | ''
  clientId: string
}

export const EMPTY_FILTERS: InvoiceFilters = { query: '', status: '', kind: '', clientId: '' }

export function filtersFromParams(params: URLSearchParams): InvoiceFilters {
  const status = params.get('statut') ?? ''
  const kind = params.get('type') ?? ''
  return {
    query: params.get('q') ?? '',
    status: (DISPLAY_STATUSES as readonly string[]).includes(status) ? (status as InvoiceDisplayStatus) : '',
    kind: (INVOICE_KINDS as readonly string[]).includes(kind) ? (kind as InvoiceKind) : '',
    clientId: params.get('client') ?? '',
  }
}

/** Reporte les filtres dans les paramètres existants (les valeurs vides sont retirées). */
export function filtersToParams(filters: InvoiceFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(base)
  const set = (key: string, value: string) => {
    if (value === '') next.delete(key)
    else next.set(key, value)
  }
  set('q', filters.query)
  set('statut', filters.status)
  set('type', filters.kind)
  set('client', filters.clientId)
  return next
}

export function activeFilterCount(filters: InvoiceFilters): number {
  return (filters.status !== '' ? 1 : 0) + (filters.kind !== '' ? 1 : 0) + (filters.clientId !== '' ? 1 : 0)
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export type InvoiceRow = Invoice & { client: Pick<Client, 'id' | 'name' | 'siret'> | null }

/** Recherche sur le numéro, le titre et le nom du client. */
export function matchesInvoice(invoice: InvoiceRow, filters: InvoiceFilters, today: string): boolean {
  if (filters.status !== '' && invoiceDisplayStatus(invoice, today) !== filters.status) return false
  if (filters.kind !== '' && invoice.kind !== filters.kind) return false
  if (filters.clientId !== '' && invoice.client_id !== filters.clientId) return false
  const q = normalize(filters.query)
  if (q === '') return true
  return [invoice.number ?? '', invoice.title, invoice.client?.name ?? ''].some((v) => normalize(v).includes(q))
}

/** Brouillons en tête (les plus récents d'abord), puis par date d'émission décroissante. */
export function sortInvoices<T extends Pick<Invoice, 'status' | 'issue_date' | 'created_at'>>(invoices: readonly T[]): T[] {
  return [...invoices].sort((a, b) => {
    const aDraft = a.status === 'draft'
    const bDraft = b.status === 'draft'
    if (aDraft !== bDraft) return aDraft ? -1 : 1
    const aDate = aDraft ? a.created_at : (a.issue_date ?? a.created_at)
    const bDate = bDraft ? b.created_at : (b.issue_date ?? b.created_at)
    if (aDate !== bDate) return aDate < bDate ? 1 : -1
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
}

/* ---------- Cartes de chiffres ---------- */

export interface InvoiceStats {
  toCollectCents: number
  toCollectCount: number
  overdueCents: number
  overdueCount: number
  collectedThisMonthCents: number
}

/** Date AAAA-MM-JJ d'un horodatage ISO, en jour de Paris (comme `todayIso`). */
function parisDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** À encaisser : TTC des émises non payées (hors avoirs). En retard : sous-ensemble. Encaissé : payées ce mois. */
export function invoiceStats(invoices: readonly Invoice[], today: string): InvoiceStats {
  const stats: InvoiceStats = {
    toCollectCents: 0,
    toCollectCount: 0,
    overdueCents: 0,
    overdueCount: 0,
    collectedThisMonthCents: 0,
  }
  const month = today.slice(0, 7)
  for (const inv of invoices) {
    if (inv.kind === 'credit_note') continue
    if (inv.status === 'issued') {
      stats.toCollectCents += inv.total_ttc_cents
      stats.toCollectCount += 1
      if (isOverdue(inv, today)) {
        stats.overdueCents += inv.total_ttc_cents
        stats.overdueCount += 1
      }
    } else if (inv.status === 'paid' && inv.paid_at && parisDay(inv.paid_at).slice(0, 7) === month) {
      stats.collectedThisMonthCents += inv.total_ttc_cents
    }
  }
  return stats
}

export function countLabel(count: number): string {
  return `${count} ${count > 1 ? 'factures' : 'facture'}`
}

/* ---------- Émission ---------- */

export function hasBillingAddress(
  client: Pick<Client, 'billing_street' | 'billing_postal_code' | 'billing_city'>,
): boolean {
  return [client.billing_street, client.billing_postal_code, client.billing_city].every((v) => Boolean(v && v.trim()))
}

export interface IssueCheck {
  /** Bloquants : l'émission est refusée. */
  blockers: { code: 'lines' | 'empty' | 'total' | 'address'; message: string }[]
  /** Avertissements : l'émission reste possible. */
  warnings: { code: 'legal'; message: string }[]
}

/** `totalError` : total négatif d'une facture (`validateInvoiceLines`, même règle que la base). */
export function issueCheck(input: {
  lines: readonly unknown[]
  lineErrors: readonly LineErrors[]
  totalError?: string | null
  client: Pick<Client, 'billing_street' | 'billing_postal_code' | 'billing_city'> | null
  organization: Pick<Organization, 'siret' | 'legal_name'> | null
}): IssueCheck {
  const blockers: IssueCheck['blockers'] = []
  const warnings: IssueCheck['warnings'] = []
  if (input.lines.length === 0) blockers.push({ code: 'empty', message: 'Ajoute au moins une ligne avant d’émettre la facture.' })
  else if (input.lineErrors.some((e) => Object.keys(e).length > 0)) {
    blockers.push({ code: 'lines', message: 'Corrige les lignes en erreur avant d’émettre la facture.' })
  } else if (input.totalError) {
    blockers.push({ code: 'total', message: input.totalError })
  }
  if (!input.client || !hasBillingAddress(input.client)) {
    blockers.push({ code: 'address', message: 'Le client n’a pas d’adresse de facturation complète (rue, code postal, ville).' })
  }
  const org = input.organization
  if (!org || !org.siret?.trim() || !org.legal_name?.trim()) {
    warnings.push({
      code: 'legal',
      message: 'Le SIRET ou la raison sociale de ton organisation manque : ils figureront en blanc sur la facture.',
    })
  }
  return { blockers, warnings }
}

/* ---------- Erreurs et fichiers ---------- */

/** Message d'erreur Supabase traduit en français. */
export function invoiceErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Seuls les admins et la finance peuvent modifier les factures.'
  }
  if (/^Seuls les admins/.test(message)) return message
  if (/ne peut plus être modifiée/i.test(message)) return 'Une facture émise ne peut plus être modifiée : crée un avoir.'
  if (/seule une facture en brouillon/i.test(message)) return 'Seul un brouillon peut être supprimé : pour annuler une facture émise, crée un avoir.'
  if (/annulée ne peut plus/i.test(message)) return 'Une facture annulée ne peut plus changer de statut.'
  if (/total d.une facture ne peut pas être négatif/i.test(message)) return NEGATIVE_INVOICE_TOTAL_ERROR
  if (/adresse de facturation/i.test(message)) return 'Le client n’a pas d’adresse de facturation : complète sa fiche.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

export function csvFileName(today: string): string {
  return `factures-${today}.csv`
}

/** Factures à exporter : les filtrées, sans les brouillons. */
export function exportableInvoices<T extends Pick<Invoice, 'status'>>(invoices: readonly T[]): T[] {
  return invoices.filter((i) => i.status !== 'draft')
}
