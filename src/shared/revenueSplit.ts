/**
 * Répartition entre associés : toujours 50/50 sur une mission commune (décision de Sacha, 25/11/2026).
 * Module pur, sans dépendance au front ni à l'API.
 *
 * - Les associés sont les deux émetteurs actifs (`billing_issuers`) ; chacun est relié à un membre par
 *   `member_id`, à défaut par le prénom du membre dans le nom d'affichage de l'émetteur.
 * - Mission commune : projet dont les membres (`project_members`) comptent les deux associés, ou projet
 *   sans membre déclaré (une facture sans projet est donc commune aussi).
 * - Facture payée d'une mission commune : l'émetteur qui a encaissé doit la moitié du HT à l'autre.
 *   Le mois est celui de `paid_at` (jour de Paris).
 * - Avoir : il se déduit au mois de son émission, seulement si la facture créditée avait été payée
 *   (sinon rien n'a été encaissé, il n'y a rien à rendre).
 * - Factures émises au nom de l'organisation (sans émetteur) : hors répartition.
 */
import { formatMoney, roundHalfAwayFromZero, todayIso } from './billing.js'
import type { InvoiceKind, InvoiceStatus } from './types.js'

export interface SplitInvoice {
  id: string
  kind: InvoiceKind
  status: InvoiceStatus
  issuer_id: string | null
  project_id: string | null
  paid_at: string | null
  issue_date: string | null
  total_ht_cents: number
  credited_invoice_id: string | null
  /**
   * Date de paiement de la facture créditée, quand elle n'est pas dans la liste fournie (autre année).
   * `undefined` : à chercher dans la liste ; `null` : jamais payée.
   */
  credited_paid_at?: string | null
}

export interface SplitIssuer {
  id: string
  display_name: string
  member_id: string | null
  archived_at: string | null
}

export interface SplitMember {
  id: string
  name: string
}

export interface SplitInput {
  invoices: readonly SplitInvoice[]
  issuers: readonly SplitIssuer[]
  members: readonly SplitMember[]
  /** Membres déclarés par projet (`project_members`). Un projet absent = aucun membre déclaré. */
  projectMembers: Readonly<Record<string, readonly string[]>>
}

export interface SplitEntry {
  invoiceId: string
  /** AAAA-MM. */
  month: string
  /** Émetteur qui a encaissé (ou émis l'avoir). */
  collectorIssuerId: string
  /** Moitié du HT, en centimes ; négatif pour un avoir. Due par l'autre associé à `collectorIssuerId`. */
  halfCents: number
}

export interface SplitMonth {
  month: string
  /** Ce que le premier associé doit au second ce mois-ci (négatif : c'est l'inverse). */
  firstOwesSecondCents: number
  invoiceCount: number
}

export interface RevenueSplit {
  /** Faux s'il n'y a pas exactement deux émetteurs actifs : rien n'est réparti. */
  applicable: boolean
  partners: [SplitIssuer, SplitIssuer] | null
  months: SplitMonth[]
  /** Solde de l'année : ce que le premier associé doit au second (négatif : c'est l'inverse). */
  firstOwesSecondCents: number
  /** Total HT encaissé sur missions communes (net des avoirs), toutes personnes confondues. */
  commonHtCents: number
}

/* ---------- Associés et missions communes ---------- */

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Premier mot du nom (« Sacha Moricet EI » → « Sacha »). */
export function partnerName(issuer: Pick<SplitIssuer, 'display_name'>): string {
  return issuer.display_name.trim().split(/\s+/)[0] ?? issuer.display_name
}

/** Membre de l'émetteur : `member_id`, sinon le seul membre dont le prénom figure dans le nom de l'émetteur. */
export function issuerMemberId(issuer: SplitIssuer, members: readonly SplitMember[]): string | null {
  if (issuer.member_id) return issuer.member_id
  const label = normalize(issuer.display_name)
  const matches = members.filter((m) => {
    const first = normalize(m.name.trim().split(/\s+/)[0] ?? '')
    return first.length >= 3 && label.includes(first)
  })
  return matches.length === 1 ? (matches[0]?.id ?? null) : null
}

/** Les deux associés : exactement deux émetteurs non archivés, sinon `null`. */
export function partnersOf(issuers: readonly SplitIssuer[]): [SplitIssuer, SplitIssuer] | null {
  const active = issuers.filter((i) => i.archived_at === null)
  const [a, b] = active
  return active.length === 2 && a && b ? [a, b] : null
}

