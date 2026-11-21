/**
 * Transcription with Deepgram (pre-recorded audio, from a URL), French + speaker diarization.
 * nova-3 supports French ("fr") and diarization works on all Nova batch models
 * (developers.deepgram.com/docs/models-languages-overview and /docs/diarization, checked 2026-11-18).
 */
import { z } from 'zod'
import type { Transcript, TranscriptUtterance } from '../../src/shared/types.js'
import { getEnv } from './env.js'

export const DEEPGRAM_MODEL = 'nova-3'
export const DEEPGRAM_LANGUAGE = 'fr'
const DEEPGRAM_ENDPOINT = 'https://api.deepgram.com/v1/listen'
/** Below Vercel's maxDuration (300 s), with room left for the analysis of short meetings. */
const DEEPGRAM_TIMEOUT_MS = 240_000

export function deepgramListenUrl(): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
  })
  return `${DEEPGRAM_ENDPOINT}?${params.toString()}`
}

const DeepgramResponseSchema = z.object({
  metadata: z.object({ duration: z.number().optional() }).partial().optional(),
  results: z
    .object({
      utterances: z
        .array(
          z.object({
            speaker: z.number().optional(),
            start: z.number(),
            end: z.number(),
            transcript: z.string(),
          }),
        )
        .optional(),
      channels: z
        .array(
          z.object({
            alternatives: z.array(z.object({ transcript: z.string().optional() })).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

/** Converts a Deepgram /v1/listen response into our Transcript. Throws if there is no speech. */
export function deepgramToTranscript(payload: unknown): Transcript {
  const parsed = DeepgramResponseSchema.safeParse(payload)
  if (!parsed.success) throw new Error('réponse de Deepgram illisible.')
  const { metadata, results } = parsed.data
  const duration = typeof metadata?.duration === 'number' && Number.isFinite(metadata.duration) ? metadata.duration : null

  let utterances: TranscriptUtterance[] = (results?.utterances ?? [])
    .map((u) => ({
      speaker: typeof u.speaker === 'number' && u.speaker >= 0 ? Math.floor(u.speaker) : 0,
      start: u.start,
      end: u.end,
      text: u.transcript.trim(),
    }))
    .filter((u) => u.text !== '')
    .sort((a, b) => a.start - b.start)

  // Without utterances (should not happen with utterances=true), keep the plain transcript as one voice.
  if (utterances.length === 0) {
    const text = results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (text) utterances = [{ speaker: 0, start: 0, end: duration ?? 0, text }]
  }
  if (utterances.length === 0) throw new Error("aucune parole détectée dans l'audio.")

  return { provider: `deepgram:${DEEPGRAM_MODEL}`, language: DEEPGRAM_LANGUAGE, duration_seconds: duration, utterances }
}

/** Error detail from Deepgram, without any URL (the signed audio URL must never be stored or logged). */
export function deepgramErrorDetail(body: string): string {
  return rawDeepgramErrorDetail(body).replace(/https?:\/\/\S+/g, '[url]')
}

function rawDeepgramErrorDetail(body: string): string {
  try {
    const data = JSON.parse(body) as { err_msg?: unknown; message?: unknown; reason?: unknown }
    const detail = [data.err_msg, data.message, data.reason].find((v) => typeof v === 'string' && v.trim() !== '')
    if (typeof detail === 'string') return detail.slice(0, 300)
  } catch {
    // not JSON
  }
  return body.trim().slice(0, 300) || 'aucun détail'
}

/** Sends one request to Deepgram and returns the parsed JSON. Errors have a French message, never a URL. */
async function callDeepgram(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Deepgram n'a pas répondu en ${timeoutMs / 1000} s.`, { cause: error })
    }
    throw new Error('Deepgram est injoignable (erreur réseau).', { cause: error })
  }

  const body = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`clé TRANSCRIPTION_API_KEY refusée par Deepgram (${response.status}).`)
    }
    throw new Error(`Deepgram a répondu ${response.status} : ${deepgramErrorDetail(body)}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('réponse de Deepgram vide ou illisible.')
  }
}

/** Transcribes the audio at `audioUrl` (a signed URL, never logged). */
export async function transcribeFromUrl(audioUrl: string): Promise<Transcript> {
  const apiKey = getEnv('TRANSCRIPTION_API_KEY')
  const payload = await callDeepgram(
    deepgramListenUrl(),
    {
      method: 'POST',
      headers: { authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: audioUrl }),
    },
    DEEPGRAM_TIMEOUT_MS,
  )
  return deepgramToTranscript(payload)
}

/** The recording contains no recognizable speech (becomes a 422, not a server error). */
export class NoSpeechError extends Error {
  constructor() {
    super("aucune parole détectée dans l'audio.")
    this.name = 'NoSpeechError'
  }
}

/** Short voice notes: far below Vercel's maxDuration, a recording of a few minutes is transcribed in seconds. */
const DEEPGRAM_VOICE_TIMEOUT_MS = 60_000

/** Deepgram URL for a plain transcript (no diarization, no utterances). */
export function deepgramVoiceListenUrl(): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    punctuate: 'true',
    smart_format: 'true',
  })
  return `${DEEPGRAM_ENDPOINT}?${params.toString()}`
}

/** Plain text of a Deepgram response (first channel, first alternative). Throws NoSpeechError if empty. */
export function deepgramToText(payload: unknown): string {
  const parsed = DeepgramResponseSchema.safeParse(payload)
  if (!parsed.success) throw new Error('réponse de Deepgram illisible.')
  const text = parsed.data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  if (!text) throw new NoSpeechError()
  return text
}

/** Transcribes an in-memory audio (nothing is stored). Throws NoSpeechError when there is no speech. */
export async function transcribeAudio(audio: ArrayBuffer | Uint8Array, contentType: string): Promise<string> {
  const apiKey = getEnv('TRANSCRIPTION_API_KEY')
  const payload = await callDeepgram(
    deepgramVoiceListenUrl(),
    {
      method: 'POST',
      headers: { authorization: `Token ${apiKey}`, 'content-type': contentType },
      body: audio as BodyInit,
    },
    DEEPGRAM_VOICE_TIMEOUT_MS,
  )
  return deepgramToText(payload)
}
