import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContractDraftOutput } from '../../../../src/shared/ai/contractDraft.js'
import { FakeSupabase } from '../../testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../../supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => state.db?.client,
}))

const { POST } = await import('../../../ai/run.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const QUOTE = '44444444-4444-4444-8444-444444444444'
const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FINANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROSPECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

let db: FakeSupabase
let stream: ReturnType<typeof vi.spyOn>

function call(body: unknown, token: string | null = 'mael-token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(
    new Request('https://app.test/api/ai/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'contractDraft', ...(body as object) }),
    }),
  )
}

const errorOf = async (r: Response): Promise<string> => ((await r.json()) as { error: string }).error

function claudeReturns(output: ContractDraftOutput): void {
  const message = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  stream.mockReturnValue({
    finalMessage: () => Promise.resolve(message),
  } as never)
}

const clauses: ContractDraftOutput = {
  object: 'Refonte du site vitrine du client.',
  deliverables: ['Maquettes du site', 'Site intégré'],
  timeline: 'Les délais seront précisés d’un commun accord entre les parties.',
  intellectual_property: 'Les droits sont cédés au client après paiement intégral.',
  confidentiality: 'Chaque partie garde confidentielles les informations échangées.',
  termination: 'Résiliation par écrit en cas de manquement non corrigé.',
}

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.stubEnv('ANTHROPIC_API_KEY', 'test')
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stream = vi.spyOn(Anthropic.Messages.prototype, 'stream')
  const mael = db.addUser('mael@sordulo.fr', { token: 'mael-token' })
  const sacha = db.addUser('sacha@sordulo.fr', { token: 'sacha-token' })
  const finance = db.addUser('compta@sordulo.fr', { token: 'finance-token' })
  const prospection = db.addUser('apporteur@sordulo.fr', {
    token: 'prospection-token',
  })
  db.seed('members', [
    {
      id: MAEL,
      organization_id: ORG,
      user_id: mael.id,
      name: 'Maël',
      email: 'mael@sordulo.fr',
      role: 'admin',
    },
    {
      id: SACHA,
      organization_id: ORG,
      user_id: sacha.id,
      name: 'Sacha',
      email: 'sacha@sordulo.fr',
      role: 'membre',
    },
    {
      id: FINANCE,
      organization_id: ORG,
      user_id: finance.id,
      name: 'Compta',
      email: 'compta@sordulo.fr',
      role: 'finance',
    },
    {
      id: PROSPECTION,
      organization_id: ORG,
      user_id: prospection.id,
      name: 'Apporteur',
      email: 'apporteur@sordulo.fr',
      role: 'prospection',
    },
  ])
  db.seed('organizations', [
    {
      id: ORG,
      name: 'Sordulo',
      legal_name: 'Sordulo',
      legal_form: 'SAS',
      siret: '12345678901234',
      payment_terms_days: 30,
    },
  ])
  db.seed('clients', [{ id: CLIENT, organization_id: ORG, name: 'Ibé', siret: null }])
  db.seed('projects', [
    {
      id: PROJECT,
      organization_id: ORG,
      client_id: CLIENT,
      name: 'App Ibé',
      status: 'in_progress',
      feedback_rounds_included: 3,
      start_date: null,
      due_date: null,
      ai_instructions: null,
    },
  ])
  db.seed('quotes', [
    {
      id: QUOTE,
      organization_id: ORG,
      client_id: CLIENT,
      project_id: PROJECT,
      issuer_id: null,
      number: '2026-007',
      title: 'Refonte du site',
      status: 'accepted',
      valid_until: null,
      notes: 'TVA non applicable, art. 293 B du CGI.',
      lines: [
        {
          label: 'Design des écrans',
          description: null,
          quantity: 3.5,
          unit: 'day',
          unit_price_cents: 45000,
          vat_rate: 0,
        },
        {
          label: 'Intégration',
          description: 'Pages principales',
          quantity: 1,
          unit: 'flat',
          unit_price_cents: 120050,
          vat_rate: 0,
        },
      ],
      total_ht_cents: 277550,
      total_vat_cents: 0,
      total_ttc_cents: 277550,
    },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('action contractDraft', () => {
  it('crée le contrat brouillon avec le prix, les lignes et les rounds du devis', async () => {
    claudeReturns(clauses)
    const response = await call({ quoteId: QUOTE })
    expect(response.status).toBe(200)
    const { contractId } = (await response.json()) as { contractId: string }
    const contract = db.rows('contracts')[0]!
    expect(contract.id).toBe(contractId)
    expect(contract).toMatchObject({
      status: 'draft',
      quote_id: QUOTE,
      project_id: PROJECT,
      client_id: CLIENT,
      created_by: MAEL,
    })
    const body = String(contract.body)
    expect(body).toContain('Total HT : 2 775,50 €')
    expect(body).toContain('Total TTC : 2 775,50 €')
    expect(body).toContain('Design des écrans')
    expect(body).toContain('450,00 € HT')
    expect(body).toContain('3 rounds de retours')
    expect(body).toContain('payables à 30 jours')
    expect(body).toContain('Sordulo')
    expect(body).toContain('Ibé')
  })

  it('refuse une clause où Claude a écrit un montant, sans rien insérer', async () => {
    claudeReturns({
      ...clauses,
      termination: 'Une indemnité de 500 € est due.',
    })
    const response = await call({ quoteId: QUOTE })
    expect(response.status).toBe(502)
    expect(await errorOf(response)).toContain('montant')
    expect(db.rows('contracts')).toHaveLength(0)
  })

  it('refuse un devis qui n’est pas accepté', async () => {
    db.rows('quotes')[0]!.status = 'sent'
    expect((await call({ quoteId: QUOTE })).status).toBe(409)
    expect(stream).not.toHaveBeenCalled()
  })

  it('refuse un second contrat actif mais pas après annulation', async () => {
    db.seed('contracts', [{ id: crypto.randomUUID(), quote_id: QUOTE, status: 'draft' }])
    expect((await call({ quoteId: QUOTE })).status).toBe(409)
    db.rows('contracts')[0]!.status = 'cancelled'
    claudeReturns(clauses)
    expect((await call({ quoteId: QUOTE })).status).toBe(200)
  })

  it('droits : admin et finance oui ; membre, prospection, autre organisation et sans session non', async () => {
    claudeReturns(clauses)
    expect((await call({ quoteId: QUOTE }, 'finance-token')).status).toBe(200)
    db.rows('contracts').length = 0
    stream.mockClear()
    // Le contrat reprend les prix du devis : le rôle membre n'y a pas accès.
    expect((await call({ quoteId: QUOTE }, 'sacha-token')).status).toBe(403)
    expect(db.rows('contracts')).toHaveLength(0)
    expect((await call({ quoteId: QUOTE }, 'prospection-token')).status).toBe(403)
    db.rows('quotes')[0]!.organization_id = OTHER_ORG
    expect((await call({ quoteId: QUOTE })).status).toBe(403)
    expect((await call({ quoteId: QUOTE }, null)).status).toBe(401)
    expect(stream).not.toHaveBeenCalled()
  })

  it('404 pour un devis inconnu et 400 pour un identifiant invalide', async () => {
    expect((await call({ quoteId: '55555555-5555-4555-8555-555555555555' })).status).toBe(404)
    expect((await call({ quoteId: 'abc' })).status).toBe(400)
  })
})
