import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '../../../../src/shared/types.js'
import { FakeSupabase } from '../../testing/fake-supabase.js'
import { HttpError } from '../../http.js'

const claude = vi.hoisted(() => ({
  calls: [] as { content: unknown }[],
  output: {
    subject: 'Devis D-2026-001',
    body: 'Bonjour Camille,\n\nSuite de notre devis.\n\nSacha, Sacha Moricet EI',
  },
}))
vi.mock('../../analysis.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analysis.js')>()),
  callClaudeStructured: vi.fn(async (request: { content: unknown }) => {
    claude.calls.push({ content: request.content })
    return claude.output
  }),
}))

const { default: action } = await import('./followupDraft.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const QUOTE = '33333333-3333-4333-8333-333333333333'
const INVOICE = '44444444-4444-4444-8444-444444444444'
const ISSUER = '55555555-5555-4555-8555-555555555555'

let db: FakeSupabase
const finance = {
  id: 'm1',
  name: 'Sacha Moricet',
  role: 'finance',
  organization_id: ORG,
} as Member

function run(body: { targetType: 'quote' | 'invoice'; targetId: string }, requireMember?: () => Promise<Member>) {
  return action.run({
    body,
    user: { id: 'u1', email: 'sacha@test' },
    admin: db.client as never,
    requireMember: requireMember ?? (async () => finance),
    request: new Request('https://app.test'),
  } as never)
}

beforeEach(() => {
  claude.calls.length = 0
  db = new FakeSupabase()
  db.seed('clients', [{ id: CLIENT, organization_id: ORG, name: 'Ibé' }])
  db.seed('client_contacts', [
    {
      id: 'c1',
      client_id: CLIENT,
      name: 'Autre Personne',
      email: 'a@ibe.test',
      is_primary: false,
    },
    {
      id: 'c2',
      client_id: CLIENT,
      name: 'Camille Durand',
      email: 'camille@ibe.test',
      is_primary: true,
    },
  ])
  db.seed('billing_issuers', [{ id: ISSUER, display_name: 'Sacha Moricet EI' }])
  db.seed('quotes', [
    {
      id: QUOTE,
      organization_id: ORG,
      client_id: CLIENT,
      project_id: null,
      issuer_id: ISSUER,
      number: 'D-2026-001',
      title: 'Refonte',
      status: 'sent',
      sent_at: '2026-11-01T10:00:00Z',
      issue_date: '2026-11-01',
      valid_until: '2026-12-01',
      total_ht_cents: 100000,
      total_ttc_cents: 120000,
    },
  ])
  db.seed('invoices', [
    {
      id: INVOICE,
      organization_id: ORG,
      client_id: CLIENT,
      project_id: null,
      issuer_id: ISSUER,
      kind: 'invoice',
      status: 'issued',
      number: 'F-2026-005',
      title: 'Acompte',
      issue_date: '2026-10-01',
      due_date: '2026-10-31',
      total_ht_cents: 50000,
      total_ttc_cents: 60000,
    },
  ])
})

describe('action followupDraft', () => {
  it('crée un brouillon pour un devis envoyé, avec les faits du document', async () => {
    const res = await run({ targetType: 'quote', targetId: QUOTE })
    expect(res.followup.status).toBe('draft')
    expect(res.followup.draft.startsWith('Objet : Devis D-2026-001\n\n')).toBe(true)
    expect(db.rows('followups')).toHaveLength(1)
    const prompt = String(claude.calls[0]?.content)
    expect(prompt).toContain('D-2026-001')
    expect(prompt).toContain('Prénom : Camille')
    expect(prompt).toContain('Sacha, Sacha Moricet EI')
  })

  it('remplace le texte du brouillon existant au lieu d’en créer un second', async () => {
    await run({ targetType: 'quote', targetId: QUOTE })
    claude.output = { subject: 'Nouveau', body: 'Autre texte' }
    await run({ targetType: 'quote', targetId: QUOTE })
    expect(db.rows('followups')).toHaveLength(1)
    expect(db.rows('followups')[0]?.draft).toContain('Nouveau')
  })

  it('relance une facture émise échue', async () => {
    const res = await run({ targetType: 'invoice', targetId: INVOICE })
    expect(res.followup.target_type).toBe('invoice')
    expect(String(claude.calls[0]?.content)).toContain('F-2026-005')
  })

  it('refuse un devis non envoyé et une facture payée', async () => {
    db.rows('quotes')[0]!.status = 'accepted'
    db.rows('invoices')[0]!.status = 'paid'
    await expect(run({ targetType: 'quote', targetId: QUOTE })).rejects.toMatchObject({ status: 409 })
    await expect(run({ targetType: 'invoice', targetId: INVOICE })).rejects.toMatchObject({ status: 409 })
    expect(claude.calls).toHaveLength(0)
  })

  it('refuse un document inconnu et un membre sans droit', async () => {
    await expect(
      run({
        targetType: 'quote',
        targetId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      run({ targetType: 'quote', targetId: QUOTE }, async () => {
        throw new HttpError(403, 'Accès refusé.')
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(claude.calls).toHaveLength(0)
    expect(db.rows('followups')).toHaveLength(0)
  })
})
