import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSupabase } from '../../testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
/** Le faux Supabase ne génère pas les id des insertions (la base le fait) : on les ajoute ici. */
vi.mock('../../supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    ...state.db?.client,
    from: (table: string) => {
      const query = state.db!.client.from(table)
      const insert = query.insert.bind(query)
      query.insert = ((rows: Record<string, unknown> | Record<string, unknown>[]) =>
        insert(
          Array.isArray(rows) ? rows.map((r) => ({ id: crypto.randomUUID(), ...r })) : { id: crypto.randomUUID(), ...rows },
        )) as typeof query.insert
      return query
    },
  }),
}))

const { POST } = await import('../../../ai/run.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const CLIENT = '12111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const INPUT = '33333333-3333-4333-8333-333333333333'
const EMPTY_INPUT = '33333333-3333-4333-8333-333333333334'
const BRIEF = '44444444-4444-4444-8444-444444444444'
const SVC_SITE = '55555555-5555-4555-8555-555555555551'
const SVC_LOGO = '55555555-5555-4555-8555-555555555552'
const SVC_OFF = '55555555-5555-4555-8555-555555555553'
const GHOST = '66666666-6666-4666-8666-666666666666'

let db: FakeSupabase
let stream: ReturnType<typeof vi.spyOn>

function call(body: unknown, token = 'admin-token'): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  })
  return POST(
    new Request('https://app.test/api/ai/run', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

function claudeReturns(output: unknown): void {
  const message = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  stream.mockReturnValue({
    finalMessage: () => Promise.resolve(message),
  } as never)
}

const briefOut = {
  contexte: 'Boutique de vélos qui veut vendre en ligne.',
  objectifs: ['  Vendre en ligne  ', ''],
  livrables: ['Site e-commerce'],
  contraintes: [],
  budget: null,
  delais: ' fin mars ',
  questions_ouvertes: ['Quel budget ?'],
}

const briefContent = {
  contexte: 'Boutique',
  objectifs: ['Vendre'],
  livrables: ['Site'],
  contraintes: [],
  budget: null,
  delais: null,
  questions_ouvertes: [],
}

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.stubEnv('ANTHROPIC_API_KEY', 'test')
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stream = vi.spyOn(Anthropic.Messages.prototype, 'stream')

  const admin = db.addUser('admin@sordulo.fr', { token: 'admin-token' })
  const membre = db.addUser('membre@sordulo.fr', { token: 'membre-token' })
  const finance = db.addUser('finance@sordulo.fr', { token: 'finance-token' })
  const presta = db.addUser('apporteur@sordulo.fr', { token: 'presta-token' })
  db.seed('members', [
    {
      id: 'a0000000-0000-4000-8000-000000000001',
      organization_id: ORG,
      user_id: admin.id,
      name: 'Admin',
      email: 'admin@sordulo.fr',
      role: 'admin',
    },
    {
      id: 'a0000000-0000-4000-8000-000000000002',
      organization_id: ORG,
      user_id: membre.id,
      name: 'Membre',
      email: 'membre@sordulo.fr',
      role: 'membre',
    },
    {
      id: 'a0000000-0000-4000-8000-000000000003',
      organization_id: ORG,
      user_id: finance.id,
      name: 'Finance',
      email: 'finance@sordulo.fr',
      role: 'finance',
    },
    {
      id: 'a0000000-0000-4000-8000-000000000004',
      organization_id: ORG,
      user_id: presta.id,
      name: 'Apporteur',
      email: 'apporteur@sordulo.fr',
      role: 'prospection',
    },
  ])
  db.seed('clients', [{ id: CLIENT, organization_id: ORG, name: 'Vélos Martin' }])
  db.seed('projects', [
    {
      id: PROJECT,
      organization_id: ORG,
      client_id: CLIENT,
      name: 'Site vélos',
      tone_of_voice: null,
      ai_instructions: null,
    },
  ])
  db.seed('organizations', [
    {
      id: ORG,
      name: 'Sordulo',
      default_daily_rate: 500,
      default_hourly_rate: null,
      default_vat_rate: 20,
      vat_mention: 'TVA non applicable',
    },
  ])
  db.seed('inputs', [
    {
      id: INPUT,
      organization_id: ORG,
      project_id: PROJECT,
      kind: 'written',
      title: 'Appel',
      raw_text: 'Nous voulons un site pour vendre nos vélos.',
      transcript: null,
      speaker_names: {},
      status: 'ready',
    },
    {
      id: EMPTY_INPUT,
      organization_id: ORG,
      project_id: PROJECT,
      kind: 'written',
      title: 'Vide',
      raw_text: '   ',
      transcript: null,
      speaker_names: {},
      status: 'ready',
    },
  ])
  db.seed('services', [
    {
      id: SVC_SITE,
      organization_id: ORG,
      name: 'Site vitrine',
      description: 'Cinq pages',
      unit: 'flat',
      unit_price_cents: 450000,
      vat_rate: 20,
      lines: [],
      active: true,
      position: 1,
    },
    {
      id: SVC_LOGO,
      organization_id: ORG,
      name: 'Logo',
      description: null,
      unit: 'day',
      unit_price_cents: 60000,
      vat_rate: 20,
      lines: [
        {
          label: 'Création du logo',
          description: null,
          quantity: 2,
          unit: 'day',
          unit_price_cents: 60000,
          vat_rate: 20,
        },
      ],
      active: true,
      position: 2,
    },
    {
      id: SVC_OFF,
      organization_id: ORG,
      name: 'Archivée',
      description: null,
      unit: 'flat',
      unit_price_cents: 100,
      vat_rate: 20,
      lines: [],
      active: false,
      position: 3,
    },
  ])
})

