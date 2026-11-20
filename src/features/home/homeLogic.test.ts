import { describe, expect, it } from 'vitest'
import {
  acceptedQuoteSentence,
  activitySentence,
  barPercent,
  busiestProjectSentence,
  financeSentence,
  firstName,
  followUpSentence,
  formatEuros,
  lastAcceptedQuote,
  lastMonths,
  monthlyRevenue,
  outstandingInvoices,
  outstandingSentence,
  pendingQuotes,
  pendingQuotesSentence,
  plain,
  plural,
  prospectActivity,
  prospectsToFollowUp,
  teamActivitySentence,
  teamSentence,
  workSentence,
  workSummary,
  type HomeInvoice,
  type HomeProspect,
  type HomeQuote,
  type HomeTask,
} from './homeLogic'

const text = (sentence: Parameters<typeof plain>[0]) => plain(sentence).replace(/\s/g, ' ')

const quote = (over: Partial<HomeQuote>): HomeQuote => ({
  id: 'q', number: 'D-2026-001', status: 'sent', valid_until: null, total_ttc_cents: 100000, accepted_at: null, client: { name: 'Ibé' }, ...over,
})
const invoice = (over: Partial<HomeInvoice>): HomeInvoice => ({
  id: 'i', kind: 'invoice', status: 'issued', due_date: null, issue_date: null, paid_at: null, total_ht_cents: 100000, total_ttc_cents: 120000, ...over,
})

describe('formats', () => {
  it('pluralise', () => {
    expect(plural(1, 'devis')).toBe('1 devis')
    expect(plural(2, 'devis')).toBe('2 devis')
    expect(plural(1, 'facture')).toBe('1 facture')
    expect(plural(2, 'facture')).toBe('2 factures')
    expect(plural(2, 'membre actif', 'membres actifs')).toBe('2 membres actifs')
    expect(plural(0, 'facture')).toBe('0 facture')
  })
  it('euros entiers sans centimes', () => {
    expect(formatEuros(1240000).replace(/\s/g, ' ')).toBe('12 400 €')
    expect(formatEuros(123450).replace(/\s/g, ' ')).toBe('1 234,50 €')
  })
  it('prénom', () => {
    expect(firstName('Sacha Moricet')).toBe('Sacha')
    expect(firstName('  Maël ')).toBe('Maël')
  })
})

describe('devis', () => {
  const quotes = [
    quote({ id: '1', total_ttc_cents: 500000 }),
    quote({ id: '2', total_ttc_cents: 740000, valid_until: '2026-12-01' }),
    quote({ id: '3', valid_until: '2026-11-01' }),
    quote({ id: '4', status: 'accepted', number: 'D-2026-004', accepted_at: '2026-11-10T10:00:00Z' }),
    quote({ id: '5', status: 'accepted', number: 'D-2026-003', accepted_at: '2026-10-10T10:00:00Z' }),
  ]
  it('ignore les expirés et compte le TTC', () => {
    expect(pendingQuotes(quotes, '2026-11-20')).toEqual({ count: 2, totalCents: 1240000 })
  })
  it('phrases', () => {
    expect(text(pendingQuotesSentence({ count: 2, totalCents: 1240000 }))).toBe('2 devis en attente pour 12 400 €')
    expect(text(pendingQuotesSentence({ count: 1, totalCents: 100000 }))).toBe('1 devis en attente pour 1 000 €')
    expect(text(pendingQuotesSentence({ count: 0, totalCents: 0 }))).toBe('Aucun devis en attente.')
  })
  it('dernier accepté', () => {
    const last = lastAcceptedQuote(quotes)
    expect(last?.number).toBe('D-2026-004')
    expect(text(acceptedQuoteSentence(last as HomeQuote))).toBe('Ibé a accepté le devis D-2026-004')
    expect(lastAcceptedQuote([])).toBeNull()
  })
})

describe('factures', () => {
  it('à encaisser et en retard', () => {
    const summary = outstandingInvoices(
      [
        invoice({ total_ttc_cents: 300000, due_date: '2026-11-01' }),
        invoice({ total_ttc_cents: 520000, due_date: '2026-12-01' }),
        invoice({ status: 'paid' }),
        invoice({ kind: 'credit_note', total_ttc_cents: -50000 }),
      ],
      '2026-11-20',
    )
    expect(summary).toEqual({ count: 2, totalCents: 820000, overdue: 1 })
    expect(text(outstandingSentence(summary))).toBe('2 factures à encaisser pour 8 200 €, dont 1 en retard')
    expect(text(outstandingSentence({ count: 1, totalCents: 120000, overdue: 0 }))).toBe('1 facture à encaisser pour 1 200 €')
    expect(text(outstandingSentence({ count: 0, totalCents: 0, overdue: 0 }))).toBe('Aucune facture à encaisser.')
  })
})

