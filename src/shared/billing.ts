/**
 * Facturation : calculs, formats, validation et textes légaux des devis et factures.
 * Module pur, sans dépendance (partagé front / API). Les règles de calcul sont EXACTEMENT celles du
 * trigger SQL de la migration 0004 (la base reste la source de vérité, ce module sert à l'aperçu) :
 * HT ligne = arrondi(quantité × PU) ; TVA = par taux, arrondi(somme HT du taux × taux / 100) ;
 * TTC = HT + TVA ; arrondi demi vers l'extérieur.
 */
import {
  LABELS,
  type Client,
  type ClientContact,
  type DocumentLine,
  type DocumentTotals,
  type Invoice,
  type InvoiceBuyer,
  type InvoiceKind,
  type InvoiceSeller,
  type LineUnit,
  type Organization,
  type Quote,
} from './types.js'

/* ---------- Arrondis et totaux ---------- */

/** Arrondi à l'entier, les demis s'éloignent de zéro (2,5 → 3 ; -2,5 → -3), comme `round` de Postgres sur numeric. */
export function roundHalfAwayFromZero(x: number): number {
  // toFixed(6) absorbe le bruit des flottants (0,15 × 10 050 = 1507,4999999999998).
  const abs = Number(Math.abs(x).toFixed(6))
  const rounded = Math.round(abs)
  return rounded === 0 ? 0 : Math.sign(x) * rounded
}

/** Total HT d'une ligne en centimes. */
export function lineHtCents(line: Pick<DocumentLine, 'quantity' | 'unit_price_cents'>): number {
  return roundHalfAwayFromZero(line.quantity * line.unit_price_cents)
}

export interface VatBreakdown {
  rate: number
  base_cents: number
  vat_cents: number
}

export interface ComputedTotals extends DocumentTotals {
  /** Un élément par taux présent, du plus petit au plus grand. */
  vatByRate: VatBreakdown[]
}

export function computeTotals(lines: readonly DocumentLine[]): ComputedTotals {
  const bases = new Map<number, number>()
  for (const line of lines) {
    bases.set(line.vat_rate, (bases.get(line.vat_rate) ?? 0) + lineHtCents(line))
  }
  const vatByRate = [...bases.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, base_cents]) => ({ rate, base_cents, vat_cents: roundHalfAwayFromZero((base_cents * rate) / 100) }))
  const total_ht_cents = vatByRate.reduce((sum, r) => sum + r.base_cents, 0)
  const total_vat_cents = vatByRate.reduce((sum, r) => sum + r.vat_cents, 0)
  return { total_ht_cents, total_vat_cents, total_ttc_cents: total_ht_cents + total_vat_cents, vatByRate }
}

/* ---------- Montants, quantités, taux : formats français ---------- */

const moneyFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const decimalFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** 123450 → « 1 234,50 € » (espaces insécables d'Intl : voulu, le montant ne se coupe pas en fin de ligne). */
export function formatMoney(cents: number): string {
  return moneyFormat.format(cents / 100)
}

export type ParseResult = { ok: true; value: number } | { ok: false; error: string }

function cleanNumberText(raw: string): string {
  return raw
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/€/g, '')
    .replace(',', '.')
}

/** Saisie d'un montant en euros (« 1 234,5 », « 12.50 », « -80 ») → centimes. */
export function parseMoneyInput(raw: string): ParseResult {
  const text = cleanNumberText(raw)
  if (text === '') return { ok: false, error: 'Saisis un montant.' }
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Montant invalide (ex. 1 234,50).' }
  return { ok: true, value: roundHalfAwayFromZero(Number(text) * 100) }
}

/** Centimes → texte de saisie sans symbole ni séparateur de milliers (« 1234,5 » → 123450 → « 1234,50 »). */
export function moneyInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** 1.5 → « 1,5 » ; 2 → « 2 ». */
export function formatQuantity(quantity: number): string {
  return decimalFormat.format(quantity)
}

/** Quantité > 0, virgule ou point, 2 décimales au plus. */
export function parseQuantity(raw: string): ParseResult {
  const text = cleanNumberText(raw)
  if (text === '') return { ok: false, error: 'Saisis une quantité.' }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Quantité invalide (2 décimales au plus).' }
  const value = Number(text)
  if (value <= 0) return { ok: false, error: 'La quantité doit être supérieure à 0.' }
  return { ok: true, value }
}