afterEach(() => {
  state.db = null
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('action brief', () => {
  it('crée le brief nettoyé et l’enregistre par entrée', async () => {
    claudeReturns(briefOut)
    const response = await call({ action: 'brief', inputId: INPUT }, 'membre-token')
    expect(response.status).toBe(200)
    const { brief } = (await response.json()) as {
      brief: { content: Record<string, unknown>; input_id: string }
    }
    expect(brief.input_id).toBe(INPUT)
    expect(brief.content.objectifs).toEqual(['Vendre en ligne'])
    expect(brief.content.budget).toBeNull()
    expect(brief.content.delais).toBe('fin mars')
    expect(db.rows('briefs')).toHaveLength(1)
  })

  it('remplace le brief existant en gardant le devis lié', async () => {
    db.seed('briefs', [
      {
        id: BRIEF,
        organization_id: ORG,
        project_id: PROJECT,
        input_id: INPUT,
        content: briefContent,
        quote_id: GHOST,
      },
    ])
    claudeReturns(briefOut)
    const response = await call({ action: 'brief', inputId: INPUT })
    expect(response.status).toBe(200)
    expect(db.rows('briefs')).toHaveLength(1)
    expect((db.rows('briefs')[0]!.content as { contexte: string }).contexte).toContain('Boutique de vélos')
    expect(db.rows('briefs')[0]!.quote_id).toBe(GHOST)
  })

  it('refuse une entrée vide sans appeler Claude', async () => {
    const response = await call({ action: 'brief', inputId: EMPTY_INPUT })
    expect(response.status).toBe(422)
    expect(stream).not.toHaveBeenCalled()
    expect(db.rows('briefs')).toHaveLength(0)
  })

  it('refuse une entrée pas encore prête', async () => {
    db.rows('inputs')[0]!.status = 'analyzing'
    expect((await call({ action: 'brief', inputId: INPUT })).status).toBe(409)
  })

  it.each(['finance-token', 'presta-token'])('refuse le rôle de %s', async (token) => {
    const response = await call({ action: 'brief', inputId: INPUT }, token)
    expect(response.status).toBe(403)
    expect(stream).not.toHaveBeenCalled()
  })

  it('donne une entrée comme donnée au modèle', async () => {
    claudeReturns(briefOut)
    await call({ action: 'brief', inputId: INPUT })
    const request = stream.mock.calls[0]![0] as {
      messages: { content: string }[]
    }
    expect(request.messages[0]!.content).toContain('<entree type="retour écrit">')
  })
})

describe('action quoteDraft', () => {
  beforeEach(() => {
    db.seed('briefs', [
      {
        id: BRIEF,
        organization_id: ORG,
        project_id: PROJECT,
        input_id: INPUT,
        content: briefContent,
        quote_id: null,
      },
    ])
    db.seed('billing_issuers', [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        organization_id: ORG,
        is_default: true,
        archived_at: null,
      },
    ])
  })

  it('reprend les prix du catalogue, ignore un service inconnu ou inactif et relie le devis', async () => {
    claudeReturns({
      lines: [
        {
          service_id: SVC_SITE,
          label: 'inventé',
          quantity: 1,
          unit: 'flat',
          justification: 'site demandé',
        },
        {
          service_id: SVC_LOGO,
          label: '',
          quantity: 1.5,
          unit: 'day',
          justification: 'logo',
        },
        {
          service_id: GHOST,
          label: 'Fantôme',
          quantity: 1,
          unit: 'flat',
          justification: 'inconnu',
        },
        {
          service_id: SVC_OFF,
          label: 'Archivée',
          quantity: 1,
          unit: 'flat',
          justification: 'inactif',
        },
        {
          service_id: null,
          label: 'Atelier photo',
          quantity: 2,
          unit: 'day',
          justification: 'évoqué dans le brief',
        },
      ],
    })
    const response = await call({ action: 'quoteDraft', briefId: BRIEF })
    expect(response.status).toBe(200)
    const { quoteId } = (await response.json()) as { quoteId: string }
    const quote = db.rows('quotes')[0]!
    expect(quote.id).toBe(quoteId)
    expect(quote).toMatchObject({
      client_id: CLIENT,
      project_id: PROJECT,
      status: 'draft',
      created_by: 'a0000000-0000-4000-8000-000000000001',
      issuer_id: 'b0000000-0000-4000-8000-000000000001',
    })
    const lines = quote.lines as {
      label: string
      quantity: number
      unit_price_cents: number
      service_id?: string
    }[]
    expect(lines.map((l) => l.label)).toEqual(['Site vitrine', 'Création du logo', 'Atelier photo'])
    expect(lines[0]).toMatchObject({
      unit_price_cents: 450000,
      service_id: SVC_SITE,
    })
    expect(lines[1]).toMatchObject({
      unit_price_cents: 60000,
      quantity: 3,
      service_id: SVC_LOGO,
    })
    expect(lines[2]).toMatchObject({ unit_price_cents: 50000, quantity: 2 })
    expect(lines[2]!.service_id).toBeUndefined()
    expect(db.rows('briefs')[0]!.quote_id).toBe(quoteId)
  })

  it('refuse si un devis existe déjà', async () => {
    db.rows('briefs')[0]!.quote_id = GHOST
    const response = await call({ action: 'quoteDraft', briefId: BRIEF })
    expect(response.status).toBe(409)
    expect(db.rows('quotes')).toHaveLength(0)
    expect(stream).not.toHaveBeenCalled()
  })

  it.each(['membre-token', 'presta-token'])('refuse le rôle de %s', async (token) => {
    expect((await call({ action: 'quoteDraft', briefId: BRIEF }, token)).status).toBe(403)
    expect(stream).not.toHaveBeenCalled()
  })

  it('accepte le rôle finance', async () => {
    claudeReturns({ lines: [] })
    expect((await call({ action: 'quoteDraft', briefId: BRIEF }, 'finance-token')).status).toBe(200)
    expect(db.rows('quotes')[0]!.lines).toEqual([])
  })

  it('refuse un projet sans client', async () => {
    db.rows('projects')[0]!.client_id = null
    expect((await call({ action: 'quoteDraft', briefId: BRIEF })).status).toBe(422)
  })
})
