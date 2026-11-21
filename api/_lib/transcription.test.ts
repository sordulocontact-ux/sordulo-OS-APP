import { describe, expect, it } from 'vitest'
import {
  deepgramErrorDetail,
  deepgramListenUrl,
  deepgramToText,
  deepgramToTranscript,
  deepgramVoiceListenUrl,
  NoSpeechError,
} from './transcription.js'

describe('deepgramToTranscript', () => {
  it('convertit les utterances en Transcript, triées par début', () => {
    const transcript = deepgramToTranscript({
      metadata: { duration: 300.5 },
      results: {
        utterances: [
          { speaker: 1, start: 10, end: 12, transcript: 'Oui, très bien.', confidence: 0.9 },
          { speaker: 0, start: 1, end: 4, transcript: ' Bonjour Ibé. ' },
          { speaker: 0, start: 13, end: 14, transcript: '' },
        ],
      },
    })
    expect(transcript).toEqual({
      provider: 'deepgram:nova-3',
      language: 'fr',
      duration_seconds: 300.5,
      utterances: [
        { speaker: 0, start: 1, end: 4, text: 'Bonjour Ibé.' },
        { speaker: 1, start: 10, end: 12, text: 'Oui, très bien.' },
      ],
    })
  })

  it('reprend le texte brut sans utterances', () => {
    const transcript = deepgramToTranscript({
      metadata: { duration: 20 },
      results: { channels: [{ alternatives: [{ transcript: 'Un seul bloc.' }] }] },
    })
    expect(transcript.utterances).toEqual([{ speaker: 0, start: 0, end: 20, text: 'Un seul bloc.' }])
  })

  it('lève une erreur lisible si la réponse est vide', () => {
    expect(() => deepgramToTranscript({ results: { utterances: [] } })).toThrow(/aucune parole/)
    expect(() => deepgramToTranscript('pas un objet')).toThrow(/illisible/)
  })
})

describe('deepgram', () => {
  it('appelle nova-3 en français avec la diarisation', () => {
    const url = new URL(deepgramListenUrl())
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('language')).toBe('fr')
    expect(url.searchParams.get('diarize')).toBe('true')
    expect(url.searchParams.get('utterances')).toBe('true')
  })

  it('retire les URL des messages d’erreur', () => {
    const detail = deepgramErrorDetail(JSON.stringify({ err_msg: 'Could not fetch https://x.supabase.co/a?token=secret' }))
    expect(detail).toBe('Could not fetch [url]')
  })
})

describe('note vocale', () => {
  it('appelle nova-3 en français sans diarisation', () => {
    const params = new URL(deepgramVoiceListenUrl()).searchParams
    expect(params.get('model')).toBe('nova-3')
    expect(params.get('language')).toBe('fr')
    expect(params.get('punctuate')).toBe('true')
    expect(params.get('smart_format')).toBe('true')
    expect(params.get('diarize')).toBeNull()
  })

  it('renvoie le texte du premier canal, sans espaces autour', () => {
    expect(deepgramToText({ results: { channels: [{ alternatives: [{ transcript: ' Bonjour. ' }] }] } })).toBe('Bonjour.')
  })

  it('lève NoSpeechError si le texte est vide', () => {
    expect(() => deepgramToText({ results: { channels: [{ alternatives: [{ transcript: '  ' }] }] } })).toThrow(NoSpeechError)
    expect(() => deepgramToText({})).toThrow(NoSpeechError)
  })

  it('lève une erreur lisible si la réponse est illisible', () => {
    expect(() => deepgramToText('pas un objet')).toThrow(/illisible/)
  })
})
