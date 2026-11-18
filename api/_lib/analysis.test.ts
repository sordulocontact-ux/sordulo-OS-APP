import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AnalysisSchema } from '../../src/shared/analysis-schema.js'
import { analyzeInput, ANALYSIS_SYSTEM_PROMPT, buildUserMessage, type AnalysisContext } from './analysis.js'
import * as mistral from './mistral.js'

function context(overrides: Partial<AnalysisContext['input']> = {}): AnalysisContext {
  return {
    clientName: 'Ibé',
    projectName: 'App Ibé',
    toneOfVoice: 'Chaleureux, tutoiement',
    openTickets: [{ id: 'ticket-1', title: 'Refaire\nl’accueil', type: 'modification', status: 'validated' }],
    input: { kind: 'written', title: null, rawText: 'Le bouton est trop petit.', transcript: null, speakerNames: {}, ...overrides },
  }
}

describe('buildUserMessage', () => {
  it('contient le contexte, les tickets ouverts puis le texte', () => {
    const message = buildUserMessage(context())
    expect(message).toContain('Client : Ibé')
    expect(message).toContain('Projet : App Ibé')
    expect(message).toContain('Ton de voix : Chaleureux, tutoiement')
    expect(message).toContain('- id: ticket-1 | titre: Refaire l’accueil | type: modification | statut: validated')
    expect(message.indexOf('<tickets_ouverts>')).toBeLessThan(message.indexOf('Le bouton est trop petit.'))
  })

  it('formate une réunion avec les noms des voix', () => {
    const message = buildUserMessage(
      context({
        kind: 'meeting',
        rawText: null,
        speakerNames: { '1': 'Ibé' },
        transcript: {
          provider: 'deepgram:nova-3',
          language: 'fr',
          duration_seconds: 80,
          utterances: [{ speaker: 1, start: 62, end: 66, text: 'Le logo est flou.' }],
        },
      }),
    )
    expect(message).toContain('[1:02] Ibé : Le logo est flou.')
  })

  it('refuse une entrée vide', () => {
    expect(() => buildUserMessage(context({ rawText: '   ' }))).toThrow()
    expect(() => buildUserMessage(context({ kind: 'meeting', rawText: null, transcript: null }))).toThrow()
  })

  it('indique l’absence de tickets ouverts', () => {
    expect(buildUserMessage({ ...context(), openTickets: [] })).toContain('(aucun)')
  })
})

describe('ANALYSIS_SYSTEM_PROMPT', () => {
  it('reste stable (aucune date ni identifiant) pour le cache', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(ANALYSIS_SYSTEM_PROMPT).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })
})

describe('format de sortie structurée', () => {
  it('ne contient aucune contrainte non prise en charge par l’API', () => {
    const schema = JSON.stringify(zodOutputFormat(AnalysisSchema).schema)
    for (const keyword of ['"format"', '"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"pattern"']) {
      expect(schema).not.toContain(keyword)
    }
  })
})

describe('analyzeInput : repli Mistral', () => {
  const claudeJson = JSON.stringify({
    tickets: [
      {
        title: 'Agrandir le bouton',
        description: 'Le bouton est trop petit.',
        type: 'modification',
        priority: 'medium',
        source_quote: 'Le bouton est trop petit.',
        area: 'Paiement',
        related_ticket_id: null,
        tasks: [{ title: 'Agrandir le bouton', description: 'Passer à 48 px.', skill: 'dev', depends_on_index: null, estimate_hours: 1 }],
      },
    ],
  })
  const claudeOk = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: claudeJson }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  const mistralTickets = [] as Awaited<ReturnType<typeof mistral.analyzeWithMistral>>
  let stream: ReturnType<typeof vi.spyOn>
  // L'analyse lit la réponse en continu : messages.stream(...).finalMessage().
  const streamOk = () => stream.mockReturnValue({ finalMessage: () => Promise.resolve(claudeOk) } as never)
  const streamKo = () => stream.mockReturnValue({ finalMessage: () => Promise.reject(billingError()) } as never)
  let fallback: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test')
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stream = vi.spyOn(Anthropic.Messages.prototype, 'stream')
    fallback = vi.spyOn(mistral, 'analyzeWithMistral').mockResolvedValue(mistralTickets)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const billingError = () =>
    Anthropic.APIError.generate(400, { error: { message: 'Your credit balance is too low' } }, 'Your credit balance is too low', new Headers())

  it('Claude OK : aucun appel Mistral', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    streamOk()
    const tickets = await analyzeInput(context())
    expect(tickets).toHaveLength(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('crédits épuisés + clé Mistral : bascule sur Mistral avec le même prompt', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    streamKo()
    await expect(analyzeInput(context())).resolves.toBe(mistralTickets)
    const request = fallback.mock.calls[0]![0] as mistral.MistralAnalysisRequest
    expect(request.system).toBe(ANALYSIS_SYSTEM_PROMPT)
    expect(request.content).toBe(buildUserMessage(context()))
    expect(request.openTicketIds).toEqual(['ticket-1'])
  })

  it('Claude KO sans clé Mistral : erreur Claude inchangée', async () => {
    vi.stubEnv('MISTRAL_API_KEY', '')
    streamKo()
    await expect(analyzeInput(context())).rejects.toThrow('requête refusée par l’API Claude : ')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('les deux KO : message combiné', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    streamKo()
    fallback.mockRejectedValue(new Error('clé MISTRAL_API_KEY refusée par l’API Mistral.'))
    await expect(analyzeInput(context())).rejects.toThrow(
      /^Analyse impossible : Claude indisponible \(.*\), et le repli Mistral a échoué \(clé MISTRAL_API_KEY refusée par l’API Mistral\.\)$/,
    )
  })

  it('une entrée vide n’appelle aucun fournisseur', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    await expect(analyzeInput(context({ rawText: ' ' }))).rejects.toThrow()
    expect(stream).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })
})
