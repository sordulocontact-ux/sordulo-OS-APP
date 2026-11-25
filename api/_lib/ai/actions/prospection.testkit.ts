/** TESTS SEULEMENT. Décor commun des tests des actions prospectAudit et pitch (base simulée, flux Claude simulé). */
import Anthropic from '@anthropic-ai/sdk'
import { vi } from 'vitest'
import { FakeSupabase } from '../../testing/fake-supabase.js'

export const ORG = '11111111-1111-4111-8111-111111111111'
export const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
export const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const FINANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
export const GABI = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
export const ZOE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
export const P_GABI = '22222222-2222-4222-8222-222222222221'
export const P_ZOE = '22222222-2222-4222-8222-222222222222'
export const SERVICE = '33333333-3333-4333-8333-333333333333'
export const UNKNOWN = '55555555-5555-4555-8555-555555555555'

export interface Harness {
  db: FakeSupabase
  stream: ReturnType<typeof vi.spyOn>
}

export function seedProspection(db: FakeSupabase): void {
  const users = {
    mael: db.addUser('mael@sordulo.fr', { token: 'mael-token' }),
    sacha: db.addUser('sacha@sordulo.fr', { token: 'sacha-token' }),
    finance: db.addUser('compta@sordulo.fr', { token: 'finance-token' }),
    gabi: db.addUser('gabi@sordulo.fr', { token: 'gabi-token' }),
    zoe: db.addUser('zoe@sordulo.fr', { token: 'zoe-token' }),
  }
  db.seed('organizations', [{ id: ORG, name: 'Sordulo' }])
  db.seed('members', [
    {
      id: MAEL,
      organization_id: ORG,
      user_id: users.mael.id,
      name: 'Maël',
      email: 'mael@sordulo.fr',
      role: 'admin',
    },
    {
      id: SACHA,
      organization_id: ORG,
      user_id: users.sacha.id,
      name: 'Sacha',
      email: 'sacha@sordulo.fr',
      role: 'membre',
    },
    {
      id: FINANCE,
      organization_id: ORG,
      user_id: users.finance.id,
      name: 'Compta',
      email: 'compta@sordulo.fr',
      role: 'finance',
    },
    {
      id: GABI,
      organization_id: ORG,
      user_id: users.gabi.id,
      name: 'Gabriela',
      email: 'gabi@sordulo.fr',
      role: 'prospection',
    },
    {
      id: ZOE,
      organization_id: ORG,
      user_id: users.zoe.id,
      name: 'Zoé',
      email: 'zoe@sordulo.fr',
      role: 'prospection',
    },
  ])
  const base = {
    organization_id: ORG,
    contact_name: 'Mme Dupont',
    stage: 'to_audit',
    audit: null,
    audit_status: 'none',
    audit_notes: null,
    recommended_service_id: null,
    offer_notes: null,
    pitch: null,
    do_not_contact: false,
    updated_at: '2026-11-20T10:00:00Z',
  }
  db.seed('prospects', [
    {
      ...base,
      id: P_GABI,
      company: 'Boulangerie Dupont',
      website: 'https://dupont.fr',
      owner_member_id: GABI,
      created_by: GABI,
    },
    {
      ...base,
      id: P_ZOE,
      company: 'Café Zoé',
      website: 'https://cafe-zoe.fr',
      owner_member_id: ZOE,
      created_by: ZOE,
    },
  ])
  db.seed('services', [
    {
      id: SERVICE,
      organization_id: ORG,
      name: 'Refonte de site vitrine',
      description: 'Site vitrine responsive, 5 pages, SEO de base.',
      unit: 'flat',
      unit_price_cents: 280000,
    },
  ])
}

export function setupHarness(): Harness {
  const db = new FakeSupabase()
  seedProspection(db)
  vi.stubEnv('ANTHROPIC_API_KEY', 'test')
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const stream = vi.spyOn(Anthropic.Messages.prototype, 'stream')
  return { db, stream }
}

export function claudeReturns(stream: Harness['stream'], output: unknown): void {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  const message = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  stream.mockReturnValue({
    finalMessage: () => Promise.resolve(message),
  } as never)
}

/** Premier appel à Claude : { system, message } tels qu'envoyés. */
export function sentToClaude(stream: Harness['stream']): {
  system: string
  message: string
} {
  const args = stream.mock.calls[0]?.[0] as {
    system: { text: string }[]
    messages: { content: string }[]
  }
  return {
    system: args.system[0]?.text ?? '',
    message: String(args.messages[0]?.content ?? ''),
  }
}

export function runAiRequest(post: (request: Request) => Promise<Response>, body: unknown, token: string | null): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return post(
    new Request('https://app.test/api/ai/run', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

export async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}