/** Mission commune : aucun membre déclaré, ou les deux associés parmi eux. */
export function isCommonMission(
  projectId: string | null,
  partnerMemberIds: readonly [string | null, string | null],
  projectMembers: Readonly<Record<string, readonly string[]>>,
): boolean {
  const declared = projectId ? (projectMembers[projectId] ?? []) : []
  if (declared.length === 0) return true
  return partnerMemberIds.every((id) => id !== null && declared.includes(id))
}

/* ---------- Écritures ---------- */

function monthOfTimestamp(value: string): string {
  return todayIso(new Date(value)).slice(0, 7)
}

function monthOfDate(value: string): string {
  return value.length === 10 ? value.slice(0, 7) : monthOfTimestamp(value)
}

/** Vrai si la facture créditée par cet avoir avait été payée (seul cas où l'avoir rend de l'argent). */
export function creditedWasPaid(credit: SplitInvoice, byId: ReadonlyMap<string, SplitInvoice>): boolean {
  if (credit.credited_paid_at !== undefined) return credit.credited_paid_at !== null
  const credited = credit.credited_invoice_id ? byId.get(credit.credited_invoice_id) : undefined
  return credited?.paid_at != null
}

/** Écritures de répartition (sans filtre d'année) : une par facture encaissée ou avoir sur mission commune. */
export function splitEntries(input: SplitInput): SplitEntry[] {
  const partners = partnersOf(input.issuers)
  if (!partners) return []
  const memberIds: [string | null, string | null] = [
    issuerMemberId(partners[0], input.members),
    issuerMemberId(partners[1], input.members),
  ]
  const partnerIds = new Set(partners.map((p) => p.id))
  const byId = new Map(input.invoices.map((i) => [i.id, i]))
  const entries: SplitEntry[] = []

  for (const invoice of input.invoices) {
    if (!invoice.issuer_id || !partnerIds.has(invoice.issuer_id)) continue
    if (!isCommonMission(invoice.project_id, memberIds, input.projectMembers)) continue

    if (invoice.kind === 'credit_note') {
      if (invoice.status === 'draft' || !invoice.issue_date || !creditedWasPaid(invoice, byId)) continue
      const half = roundHalfAwayFromZero(-Math.abs(invoice.total_ht_cents) / 2)
      entries.push({ invoiceId: invoice.id, month: monthOfDate(invoice.issue_date), collectorIssuerId: invoice.issuer_id, halfCents: half })
      continue
    }
    // Payée, ou annulée après paiement (paid_at est conservé : l'avoir la compense).
    if (invoice.paid_at === null || (invoice.status !== 'paid' && invoice.status !== 'cancelled')) continue
    entries.push({
      invoiceId: invoice.id,
      month: monthOfTimestamp(invoice.paid_at),
      collectorIssuerId: invoice.issuer_id,
      halfCents: roundHalfAwayFromZero(invoice.total_ht_cents / 2),
    })
  }
  return entries
}

/** Solde par mois et sur l'année civile `year`. */
export function computeRevenueSplit(input: SplitInput, year: number): RevenueSplit {
  const partners = partnersOf(input.issuers)
  if (!partners) return { applicable: false, partners: null, months: [], firstOwesSecondCents: 0, commonHtCents: 0 }
  const [first] = partners
  const prefix = `${year}-`
  const months = new Map<string, SplitMonth>()
  let total = 0
  let commonHt = 0

  for (const entry of splitEntries(input)) {
    if (!entry.month.startsWith(prefix)) continue
    // Le premier associé doit à l'autre quand l'autre a encaissé, et inversement.
    const signed = entry.collectorIssuerId === first.id ? -entry.halfCents : entry.halfCents
    const row = months.get(entry.month) ?? { month: entry.month, firstOwesSecondCents: 0, invoiceCount: 0 }
    row.firstOwesSecondCents += signed
    row.invoiceCount += 1
    months.set(entry.month, row)
    total += signed
    commonHt += entry.halfCents * 2
  }

  return {
    applicable: true,
    partners,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    firstOwesSecondCents: total,
    commonHtCents: commonHt,
  }
}

/** « Sacha doit 1 200 € à Maël », « Maël doit … à Sacha » ou « Comptes équilibrés ». */
export function balanceSentence(firstOwesSecondCents: number, partners: readonly [SplitIssuer, SplitIssuer]): string {
  if (firstOwesSecondCents === 0) return 'Comptes équilibrés'
  const [first, second] = partners
  const debtor = firstOwesSecondCents > 0 ? first : second
  const creditor = firstOwesSecondCents > 0 ? second : first
  return `${partnerName(debtor)} doit ${formatMoney(Math.abs(firstOwesSecondCents))} à ${partnerName(creditor)}`
}
