/**
 * Transcript helpers shared by the front (input page) and the API (analysis prompt).
 * No Node dependency.
 */
import type { SpeakerNames, Transcript } from './types.js'

/** Name given to a voice, otherwise "Voix N" (N = index + 1). */
export function speakerLabel(index: number, speakerNames: SpeakerNames | null | undefined): string {
  const name = speakerNames?.[String(index)]?.trim()
  return name ? name : `Voix ${index + 1}`
}

/** 75 -> "1:15", 3725 -> "1:02:05". Negative or invalid values count as 0. */
export function formatTimestamp(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/** One line per utterance: "[m:ss] Name : text". Empty utterances are skipped. */
export function formatTranscriptForPrompt(
  transcript: Pick<Transcript, 'utterances'>,
  speakerNames: SpeakerNames | null | undefined,
): string {
  return transcript.utterances
    .filter((u) => u.text.trim() !== '')
    .map((u) => `[${formatTimestamp(u.start)}] ${speakerLabel(u.speaker, speakerNames)} : ${u.text.trim()}`)
    .join('\n')
}
