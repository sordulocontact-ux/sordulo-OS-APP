/**
 * Chiffres du mois et de l'année, calculés en code (serveur MCP « finance_summary » et commande vocale).
 * Mêmes règles que l'Accueil (src/features/home/homeLogic.ts) : encaissé = factures et acomptes payés, en HT,
 * par date de paiement (heure de Paris) ; les avoirs ne sont jamais encaissés ; impayés = émis non payés, en TTC.
 */
import type { Invoice } from '../../../src/shared/types.js'

export type FinanceInvoice = Pick<Invoice, 'kind' | 'status' | 'due_date' | 'paid_at' | 'total_ht_cents' | 'total_ttc_cents'>

export interface FinanceSummary {
  /** Date du calcul, AAAA-MM-JJ (Paris). */
  today: string
  /** AAAA-MM */
  month: string
  /** AAAA */
  year: string
  collectedMonthCents: number
  collectedYearCents: number
  unpaidCount: number
  unpaidCents: number
  overdueCount: number
  overdueCents: number
}

const parisFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Date AAAA-MM-JJ à Paris. */
export function parisDate(date: Date): string {
  return parisFormatter.format(date)
}

export function financeSummary(invoices: readonly FinanceInvoice[], today: string): FinanceSummary {
  const month = today.slice(0, 7)
  const year = today.slice(0, 4)
  const summary: FinanceSummary = {
    today,
    month,
    year,
    collectedMonthCents: 0,
    collectedYearCents: 0,
    unpaidCount: 0,
    unpaidCents: 0,
    overdueCount: 0,
    overdueCents: 0,
  }
  for (const invoice of invoices) {
    if (invoice.kind === 'credit_note') continue
    if (invoice.status === 'paid' && invoice.paid_at) {
      const paidOn = parisDate(new Date(invoice.paid_at))
      if (paidOn.startsWith(year)) summary.collectedYearCents += invoice.total_ht_cents
      if (paidOn.startsWith(month)) summary.collectedMonthCents += invoice.total_ht_cents
    } else if (invoice.status === 'issued') {
      summary.unpaidCount += 1
      summary.unpaidCents += invoice.total_ttc_cents
      if (invoice.due_date && invoice.due_date < today) {
        summary.overdueCount += 1
        summary.overdueCents += invoice.total_ttc_cents
      }
    }
  }
  return summary
}

/** 123456 → « 1 234,56 € », 300000 → « 3 000 € ». */
export function formatEuros(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100)
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « 2026-11 » → « novembre 2026 ». */
export function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`
}

/** Phrases lisibles du résumé (texte de l'outil MCP, contexte de la commande vocale). */
export function financeLines(summary: FinanceSummary): string[] {
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
  return [
    `Encaissé en ${monthLabel(summary.month)} : ${formatEuros(summary.collectedMonthCents)} HT.`,
    `Encaissé depuis le 1er janvier ${summary.year} : ${formatEuros(summary.collectedYearCents)} HT.`,
    summary.unpaidCount === 0
      ? 'Aucune facture impayée.'
      : `Impayés : ${plural(summary.unpaidCount, 'facture')} pour ${formatEuros(summary.unpaidCents)} TTC` +
        (summary.overdueCount > 0 ? `, dont ${summary.overdueCount} en retard (${formatEuros(summary.overdueCents)} TTC).` : '.'),
  ]
}
