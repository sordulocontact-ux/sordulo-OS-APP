/**
 * Finance : CA encaissé (net des avoirs), encaissements récents, impayés, CA par émetteur et par année.
 * Module pur (pas de React, pas de Supabase).
 *
 * « Encaissé » = facture ou acompte payé, au HT, au jour de Paris de `paid_at` ; une facture annulée après
 * paiement garde son `paid_at` (son avoir la compense). Un avoir d'une facture payée se déduit au mois de
 * son émission ; l'avoir d'une facture jamais payée ne change rien.
 */
import { isOverdue, daysLate, todayIso } from '../../shared/billing'
import { creditedWasPaid, type SplitInvoice } from '../../shared/revenueSplit'
import type { BillingIssuer, Invoice } from '../../shared/types'
import { thresholdStatuses, thresholdsFor, worstThreshold, type ThresholdStatus, type YearThresholds } from '../../shared/thresholds'
import { shortMonth, type MonthBar } from '../home/homeLogic'

export type FinanceInvoice = Pick<
  Invoice,
  | 'id'
  | 'number'
  | 'kind'
  | 'status'
  | 'issuer_id'
  | 'project_id'
  | 'client_id'
  | 'credited_invoice_id'
  | 'title'
  | 'issue_date'
  | 'due_date'
  | 'paid_at'
  | 'total_ht_cents'
  | 'total_ttc_cents'
> & {
  client: { name: string } | null
  /** Paiement de la facture créditée, quand elle est hors de la liste chargée (voir `SplitInvoice`). */
  credited_paid_at?: string | null
}

/** Jour (AAAA-MM-JJ, Paris) d'un horodatage. */
export function parisDay(timestamp: string): string {
  return todayIso(new Date(timestamp))
}

export interface CollectionEvent {
  invoiceId: string
  issuerId: string | null
  /** AAAA-MM. */
  month: string
  /** Centimes HT : positif pour un encaissement, négatif pour un avoir d'une facture payée. */
  cents: number
}

/** Encaissements et remboursements (avoirs) d'une année civile. */
export function collectionEvents(invoices: readonly FinanceInvoice[], year: number): CollectionEvent[] {
  const byId = new Map<string, SplitInvoice>(invoices.map((i) => [i.id, i as SplitInvoice]))
  const prefix = `${year}-`
  const events: CollectionEvent[] = []
  for (const i of invoices) {
    if (i.status === 'draft') continue
    if (i.kind === 'credit_note') {
      if (!i.issue_date || !creditedWasPaid(i as SplitInvoice, byId)) continue
      const month = i.issue_date.slice(0, 7)
      if (month.startsWith(prefix)) events.push({ invoiceId: i.id, issuerId: i.issuer_id, month, cents: -Math.abs(i.total_ht_cents) })
      continue
    }
    if (i.paid_at === null || (i.status !== 'paid' && i.status !== 'cancelled')) continue
    const month = parisDay(i.paid_at).slice(0, 7)
    if (month.startsWith(prefix)) events.push({ invoiceId: i.id, issuerId: i.issuer_id, month, cents: i.total_ht_cents })
  }
  return events
}

/** Les 12 mois de l'année : encaissé net et facturé (HT, avoirs déduits), au format du graphique de l'Accueil. */
export function yearBars(invoices: readonly FinanceInvoice[], year: number): MonthBar[] {
  const keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const bars = new Map<string, MonthBar>(keys.map((key) => [key, { key, label: shortMonth(key), collectedCents: 0, invoicedCents: 0 }]))
  for (const event of collectionEvents(invoices, year)) {
    const bar = bars.get(event.month)
    if (bar) bar.collectedCents += event.cents
  }
  for (const i of invoices) {
    if (i.status === 'draft' || !i.issue_date) continue
    const bar = bars.get(i.issue_date.slice(0, 7))
    if (bar) bar.invoicedCents += i.kind === 'credit_note' ? -Math.abs(i.total_ht_cents) : i.total_ht_cents
  }
  return keys.map((key) => bars.get(key) as MonthBar)
}

/** Encaissé net de l'année par émetteur (clé `null` : factures de l'organisation, sans émetteur). */
export function collectedByIssuer(invoices: readonly FinanceInvoice[], year: number): Map<string | null, number> {
  const totals = new Map<string | null, number>()
  for (const event of collectionEvents(invoices, year)) totals.set(event.issuerId, (totals.get(event.issuerId) ?? 0) + event.cents)
  return totals
}

export function totalCents(bars: readonly MonthBar[]): number {
  return bars.reduce((sum, bar) => sum + bar.collectedCents, 0)
}

/** Derniers paiements reçus (factures et acomptes), du plus récent au plus ancien. */
export function recentPayments(invoices: readonly FinanceInvoice[], limit = 8): FinanceInvoice[] {
  return invoices
    .filter((i) => i.kind !== 'credit_note' && i.status === 'paid' && i.paid_at !== null)
    .sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))
    .slice(0, limit)
}

/** Factures émises non payées : en retard d'abord (le plus en retard en tête), puis par échéance. */
export function unpaidInvoices(invoices: readonly FinanceInvoice[], today: string): FinanceInvoice[] {
  return invoices
    .filter((i) => i.status === 'issued' && i.kind !== 'credit_note')
    .sort((a, b) => {
      const lateA = isOverdue(a, today)
      const lateB = isOverdue(b, today)
      if (lateA !== lateB) return lateA ? -1 : 1
      return (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31')
    })
}

export interface UnpaidSummary {
  count: number
  totalCents: number
  overdueCount: number
  overdueCents: number
}

export function unpaidSummary(invoices: readonly FinanceInvoice[], today: string): UnpaidSummary {
  const open = unpaidInvoices(invoices, today)
  const late = open.filter((i) => isOverdue(i, today))
  return {
    count: open.length,
    totalCents: open.reduce((sum, i) => sum + i.total_ttc_cents, 0),
    overdueCount: late.length,
    overdueCents: late.reduce((sum, i) => sum + i.total_ttc_cents, 0),
  }
}

export { daysLate }

/** Années proposées dans le sélecteur : l'année en cours et les deux précédentes. */
export function yearOptions(now: Date = new Date()): number[] {
  const year = Number(todayIso(now).slice(0, 4))
  return [year, year - 1, year - 2]
}

export interface IssuerThresholds {
  issuer: Pick<BillingIssuer, 'id' | 'display_name'>
  collectedCents: number
  statuses: ThresholdStatus[]
  /** Jauge la plus préoccupante (80 % ou plus), `null` si tout va bien. */
  worst: ThresholdStatus | null
  thresholds: YearThresholds
}

/**
 * CA encaissé de l'année par émetteur face aux seuils. Émetteurs actifs, plus les archivés qui ont encaissé
 * dans l'année ; les factures de l'organisation (sans émetteur) n'ont pas de seuil.
 */
export function issuerThresholds(
  invoices: readonly FinanceInvoice[],
  issuers: readonly Pick<BillingIssuer, 'id' | 'display_name' | 'archived_at'>[],
  year: number,
): IssuerThresholds[] {
  const totals = collectedByIssuer(invoices, year)
  const thresholds = thresholdsFor(year)
  return issuers
    .filter((issuer) => issuer.archived_at === null || (totals.get(issuer.id) ?? 0) !== 0)
    .map((issuer) => {
      const collectedCents = totals.get(issuer.id) ?? 0
      const statuses = thresholdStatuses(collectedCents, thresholds)
      return { issuer, collectedCents, statuses, worst: worstThreshold(statuses), thresholds }
    })
}
