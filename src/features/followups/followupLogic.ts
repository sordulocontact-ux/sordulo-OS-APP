/**
 * Relances : quels devis et factures relancer, et dans quel état est leur relance. Module pur.
 * - Devis : envoyé, sans réponse depuis 7 jours ou plus (expiré compris : sans réponse aussi).
 * - Facture : émise, non payée, échéance dépassée (avoirs exclus).
 * - Un document déjà relancé (« envoyée ») ou ignoré ne revient pas avant 7 jours.
 */
import { todayIso } from '../../shared/billing'
import { FOLLOWUP_COOLDOWN_DAYS } from '../../shared/ai/followupDraft'
import type { Followup, FollowupTargetType, Invoice, Quote } from '../../shared/types'

/** Délai sans réponse avant de relancer un devis, en jours. */
export const QUOTE_WAIT_DAYS = 7

export type FollowupQuote = Pick<Quote, 'id' | 'number' | 'title' | 'status' | 'sent_at' | 'issue_date' | 'total_ttc_cents' | 'client_id'> & {
  client: { name: string } | null
}
export type FollowupInvoice = Pick<Invoice, 'id' | 'number' | 'title' | 'kind' | 'status' | 'due_date' | 'total_ttc_cents' | 'client_id'> & {
  client: { name: string } | null
}
export interface FollowupContact {
  client_id: string
  name: string
  email: string | null
  is_primary: boolean
}
export type FollowupRecord = Pick<Followup, 'id' | 'target_type' | 'target_id' | 'draft' | 'status' | 'sent_at' | 'updated_at'>

export interface FollowupItem {
  key: string
  type: FollowupTargetType
  id: string
  number: string
  title: string
  clientName: string
  amountTtcCents: number
  /** Jours sans réponse (devis) ou de retard (facture). */
  days: number
  /** Brouillon en cours, le cas échéant. */
  draft: FollowupRecord | null
  /** Email du contact principal (à défaut le premier contact qui en a un). */
  email: string | null
}

/** Jours entiers entre deux dates AAAA-MM-JJ (négatif si `to` précède `from`). */
export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

/** Jour (Paris) d'un horodatage ou d'une date. */
function dayOf(value: string): string {
  return value.length === 10 ? value : todayIso(new Date(value))
}

function contactEmail(contacts: readonly FollowupContact[], clientId: string): string | null {
  const own = contacts.filter((c) => c.client_id === clientId && c.email)
  return (own.find((c) => c.is_primary) ?? own[0])?.email ?? null
}

/** Dernière relance envoyée ou ignorée du document, assez récente pour le laisser tranquille. */
function inCooldown(records: readonly FollowupRecord[], today: string): boolean {
  return records.some((r) => {
    if (r.status === 'draft') return false
    const at = r.status === 'sent' ? (r.sent_at ?? r.updated_at) : r.updated_at
    return dayDiff(dayOf(at), today) < FOLLOWUP_COOLDOWN_DAYS
  })
}

/** Documents à relancer aujourd'hui, du plus ancien au plus récent. */
export function buildFollowupItems(
  quotes: readonly FollowupQuote[],
  invoices: readonly FollowupInvoice[],
  followups: readonly FollowupRecord[],
  contacts: readonly FollowupContact[],
  today: string,
): FollowupItem[] {
  const byTarget = new Map<string, FollowupRecord[]>()
  for (const f of followups) {
    const key = `${f.target_type}:${f.target_id}`
    byTarget.set(key, [...(byTarget.get(key) ?? []), f])
  }
  const items: FollowupItem[] = []

  for (const q of quotes) {
    if (q.status !== 'sent') continue
    const days = dayDiff(dayOf(q.sent_at ?? q.issue_date), today)
    if (days < QUOTE_WAIT_DAYS) continue
    const records = byTarget.get(`quote:${q.id}`) ?? []
    if (inCooldown(records, today)) continue
    items.push({
      key: `quote:${q.id}`,
      type: 'quote',
      id: q.id,
      number: q.number,
      title: q.title,
      clientName: q.client?.name ?? 'Client',
      amountTtcCents: q.total_ttc_cents,
      days,
      draft: records.find((r) => r.status === 'draft') ?? null,
      email: contactEmail(contacts, q.client_id),
    })
  }

  for (const i of invoices) {
    if (i.status !== 'issued' || i.kind === 'credit_note' || i.due_date === null) continue
    const days = dayDiff(i.due_date, today)
    if (days <= 0) continue
    const records = byTarget.get(`invoice:${i.id}`) ?? []
    if (inCooldown(records, today)) continue
    items.push({
      key: `invoice:${i.id}`,
      type: 'invoice',
      id: i.id,
      number: i.number ?? 'Sans numéro',
      title: i.title,
      clientName: i.client?.name ?? 'Client',
      amountTtcCents: i.total_ttc_cents,
      days,
      draft: records.find((r) => r.status === 'draft') ?? null,
      email: contactEmail(contacts, i.client_id),
    })
  }

  // Factures en retard d'abord (l'argent dû), puis par ancienneté.
  return items.sort((a, b) => (a.type === b.type ? b.days - a.days : a.type === 'invoice' ? -1 : 1))
}

/** « Sans réponse depuis 9 jours » / « En retard de 12 jours ». */
export function waitingLabel(item: Pick<FollowupItem, 'type' | 'days'>): string {
  const unit = item.days > 1 ? 'jours' : 'jour'
  return item.type === 'quote' ? `Sans réponse depuis ${item.days} ${unit}` : `En retard de ${item.days} ${unit}`
}
