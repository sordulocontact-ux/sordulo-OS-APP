/** Pure logic of the voice note (no React, no browser API): format, durations, messages. */
import { VOICE_NOTE_MAX_BYTES } from '../../shared/api-contract'

/** Formats, in order of preference, that the browser may record. Safari only knows audio/mp4. */
export const VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'] as const

/** First supported format, or '' to let the browser choose. */
export function pickMimeType(isSupported: (type: string) => boolean): string {
  return VOICE_MIME_TYPES.find((type) => isSupported(type)) ?? ''
}

/** 42 -> « 0:42 », 605 -> « 10:05 ». */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Adds a transcript at the end of the note, on its own line, without overwriting what is already typed. */
export function appendTranscript(note: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return note
  const base = note.replace(/\s+$/, '')
  return base ? `${base}\n${text}` : text
}

export const VOICE_ERRORS = {
  denied: 'Accès au micro refusé. Autorise le micro dans le navigateur, ou tape ta note.',
  noMicrophone: 'Aucun micro trouvé. Branche un micro, ou tape ta note.',
  unsupported: "Ce navigateur ne permet pas d'enregistrer le micro. Tape ta note.",
  busy: 'Le micro est déjà utilisé par une autre application. Ferme-la, ou tape ta note.',
  tooLarge: 'Enregistrement trop long pour être transcrit. Fais une note plus courte, ou tape-la.',
  empty: "Rien n'a été enregistré. Réessaie, ou tape ta note.",
  failed: "L'enregistrement a échoué. Réessaie, ou tape ta note.",
} as const

/** French message for an error thrown by getUserMedia or MediaRecorder. */
export function recorderErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return VOICE_ERRORS.denied
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return VOICE_ERRORS.noMicrophone
  if (name === 'NotReadableError' || name === 'AbortError') return VOICE_ERRORS.busy
  return VOICE_ERRORS.failed
}

/** Message if the recording cannot be sent, null if it can. */
export function checkRecording(size: number): string | null {
  if (size === 0) return VOICE_ERRORS.empty
  if (size > VOICE_NOTE_MAX_BYTES) return VOICE_ERRORS.tooLarge
  return null
}
