import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const complete = vi.fn()
class FakeMistralError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}
vi.mock('@mistralai/mistralai', () => ({ Mistral: class { chat = { complete } } }))
vi.mock('@mistralai/mistralai/models/errors/mistralerror.js', () => ({ MistralError: FakeMistralError }))
vi.mock('@mistralai/mistralai/models/errors/httpclienterrors.js', () => ({ HTTPClientError: class extends Error {} }))

const { analyzeWithMistral, isMistralConfigured } = await import('./mistral.js')

const validAnalysis = {
  tickets: [
    {
      title: 'Agrandir le bouton',
      description: 'Le bouton est trop petit.',
      type: 'modification',
      priority: 'medium',
      source_quote: 'Le bouton est trop petit.',
      from_marker: false,
      area: 'Paiement',
      related_ticket_id: null,
      assignee_member_id: null,
      assignment_reason: null,
      tasks: [{ title: 'Agrandir le bouton', description: 'Passer à 48 px.', skill: 'dev', depends_on_index: null, estimate_hours: 1 }],
    },
  ],
}

function reply(content: string, finishReason = 'stop') {
  return { choices: [{ index: 0, finishReason, message: { content } }], usage: { promptTokens: 10, completionTokens: 5 } }
}
const request = { system: 'SYS', content: 'USER', openTicketIds: [] as string[], teamMemberIds: [] as string[] }

beforeEach(() => {
  complete.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('MISTRAL_API_KEY', 'test-key')
  vi.stubEnv('MISTRAL_MODEL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('analyzeWithMistral', () => {
  it('renvoie les tickets, avec le prompt, le modèle par défaut et le format json_schema', async () => {
    complete.mockResolvedValueOnce(reply(JSON.stringify(validAnalysis)))
    const tickets = await analyzeWithMistral(request)
    expect(tickets).toHaveLength(1)
    const args = complete.mock.calls[0]![0]
    expect(args.model).toBe('mistral-small-latest')
    expect(args.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ])
    expect(args.responseFormat.type).toBe('json_schema')
    expect(args.responseFormat.jsonSchema.schemaDefinition.properties.tickets).toBeDefined()
    expect(args.responseFormat.jsonSchema.schemaDefinition.properties.tickets.items.properties.from_marker).toEqual({ type: 'boolean' })
    expect(tickets[0]?.from_marker).toBe(false)
  })

  it('refait une tentative quand le JSON est invalide', async () => {
    complete.mockResolvedValueOnce(reply('pas du json')).mockResolvedValueOnce(reply(JSON.stringify(validAnalysis)))
    await expect(analyzeWithMistral(request)).resolves.toHaveLength(1)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('échoue après deux réponses invalides', async () => {
    complete.mockResolvedValue(reply('{"tickets": 3}'))
    await expect(analyzeWithMistral(request)).rejects.toThrow(/invalide deux fois/)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('signale une réponse coupée sans nouvelle tentative', async () => {
    complete.mockResolvedValue(reply('{"tickets":', 'length'))
    await expect(analyzeWithMistral(request)).rejects.toThrow(/coupée/)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('garde la personne désignée seulement si elle est dans l’équipe', async () => {
    const mael = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const designated = {
      tickets: [{ ...validAnalysis.tickets[0], assignee_member_id: mael, assignment_reason: 'Maël s’occupe du paiement' }],
    }
    complete.mockResolvedValue(reply(JSON.stringify(designated)))
    const [kept] = await analyzeWithMistral({ ...request, teamMemberIds: [mael] })
    expect(kept).toMatchObject({ assignee_member_id: mael, assignment_reason: 'Maël s’occupe du paiement' })
    const [dropped] = await analyzeWithMistral(request)
    expect(dropped).toMatchObject({ assignee_member_id: null, assignment_reason: null })
  })

  it('traduit une erreur HTTP en message français', async () => {
    complete.mockRejectedValue(new FakeMistralError('x', 401))
    await expect(analyzeWithMistral(request)).rejects.toThrow(/MISTRAL_API_KEY refusée/)
  })
})

describe('isMistralConfigured', () => {
  it('dépend de MISTRAL_API_KEY', () => {
    expect(isMistralConfigured()).toBe(true)
    vi.stubEnv('MISTRAL_API_KEY', '  ')
    expect(isMistralConfigured()).toBe(false)
  })
})
