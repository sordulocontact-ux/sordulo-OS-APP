/**
 * Retrouver la citation d'un ticket dans la transcription de sa réunion. Partagé par le front (onglet Tickets :
 * « écouter le passage ») et l'API (ticket tiré d'un moment marqué, `from_marker`). Sans dépendance Node.
 */
import type { Transcript, TranscriptUtterance } from './types.js'

/** Lowercase, no accents, no punctuation, single spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const MIN_REVERSE_LENGTH = 20
const PREFIX_WORDS = 8

/** Utterance of the transcript that contains the quote (simple, normalized search). Null if not found. */
export function findQuoteUtterance(
  transcript: Pick<Transcript, 'utterances'> | null | undefined,
  quote: string | null | undefined,
): TranscriptUtterance | null {
  const needle = normalizeText(quote ?? '')
  if (!transcript || needle === '') return null
  const items = transcript.utterances.map((utterance) => ({ utterance, text: normalizeText(utterance.text) }))
  const exact = items.find((item) => item.text.includes(needle))
  if (exact) return exact.utterance
  // The quote may span several utterances: match the utterance that starts it.
  const reverse = items.find((item) => item.text.length >= MIN_REVERSE_LENGTH && needle.includes(item.text))
  if (reverse) return reverse.utterance
  const prefix = needle.split(' ').slice(0, PREFIX_WORDS).join(' ')
  if (prefix.length >= MIN_REVERSE_LENGTH) {
    const start = items.find((item) => item.text.includes(prefix))
    if (start) return start.utterance
  }
  return null
}
