import { describe, expect, it } from 'vitest'
import {
  buildFollowupItems,
  dayDiff,
  waitingLabel,
  type FollowupContact,
  type FollowupInvoice,
  type FollowupQuote,
  type FollowupRecord,
} from './followupLogic'

const TODAY = '2026-11-25'

function quote(overrides: Partial<FollowupQuote> = {}): FollowupQuote {
  return { id: 'q1', number: 'D-1', title: 'Refonte', status: 'sent', sent_at: '2026-11-10T09:00:00Z', issue_date: '2026-11-10', total_ttc_cents: 120_000, client_id: 'c1', client: { name: 'Ibé' }, ...overrides }
}
function invoice(overrides: Partial<FollowupInvoice> = {}): FollowupInvoice {
  return { id: 'i1', number: 'F-1', title: 'Acompte', kind: 'invoice', status: 'issued', due_date: '2026-11-15', total_ttc_cents: 60_000, client_id: 'c1', client: { name: 'Ibé' }, ...overrides }
}
function record(overrides: Partial<FollowupRecord>): FollowupRecord {
  return { id: 'f1', target_type: 'quote', target_id: 'q1', draft: '', status: 'draft', sent_at: null, updated_at: '2026-11-20T10:00:00Z', ...overrides }
}
const contacts: FollowupContact[] = [
  { client_id: 'c1', name: 'A', email: 'a@x.test', is_primary: false },
  { client_id: 'c1', name: 'B', email: 'b@x.test', is_primary: true },
]

describe('buildFollowupItems', () => {
  it('garde un devis envoyé sans réponse depuis 7 jours, pas avant', () => {
    expect(buildFollowupItems([quote({ sent_at: '2026-11-18T10:00:00Z' })], [], [], contacts, TODAY)).toHaveLength(1)
    expect(buildFollowupItems([quote({ sent_at: '2026-11-19T10:00:00Z' })], [], [], contacts, TODAY)).toHaveLength(0)
  })

  it('retombe sur la date du devis sans sent_at, ignore les devis non envoyés', () => {
    expect(buildFollowupItems([quote({ sent_at: null, issue_date: '2026-11-01' })], [], [], contacts, TODAY)[0]?.days).toBe(24)
    expect(buildFollowupItems([quote({ status: 'accepted' })], [], [], contacts, TODAY)).toHaveLength(0)
  })

  it('garde les factures émises échues, pas les avoirs, payées ou à échéance du jour', () => {
    const items = buildFollowupItems(
      [],
      [invoice(), invoice({ id: 'i2', kind: 'credit_note' }), invoice({ id: 'i3', status: 'paid' }), invoice({ id: 'i4', due_date: TODAY }), invoice({ id: 'i5', due_date: null })],
      [],
      contacts,
      TODAY,
    )
    expect(items.map((i) => i.id)).toEqual(['i1'])
    expect(items[0]?.days).toBe(10)
  })

  it('prend l’email du contact principal', () => {
    expect(buildFollowupItems([quote()], [], [], contacts, TODAY)[0]?.email).toBe('b@x.test')
    expect(buildFollowupItems([quote({ client_id: 'autre' })], [], [], contacts, TODAY)[0]?.email).toBeNull()
  })

  it('attache le brouillon en cours', () => {
    const items = buildFollowupItems([quote()], [], [record({ draft: 'Objet : x' })], contacts, TODAY)
    expect(items[0]?.draft?.draft).toBe('Objet : x')
  })

  it('ne repropose pas un document relancé ou ignoré depuis moins de 7 jours', () => {
    const sent = record({ status: 'sent', sent_at: '2026-11-20T10:00:00Z' })
    expect(buildFollowupItems([quote()], [], [sent], contacts, TODAY)).toHaveLength(0)
    const dismissed = record({ status: 'dismissed', updated_at: '2026-11-22T10:00:00Z' })
    expect(buildFollowupItems([quote()], [], [dismissed], contacts, TODAY)).toHaveLength(0)
  })

  it('reprend un document relancé il y a 7 jours ou plus', () => {
    const sent = record({ status: 'sent', sent_at: '2026-11-18T10:00:00Z' })
    expect(buildFollowupItems([quote()], [], [sent], contacts, TODAY)).toHaveLength(1)
  })

  it('range les factures avant les devis, du plus ancien au plus récent', () => {
    const items = buildFollowupItems(
      [quote({ id: 'q1', sent_at: '2026-11-01T10:00:00Z' })],
      [invoice({ id: 'i1', due_date: '2026-11-20' }), invoice({ id: 'i2', due_date: '2026-11-01' })],
      [],
      contacts,
      TODAY,
    )
    expect(items.map((i) => i.id)).toEqual(['i2', 'i1', 'q1'])
  })
})

describe('libellés', () => {
  it('dit l’attente et le retard', () => {
    expect(waitingLabel({ type: 'quote', days: 9 })).toBe('Sans réponse depuis 9 jours')
    expect(waitingLabel({ type: 'invoice', days: 1 })).toBe('En retard de 1 jour')
  })
  it('compte les jours entre deux dates', () => {
    expect(dayDiff('2026-11-01', '2026-11-25')).toBe(24)
  })
})