describe('finance 6 mois', () => {
  const now = new Date(2026, 10, 20)
  const months = lastMonths(now)
  it('six mois, du plus ancien au courant', () => {
    expect(months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(lastMonths(new Date(2026, 1, 5), 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })
  const bars = monthlyRevenue(
    [
      invoice({ status: 'paid', issue_date: '2026-09-05', paid_at: '2026-10-12T09:00:00', total_ht_cents: 200000 }),
      invoice({ status: 'issued', issue_date: '2026-10-20', total_ht_cents: 100000 }),
      invoice({ status: 'cancelled', issue_date: '2026-10-02', total_ht_cents: 40000 }),
      invoice({ kind: 'credit_note', status: 'issued', issue_date: '2026-10-25', total_ht_cents: -40000 }),
      invoice({ status: 'draft', issue_date: '2026-10-25', total_ht_cents: 999900 }),
      invoice({ status: 'paid', issue_date: '2025-01-05', paid_at: '2025-02-01T09:00:00', total_ht_cents: 777700 }),
    ],
    months,
  )
  const by = (key: string) => bars.find((bar) => bar.key === key)
  it('encaissé par paid_at, facturé par issue_date, avoir et brouillon', () => {
    expect(by('2026-09')).toMatchObject({ invoicedCents: 200000, collectedCents: 0 })
    expect(by('2026-10')).toMatchObject({ invoicedCents: 100000, collectedCents: 200000 })
    expect(bars).toHaveLength(6)
    expect(bars[0]?.label).toBe('juin')
  })
  it('phrase et hauteurs', () => {
    expect(text(financeSentence(bars))).toBe('Encaissé sur 6 mois : 2 000 €')
    expect(text(financeSentence(monthlyRevenue([], months)))).toBe('Aucune facture sur 6 mois.')
    expect(barPercent(200000, bars)).toBe(100)
    expect(barPercent(100000, bars)).toBe(50)
    expect(barPercent(0, bars)).toBe(0)
    expect(barPercent(-5, bars)).toBe(0)
  })
})

describe('prospection', () => {
  const p = (over: Partial<HomeProspect>): HomeProspect => ({
    id: 'p', stage: 'contacted', next_action_date: null, created_at: '2026-11-01T00:00:00Z', owner: null, ...over,
  })
  it('à relancer : échue, hors gagnés et perdus', () => {
    const list = [
      p({ next_action_date: '2026-11-20' }),
      p({ next_action_date: '2026-11-10' }),
      p({ next_action_date: '2026-11-25' }),
      p({ next_action_date: '2026-11-01', stage: 'won' }),
      p({}),
    ]
    expect(prospectsToFollowUp(list, '2026-11-20')).toBe(2)
    expect(text(followUpSentence(4))).toBe('4 prospects à relancer aujourd’hui')
    expect(text(followUpSentence(1))).toBe('1 prospect à relancer aujourd’hui')
    expect(text(followUpSentence(0))).toBe('Aucun prospect à relancer aujourd’hui.')
  })
  it('activité par responsable', () => {
    const since = '2026-11-16T00:00:00Z'
    const list = [
      ...Array.from({ length: 7 }, () => p({ created_at: '2026-11-18T10:00:00Z', owner: { name: 'Gabriela Lopez' } })),
      p({ created_at: '2026-11-19T10:00:00Z', owner: { name: 'Maël Dev' } }),
      p({ created_at: '2026-11-19T10:00:00Z' }),
      p({ created_at: '2026-11-01T10:00:00Z', owner: { name: 'Maël Dev' } }),
    ]
    const activity = prospectActivity(list, since)
    expect(activity.map((a) => [a.owner, a.count])).toEqual([['Gabriela', 7], ['Maël', 1], ['Sans responsable', 1]])
    expect(text(activitySentence(activity[0]!))).toBe('Gabriela a ajouté 7 prospects cette semaine')
    expect(text(activitySentence(activity[1]!))).toBe('Maël a ajouté 1 prospect cette semaine')
    expect(text(activitySentence(activity[2]!))).toBe('1 prospect ajouté cette semaine, sans responsable')
  })
})

describe('mon travail', () => {
  const t = (project: string, status: HomeTask['status']): HomeTask => ({ id: Math.random().toString(), project_id: project, status, project: { name: `Projet ${project}` } })
  it('résume et trouve le projet le plus chargé', () => {
    const summary = workSummary([t('a', 'todo'), t('a', 'in_progress'), t('b', 'todo'), t('a', 'review'), t('b', 'review'), t('a', 'done')])
    expect(summary).toEqual({ todo: 3, review: 2, busiestProject: { name: 'Projet a', count: 3 } })
    expect(text(workSentence(summary))).toBe('3 tâches à faire, 2 en relecture')
    expect(text(busiestProjectSentence(summary)!)).toBe('Projet le plus chargé : Projet a (3)')
  })
  it('singulier, vide', () => {
    expect(text(workSentence({ todo: 1, review: 0, busiestProject: null }))).toBe('1 tâche à faire')
    const empty = workSummary([])
    expect(text(workSentence(empty))).toBe('Aucune tâche en cours pour toi.')
    expect(busiestProjectSentence(empty)).toBeNull()
  })
})

describe('équipe', () => {
  const m = (over: object) => ({ removed_at: null, invited_at: null, user_id: 'u', weekly_capacity_hours: 35, ...over })
  it('actifs et invités', () => {
    const members = [m({}), m({}), m({}), m({ user_id: null, invited_at: '2026-11-01' }), m({ removed_at: '2026-11-02' })]
    expect(text(teamSentence(members))).toBe('3 membres actifs, 1 invité')
    expect(text(teamSentence([m({})]))).toBe('1 membre actif')
    expect(text(teamSentence([]))).toBe('Aucun membre pour l’instant.')
    expect(text(teamActivitySentence(2))).toBe('2 tâches en cours dans l’équipe')
    expect(text(teamActivitySentence(0))).toBe('Aucune tâche en cours dans l’équipe.')
  })
})
