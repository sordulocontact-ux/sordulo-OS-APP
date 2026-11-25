import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AnalysisSchema } from '../../src/shared/analysis-schema.js'
import { analyzeInput, ANALYSIS_SYSTEM_PROMPT, buildUserMessage, type AnalysisContext } from './analysis.js'
import * as mistral from './mistral.js'

const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function context(overrides: Partial<AnalysisContext['input']> = {}): AnalysisContext {
  return {
    clientName: 'Ibé',
    projectName: 'App Ibé',
    toneOfVoice: 'Chaleureux, tutoiement',
    aiInstructions: null,
    team: [
      { id: MAEL, name: 'Maël' },
      { id: SACHA, name: 'Sacha' },
    ],
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
    expect(message).not.toContain('moment_marque')
  })

  it('entoure les passages à ±30 s d’un moment marqué', () => {
    const message = buildUserMessage(
      context({
        kind: 'meeting',
        rawText: null,
        speakerNames: { '1': 'Ibé' },
        markers: [130],
        transcript: {
          provider: 'deepgram:nova-3',
          language: 'fr',
          duration_seconds: 300,
          utterances: [
            { speaker: 0, start: 2, end: 5, text: 'Bonjour.' },
            { speaker: 1, start: 120, end: 126, text: 'Le logo est flou.' },
            { speaker: 0, start: 250, end: 252, text: 'Merci.' },
          ],
        },
      }),
    )
    expect(message).toContain(
      ['[0:02] Voix 1 : Bonjour.', '<moment_marque>', '[2:00] Ibé : Le logo est flou.', '</moment_marque>', '[4:10] Voix 1 : Merci.'].join('\n'),
    )
  })

  it('refuse une entrée vide', () => {
    expect(() => buildUserMessage(context({ rawText: '   ' }))).toThrow()
    expect(() => buildUserMessage(context({ kind: 'meeting', rawText: null, transcript: null }))).toThrow()
  })

  it('indique « non renseigné » quand le ton de voix est vide', () => {
    expect(buildUserMessage({ ...context(), toneOfVoice: null })).toContain('Ton de voix : non renseigné')
    expect(buildUserMessage({ ...context(), toneOfVoice: '  \n ' })).toContain('Ton de voix : non renseigné')
  })

  it('indique l’absence de tickets ouverts', () => {
    expect(buildUserMessage({ ...context(), openTickets: [] })).toContain('(aucun)')
  })

  it('ajoute les consignes de l’équipe dans le bloc projet', () => {
    const message = buildUserMessage({ ...context(), aiInstructions: '  - Maël s’occupe des pages Finance\n- Sacha de l’onboarding  ' })
    expect(message).toContain("Consignes de l'équipe :\n- Maël s’occupe des pages Finance\n- Sacha de l’onboarding\n</projet>")
  })

  it('indique « aucune » quand le projet n’a pas de consignes', () => {
    expect(buildUserMessage(context())).toContain("Consignes de l'équipe : aucune")
    expect(buildUserMessage({ ...context(), aiInstructions: ' \n ' })).toContain("Consignes de l'équipe : aucune")
  })

  it('liste l’équipe attribuable avec les ids', () => {
    const message = buildUserMessage(context())
    expect(message).toContain(`<equipe>\n- id: ${MAEL} | nom: Maël\n- id: ${SACHA} | nom: Sacha\n</equipe>`)
    expect(buildUserMessage({ ...context(), team: [] })).toContain('<equipe>\n(personne)\n</equipe>')
  })
})

describe('ANALYSIS_SYSTEM_PROMPT', () => {
  it('dit quoi faire du ton de voix du projet', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('Ton de voix : s\'il est renseigné')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('rédige les titres et les descriptions des tickets dans ce ton')
  })

  it('demande une description complète, prête pour le skill /ticket', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('skill « /ticket »')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('reprends TOUS les détails utiles')
    for (const section of ['« Contexte : »', '« À faire : »', '« Critères de validation : »', '« Points à préciser : »']) {
      expect(ANALYSIS_SYSTEM_PROMPT).toContain(section)
    }
    expect(ANALYSIS_SYSTEM_PROMPT).not.toContain('une à cinq phrases')
  })

  it('dit de suivre les consignes et de désigner seulement une personne de l’équipe', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("Consignes de l'équipe")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('assignee_member_id')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("N'utilise jamais un id absent de <equipe>")
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('lever la règle 16')
  })

  it('signale les moments marqués : pas de demande sans ticket, from_marker, priorité inchangée', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('<moment_marque>')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('elle ne doit pas rester sans ticket')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('from_marker : true si le ticket vient')
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('ne change pas la priorité')
    expect(ANALYSIS_SYSTEM_PROMPT).not.toContain('—')
  })

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

  it('demande from_marker (booléen obligatoire)', () => {
    const schema = zodOutputFormat(AnalysisSchema).schema as {
      properties: { tickets: { items: { properties: Record<string, { type?: string }>; required: string[] } } }
    }
    const ticket = schema.properties.tickets.items
    expect(ticket.properties.from_marker?.type).toBe('boolean')
    expect(ticket.required).toContain('from_marker')
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
        from_marker: false,
        area: 'Paiement',
        related_ticket_id: null,
        assignee_member_id: MAEL,
        assignment_reason: 'Maël s’occupe du paiement',
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
    expect(tickets[0]).toMatchObject({ assignee_member_id: MAEL, assignment_reason: 'Maël s’occupe du paiement' })
    expect(fallback).not.toHaveBeenCalled()
    // Hors de l'équipe : la personne désignée est ignorée.
    await expect(analyzeInput({ ...context(), team: [] })).resolves.toMatchObject([{ assignee_member_id: null, assignment_reason: null }])
  })

  it('envoie le ton de voix du projet à Claude, et au repli Mistral', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    streamOk()
    await analyzeInput(context())
    const claudeRequest = stream.mock.calls[0]![0] as { messages: { role: string; content: string }[] }
    expect(claudeRequest.messages[0]?.content).toContain('Ton de voix : Chaleureux, tutoiement')

    streamKo()
    await analyzeInput({ ...context(), toneOfVoice: 'Sobre, vouvoiement' })
    const mistralRequest = fallback.mock.calls[0]![0] as mistral.MistralAnalysisRequest
    expect(mistralRequest.content).toContain('Ton de voix : Sobre, vouvoiement')
    expect(mistralRequest.system).toContain('rédige les titres et les descriptions des tickets dans ce ton')
  })

  it('crédits épuisés + clé Mistral : bascule sur Mistral avec le même prompt', async () => {
    vi.stubEnv('MISTRAL_API_KEY', 'm')
    streamKo()
    await expect(analyzeInput(context())).resolves.toBe(mistralTickets)
    const request = fallback.mock.calls[0]![0] as mistral.MistralAnalysisRequest
    expect(request.system).toBe(ANALYSIS_SYSTEM_PROMPT)
    expect(request.content).toBe(buildUserMessage(context()))
    expect(request.openTicketIds).toEqual(['ticket-1'])
    expect(request.teamMemberIds).toEqual([MAEL, SACHA])
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
