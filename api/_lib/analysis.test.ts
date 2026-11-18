import { describe, expect, it } from 'vitest'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AnalysisSchema } from '../../src/shared/analysis-schema.js'
import { ANALYSIS_SYSTEM_PROMPT, buildUserMessage, type AnalysisContext } from './analysis.js'

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
