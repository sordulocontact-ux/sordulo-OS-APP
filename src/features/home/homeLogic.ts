/**
 * Accueil : agrégats et phrases des cartes. Module pur (pas de React, pas de Supabase) pour être testé.
 * Les phrases sont des segments : `strong` = élément important (nom, chiffre, action), le reste est en gris.
 */
import type { Invoice, Member, Prospect, Quote, Task } from '../../shared/types'
import { isOverdue, quoteDisplayStatus } from '../../shared/billing'
import { teamStats } from '../team/teamLogic'

export interface Segment {
  text: string
  strong?: boolean
}
export type Sentence = Segment[]

const s = (text: string): Segment => ({ text })
const b = (text: string): Segment => ({ text, strong: true })

/** Texte brut d'une phrase (tests, aria-label). */
export function plain(sentence: Sentence): string {
  return sentence.map((part) => part.text).join('')
}

/* ---------- Formats ---------- */

const wholeEuroFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const euroFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

/** 1240000 → « 12 400 € » ; 123450 → « 1 234,50 € » (les centimes ne s'affichent que s'ils existent). */
export function formatEuros(cents: number): string {
  return (cents % 100 === 0 ? wholeEuroFormat : euroFormat).format(cents / 100)
}

/** « 1 devis », « 2 devis », « 0 facture ». */
export function plural(count: number, singular: string, pluralForm = singular.endsWith('s') ? singular : `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

/** Premier mot du nom (« Sacha Moricet » → « Sacha »). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/* ---------- Dates ---------- */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** AAAA-MM du jour local. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** Les `count` derniers mois, du plus ancien au mois courant. */
export function lastMonths(now: Date, count = 6): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
  return keys
}

/** Premier jour (AAAA-MM-01) de la fenêtre des `count` derniers mois. */
export function windowStartIso(now: Date, count = 6): string {
  return `${lastMonths(now, count)[0] ?? monthKey(now)}-01`
}

const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

/** « 2026-06 » → « juin » (« juil. », « nov. » : libellé court). */
export function shortMonth(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return monthLabel.format(new Date(year ?? 1970, (month ?? 1) - 1, 1))
}

/** Mois (AAAA-MM) d'une date AAAA-MM-JJ ou d'un horodatage ISO (jour local pour l'horodatage). */
export function monthOf(value: string): string {
  if (value.length === 10) return value.slice(0, 7)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value.slice(0, 7) : monthKey(date)
}

/** Lundi 00:00 (local) de la semaine de `now`, en ISO. */
export function weekStartIso(now: Date): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  return monday.toISOString()
}

/* ---------- Devis ---------- */

export type HomeQuote = Pick<Quote, 'id' | 'number' | 'status' | 'valid_until' | 'total_ttc_cents' | 'accepted_at'> & {
  client: { name: string } | null
}

export interface PendingQuotes {
  count: number
  totalCents: number
}

/** Devis envoyés et encore valides (un devis expiré n'est plus « en attente »). Montant TTC. */
export function pendingQuotes(quotes: readonly HomeQuote[], today: string): PendingQuotes {
  const pending = quotes.filter((q) => quoteDisplayStatus(q, today) === 'sent')
  return { count: pending.length, totalCents: pending.reduce((sum, q) => sum + q.total_ttc_cents, 0) }
}

/** Dernier devis accepté (date d'acceptation la plus récente). */
export function lastAcceptedQuote(quotes: readonly HomeQuote[]): HomeQuote | null {
  const accepted = quotes.filter((q) => q.status === 'accepted')
  accepted.sort((a, c) => (c.accepted_at ?? '').localeCompare(a.accepted_at ?? ''))
  return accepted[0] ?? null
}

export function pendingQuotesSentence(pending: PendingQuotes): Sentence {
  if (pending.count === 0) return [s('Aucun devis en attente.')]
  return [b(plural(pending.count, 'devis')), s(' en attente pour '), b(formatEuros(pending.totalCents))]
}

export function acceptedQuoteSentence(quote: HomeQuote): Sentence {
  return [b(quote.client?.name ?? 'Un client'), s(' a accepté le devis '), b(quote.number)]
}

/* ---------- Factures ---------- */

export type HomeInvoice = Pick<
  Invoice,
  'id' | 'kind' | 'status' | 'due_date' | 'issue_date' | 'paid_at' | 'total_ht_cents' | 'total_ttc_cents'
>

export interface OutstandingInvoices {
  count: number
  totalCents: number
  overdue: number
}

/** Factures émises et non payées (les avoirs n'en font pas partie). Montant TTC. */
export function outstandingInvoices(invoices: readonly HomeInvoice[], today: string): OutstandingInvoices {
  const open = invoices.filter((i) => i.status === 'issued' && i.kind !== 'credit_note')
  return {
    count: open.length,
    totalCents: open.reduce((sum, i) => sum + i.total_ttc_cents, 0),
    overdue: open.filter((i) => isOverdue(i, today)).length,
  }
}

export function outstandingSentence(summary: OutstandingInvoices): Sentence {
  if (summary.count === 0) return [s('Aucune facture à encaisser.')]
  const base: Sentence = [b(plural(summary.count, 'facture')), s(' à encaisser pour '), b(formatEuros(summary.totalCents))]
  if (summary.overdue === 0) return base
  return [...base, s(', dont '), b(`${summary.overdue} en retard`)]
}

/* ---------- Finance : 6 mois ---------- */

export interface MonthBar {
  key: string
  label: string
  /** Factures payées, par mois de `paid_at`. */
  collectedCents: number
  /** Factures émises, par mois d'`issue_date` ; un avoir réduit le facturé de son mois. */
  invoicedCents: number
}

/**
 * Encaissé et facturé par mois, en HT. Brouillons ignorés ; les factures annulées restent dans le
 * facturé (leur avoir, négatif, les compense) ; les avoirs ne sont jamais « encaissés ».
 */
export function monthlyRevenue(invoices: readonly HomeInvoice[], months: readonly string[]): MonthBar[] {
  const bars = new Map<string, MonthBar>(
    months.map((key) => [key, { key, label: shortMonth(key), collectedCents: 0, invoicedCents: 0 }]),
  )
  for (const invoice of invoices) {
    if (invoice.status === 'draft') continue
    if (invoice.issue_date) {
      const bar = bars.get(monthOf(invoice.issue_date))
      if (bar) {
        bar.invoicedCents += invoice.kind === 'credit_note' ? -Math.abs(invoice.total_ht_cents) : invoice.total_ht_cents
      }
    }
    if (invoice.status === 'paid' && invoice.kind !== 'credit_note' && invoice.paid_at) {
      const bar = bars.get(monthOf(invoice.paid_at))
      if (bar) bar.collectedCents += invoice.total_ht_cents
    }
  }
  return months.map((key) => bars.get(key) as MonthBar)
}

export function totalCollected(bars: readonly MonthBar[]): number {
  return bars.reduce((sum, bar) => sum + bar.collectedCents, 0)
}

export function financeSentence(bars: readonly MonthBar[]): Sentence {
  const total = totalCollected(bars)
  if (bars.every((bar) => bar.collectedCents === 0 && bar.invoicedCents === 0)) {
    return [s(`Aucune facture sur ${bars.length} mois.`)]
  }
  return [s(`Encaissé sur ${bars.length} mois : `), b(formatEuros(total))]
}

/** Résumé lu par les lecteurs d'écran à la place du graphique. */
export function chartSummary(bars: readonly MonthBar[]): string {
  const rows = bars.map((bar) => `${bar.label} : ${formatEuros(bar.collectedCents)} encaissés, ${formatEuros(bar.invoicedCents)} facturés`)
  return `Encaissé et facturé par mois. ${rows.join(' ; ')}.`
}

/** Hauteur d'une barre en % de la plus grande valeur du graphique (0 si tout est à zéro). */
export function barPercent(cents: number, bars: readonly MonthBar[]): number {
  const max = Math.max(0, ...bars.flatMap((bar) => [bar.collectedCents, bar.invoicedCents]))
  if (max === 0 || cents <= 0) return 0
  return Math.round((cents / max) * 100)
}

/* ---------- Prospection ---------- */

export type HomeProspect = Pick<Prospect, 'id' | 'stage' | 'next_action_date' | 'created_at'> & {
  owner: { name: string } | null
}

/** Prospects à relancer : prochaine action aujourd'hui ou en retard, ni gagnés ni perdus. */
export function prospectsToFollowUp(prospects: readonly HomeProspect[], today: string): number {
  return prospects.filter(
    (p) => p.stage !== 'won' && p.stage !== 'lost' && p.next_action_date !== null && p.next_action_date <= today,
  ).length
}

export interface OwnerActivity {
  owner: string
  count: number
}

export const NO_OWNER = 'Sans responsable'

/** Prospects ajoutés depuis `sinceIso`, par responsable, du plus actif au moins actif. */
export function prospectActivity(prospects: readonly HomeProspect[], sinceIso: string): OwnerActivity[] {
  const counts = new Map<string, number>()
  for (const p of prospects) {
    if (p.created_at < sinceIso) continue
    const owner = p.owner?.name ? firstName(p.owner.name) : NO_OWNER
    counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((x, y) => y.count - x.count || x.owner.localeCompare(y.owner, 'fr'))
}

export function followUpSentence(count: number): Sentence {
  if (count === 0) return [s('Aucun prospect à relancer aujourd’hui.')]
  return [b(plural(count, 'prospect')), s(' à relancer aujourd’hui')]
}

export function activitySentence(activity: OwnerActivity): Sentence {
  if (activity.owner === NO_OWNER) return [b(plural(activity.count, 'prospect')), s(' ajouté cette semaine, sans responsable')]
  return [b(activity.owner), s(' a ajouté '), b(plural(activity.count, 'prospect')), s(' cette semaine')]
}

/* ---------- Mon travail ---------- */

export type HomeTask = Pick<Task, 'id' | 'project_id' | 'status'> & { project: { name: string } | null }

export interface WorkSummary {
  /** À faire ou en cours. */
  todo: number
  review: number
  busiestProject: { name: string; count: number } | null
}

/** Tâches non terminées du membre connecté (la requête filtre déjà sur lui). */
export function workSummary(tasks: readonly HomeTask[]): WorkSummary {
  const open = tasks.filter((t) => t.status !== 'done')
  const perProject = new Map<string, { name: string; count: number }>()
  for (const t of open) {
    const entry = perProject.get(t.project_id) ?? { name: t.project?.name ?? 'Projet', count: 0 }
    entry.count += 1
    perProject.set(t.project_id, entry)
  }
  const busiest = [...perProject.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'fr'))[0] ?? null
  return {
    todo: open.filter((t) => t.status === 'todo' || t.status === 'in_progress').length,
    review: open.filter((t) => t.status === 'review').length,
    busiestProject: busiest,
  }
}

export function workSentence(summary: WorkSummary): Sentence {
  if (summary.todo === 0 && summary.review === 0) return [s('Aucune tâche en cours pour toi.')]
  const parts: Sentence = [b(plural(summary.todo, 'tâche')), s(' à faire')]
  if (summary.review > 0) parts.push(s(', '), b(`${summary.review} en relecture`))
  return parts
}

export function busiestProjectSentence(summary: WorkSummary): Sentence | null {
  if (!summary.busiestProject) return null
  return [s('Projet le plus chargé : '), b(summary.busiestProject.name), s(` (${summary.busiestProject.count})`)]
}

/* ---------- Équipe ---------- */

type HomeMember = Pick<Member, 'removed_at' | 'invited_at' | 'user_id' | 'weekly_capacity_hours'>

export function teamSentence(members: readonly HomeMember[]): Sentence {
  const stats = teamStats(members)
  if (stats.active === 0 && stats.invited === 0) return [s('Aucun membre pour l’instant.')]
  const parts: Sentence = [b(plural(stats.active, 'membre actif', 'membres actifs'))]
  if (stats.invited > 0) parts.push(s(', '), b(plural(stats.invited, 'invité')))
  return parts
}

export function teamActivitySentence(inProgress: number): Sentence {
  if (inProgress === 0) return [s('Aucune tâche en cours dans l’équipe.')]
  return [b(plural(inProgress, 'tâche')), s(' en cours dans l’équipe')]
}