/** Taux de TVA en %, virgule ou point, 0 à 100, 2 décimales au plus. */
export function parseVatRate(raw: string): ParseResult {
  const text = cleanNumberText(raw)
  if (text === '') return { ok: false, error: 'Saisis un taux.' }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Taux invalide (ex. 20 ou 5,5).' }
  const value = Number(text)
  if (value > 100) return { ok: false, error: 'La TVA va de 0 à 100 %.' }
  return { ok: true, value }
}

/** 5.5 → « 5,5 % ». */
export function formatRate(rate: number): string {
  return `${decimalFormat.format(rate)} %`
}

/* ---------- Dates (chaînes AAAA-MM-JJ) ---------- */

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

function splitIso(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** '2026-11-20' → « 20/11/2026 ». Une valeur illisible est renvoyée telle quelle. */
export function formatDate(iso: string): string {
  const p = splitIso(iso)
  return p ? formatParts(p) : iso
}

function formatParts([y, m, d]: [number, number, number]): string {
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

/** '2026-11-20' → « 20 novembre 2026 » (« 1er » pour le premier du mois). */
export function formatLongDate(iso: string): string {
  const p = splitIso(iso)
  if (!p) return iso
  const [y, m, d] = p
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1] ?? ''} ${y}`
}

/** Aujourd'hui en AAAA-MM-JJ, jour Europe/Paris (comme la base). */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now,
  )
}

function dayNumber(iso: string): number | null {
  const p = splitIso(iso)
  return p ? Date.UTC(p[0], p[1] - 1, p[2]) / 86_400_000 : null
}

/** Ajoute des jours à une date AAAA-MM-JJ. */
export function addDays(iso: string, days: number): string {
  const n = dayNumber(iso)
  if (n === null) return iso
  return new Date((n + days) * 86_400_000).toISOString().slice(0, 10)
}

/* ---------- Lignes : valeurs par défaut et validation ---------- */

/** Nouvelle ligne : PU par défaut du taux journalier ou horaire de l'organisation (euros → centimes), TVA par défaut. */
export function defaultLine(
  org: Pick<Organization, 'default_daily_rate' | 'default_hourly_rate' | 'default_vat_rate'>,
  unit: LineUnit = 'day',
): DocumentLine {
  const euros = unit === 'day' ? org.default_daily_rate : unit === 'hour' ? org.default_hourly_rate : null
  return {
    label: '',
    description: null,
    quantity: 1,
    unit,
    unit_price_cents: euros === null ? 0 : roundHalfAwayFromZero(euros * 100),
    vat_rate: org.default_vat_rate,
  }
}

export type LineField = 'label' | 'quantity' | 'unit_price' | 'vat_rate'
export type LineErrors = Partial<Record<LineField, string>>

/** Une entrée par ligne (objet vide = ligne valide). `allowNegative` : avoir, prix négatif permis. */
export function validateLines(lines: readonly DocumentLine[], options: { allowNegative?: boolean } = {}): LineErrors[] {
  return lines.map((line) => {
    const errors: LineErrors = {}
    if (line.label.trim() === '') errors.label = 'Indique une désignation.'
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) errors.quantity = 'La quantité doit être supérieure à 0.'
    if (!Number.isInteger(line.unit_price_cents)) errors.unit_price = 'Prix invalide.'
    else if (line.unit_price_cents < 0 && !options.allowNegative) errors.unit_price = 'Le prix ne peut pas être négatif.'
    if (!Number.isFinite(line.vat_rate) || line.vat_rate < 0 || line.vat_rate > 100) errors.vat_rate = 'La TVA va de 0 à 100 %.'
    return errors
  })
}

export function hasLineErrors(errors: readonly LineErrors[]): boolean {
  return errors.some((e) => Object.keys(e).length > 0)
}

/* ---------- Statuts calculés ---------- */

export type QuoteDisplayStatus = 'draft' | 'sent' | 'expired' | 'accepted' | 'refused'

/** « Expiré » = envoyé et date de validité passée. `today` : AAAA-MM-JJ (`todayIso()`). */
export function quoteDisplayStatus(quote: Pick<Quote, 'status' | 'valid_until'>, today: string): QuoteDisplayStatus {
  if (quote.status === 'sent' && quote.valid_until !== null && quote.valid_until < today) return 'expired'
  return quote.status
}

/** Émise, non payée, échéance dépassée. */
export function isOverdue(invoice: Pick<Invoice, 'status' | 'due_date'>, today: string): boolean {
  return invoice.status === 'issued' && invoice.due_date !== null && invoice.due_date < today
}

/** Jours de retard (0 si la facture n'est pas en retard). */
export function daysLate(invoice: Pick<Invoice, 'status' | 'due_date'>, today: string): number {
  if (!isOverdue(invoice, today) || invoice.due_date === null) return 0
  const due = dayNumber(invoice.due_date)
  const now = dayNumber(today)
  return due === null || now === null ? 0 : now - due
}

/* ---------- Brouillons dérivés ---------- */

export type InvoiceDraft = Pick<
  Invoice,
  'client_id' | 'project_id' | 'quote_id' | 'kind' | 'title' | 'lines' | 'deposit_percent' | 'notes'
>

export type QuoteDraft = Pick<Quote, 'client_id' | 'project_id' | 'title' | 'lines' | 'notes'> & { status: 'draft' }

export function isValidDepositPercent(percent: number): boolean {
  return Number.isFinite(percent) && percent >= 1 && percent <= 100
}

/**
 * Facture depuis un devis. `invoice` : toutes les lignes du devis. `deposit` : une ligne forfaitaire par taux
 * de TVA présent, au prorata (« Acompte de 30 % sur le devis D-2026-001 »), montants arrondis comme les totaux.
 */
export function invoiceFromQuote(
  quote: Pick<Quote, 'client_id' | 'project_id' | 'id' | 'number' | 'title' | 'lines' | 'notes'>,
  options: { kind: 'invoice' | 'deposit'; percent?: number },
): InvoiceDraft {
  const base = { client_id: quote.client_id, project_id: quote.project_id, quote_id: quote.id, notes: quote.notes }
  if (options.kind === 'invoice') {
    return { ...base, kind: 'invoice', title: quote.title, lines: quote.lines.map((l) => ({ ...l })), deposit_percent: null }
  }
  const percent = options.percent
  if (percent === undefined || !isValidDepositPercent(percent)) {
    throw new RangeError("Le pourcentage d'acompte doit être compris entre 1 et 100.")
  }
  const pct = decimalFormat.format(percent)
  const label = `Acompte de ${pct} % sur le devis ${quote.number}`
  const lines: DocumentLine[] = computeTotals(quote.lines).vatByRate.map((r) => ({
    label,
    description: `Part du devis soumise à une TVA de ${formatRate(r.rate)}`,
    quantity: 1,
    unit: 'flat',
    unit_price_cents: roundHalfAwayFromZero((r.base_cents * percent) / 100),
    vat_rate: r.rate,
  }))
  return { ...base, kind: 'deposit', title: `Acompte de ${pct} % : ${quote.title}`, lines, deposit_percent: percent }
}

/** Copie d'un devis en brouillon (sans numéro : la base en attribue un). */
export function duplicateQuote(
  quote: Pick<Quote, 'client_id' | 'project_id' | 'title' | 'lines' | 'notes'>,
): QuoteDraft {
  return {
    client_id: quote.client_id,
    project_id: quote.project_id,
    title: `${quote.title} (copie)`,
    status: 'draft',
    lines: quote.lines.map((l) => ({ ...l })),
    notes: quote.notes,
  }
}

/* ---------- Vendeur et acheteur pour l'aperçu d'un brouillon ---------- */

export function sellerFromOrganization(org: Organization): InvoiceSeller {
  return {
    name: org.name,
    legal_name: org.legal_name,
    legal_form: org.legal_form,
    siret: org.siret,
    address_street: org.address_street,
    address_postal_code: org.address_postal_code,
    address_city: org.address_city,
    address_country: org.address_country,
    vat_mention: org.vat_mention,
    bank_iban: org.bank_iban,
    bank_bic: org.bank_bic,
  }
}

export function buyerFromClient(client: Client, primaryContact: ClientContact | null): InvoiceBuyer {
  return {
    name: client.name,
    siret: client.siret,
    billing_street: client.billing_street,
    billing_postal_code: client.billing_postal_code,
    billing_city: client.billing_city,
    billing_country: client.billing_country,
    contact_name: primaryContact?.name ?? null,
    contact_email: primaryContact?.email ?? null,
  }
}

/* ---------- Mentions légales ---------- */

export interface LegalMentionsInput {
  kind: 'quote' | InvoiceKind
  seller: Pick<InvoiceSeller, 'vat_mention' | 'bank_iban' | 'bank_bic'> | null
  /** Facture : échéance (AAAA-MM-JJ). */
  dueDate?: string | null
  /** Facture : date d'émission, pour reconnaître un paiement à réception (échéance = émission). */
  issueDate?: string | null
  /** Devis : date de validité. */
  validUntil?: string | null
  /** TVA totale en centimes : la mention d'exonération n'apparaît que si elle vaut 0. */
  vatTotal: number
}

export const LATE_PENALTY_MENTION =
  'En cas de retard de paiement : pénalités au taux de trois fois le taux d’intérêt légal, et indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce)'

export function legalMentions(input: LegalMentionsInput): string[] {
  const lines: string[] = []
  const vatMention = input.seller?.vat_mention?.trim()
  const vatLine = input.vatTotal === 0 && vatMention ? vatMention : null

  if (input.kind === 'quote') {
    if (input.validUntil) lines.push(`Devis valable jusqu’au ${formatDate(input.validUntil)}`)
    if (vatLine) lines.push(vatLine)
    lines.push('Bon pour accord (date et signature)')
    return lines
  }

  if (input.kind !== 'credit_note' && input.dueDate) {
    lines.push(
      input.issueDate && input.dueDate <= input.issueDate
        ? 'Paiement à réception'
        : `À payer avant le ${formatDate(input.dueDate)}`,
    )
  }
  if (input.kind !== 'credit_note') {
    lines.push('Pas d’escompte pour paiement anticipé')
    lines.push(LATE_PENALTY_MENTION)
  }
  if (vatLine) lines.push(vatLine)
  if (input.kind !== 'credit_note') {
    const iban = input.seller?.bank_iban?.trim()
    const bic = input.seller?.bank_bic?.trim()
    if (iban) lines.push(`IBAN : ${iban}`)
    if (bic) lines.push(`BIC : ${bic}`)
  }
  return lines
}

/* ---------- Export CSV comptable ---------- */

export const INVOICES_CSV_HEADER = [
  'Numéro',
  'Type',
  'Date',
  'Échéance',
  'Client',
  'SIRET client',
  'HT',
  'TVA',
  'TTC',
  'Statut',
  'Payée le',
] as const

function csvText(value: string): string {
  // Neutralise l'injection de formule dans Excel / Sheets (cellule commençant par = + - @).
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** Factures non brouillon, séparateur `;`, BOM UTF-8, virgule décimale, dates JJ/MM/AAAA, fins de ligne CRLF. */
export function invoicesCsv(
  invoices: readonly Invoice[],
  clientsById: Readonly<Record<string, Pick<Client, 'name' | 'siret'>>>,
): string {
  const rows: string[] = [INVOICES_CSV_HEADER.map(csvText).join(';')]
  for (const inv of invoices) {
    if (inv.status === 'draft') continue
    const client = clientsById[inv.client_id]
    const name = inv.buyer?.name ?? client?.name ?? ''
    const siret = inv.buyer?.siret ?? client?.siret ?? ''
    rows.push(
      [
        csvText(inv.number ?? ''),
        csvText(LABELS.invoiceKind[inv.kind]),
        inv.issue_date ? formatDate(inv.issue_date) : '',
        inv.due_date ? formatDate(inv.due_date) : '',
        csvText(name),
        csvText(siret),
        csvAmount(inv.total_ht_cents),
        csvAmount(inv.total_vat_cents),
        csvAmount(inv.total_ttc_cents),
        csvText(LABELS.invoiceStatus[inv.status]),
        inv.paid_at ? formatDate(inv.paid_at.slice(0, 10)) : '',
      ].join(';'),
    )
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`
}
