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

/**
 * Fenêtre autour d'un moment marqué pendant l'appel, en secondes de chaque côté : les passages qui la
 * touchent sont signalés à l'analyse, et un ticket dont la citation y tombe porte l'étoile (`from_marker`).
 */
export const MARKER_WINDOW_SECS = 30

/** Balises qui entourent les passages proches d'un repère dans le prompt (règle des moments marqués). */
export const MARKED_PASSAGE_OPEN = '<moment_marque>'
export const MARKED_PASSAGE_CLOSE = '</moment_marque>'

/**
 * Vrai si l'intervalle [start, end] (secondes) touche la fenêtre [m - 30, m + 30] d'au moins un repère.
 * Valeurs non finies ignorées ; un intervalle à l'envers compte comme le seul instant `start`.
 */
export function isNearMarker(start: number, end: number, markers: readonly number[] | null | undefined): boolean {
  if (!markers || markers.length === 0 || !Number.isFinite(start)) return false
  const to = Number.isFinite(end) && end >= start ? end : start
  return markers.some((m) => Number.isFinite(m) && start <= m + MARKER_WINDOW_SECS && to >= m - MARKER_WINDOW_SECS)
}

/**
 * One line per utterance: "[m:ss] Name : text". Empty utterances are skipped.
 * With `markers` (moments marqués, secondes depuis le début de l'audio), the consecutive lines near a marker
 * (see isNearMarker) are wrapped in a <moment_marque> … </moment_marque> block.
 */
export function formatTranscriptForPrompt(
  transcript: Pick<Transcript, 'utterances'>,
  speakerNames: SpeakerNames | null | undefined,
  markers?: readonly number[] | null,
): string {
  const lines: string[] = []
  let open = false
  for (const u of transcript.utterances) {
    if (u.text.trim() === '') continue
    const near = isNearMarker(u.start, u.end, markers)
    if (near !== open) {
      lines.push(near ? MARKED_PASSAGE_OPEN : MARKED_PASSAGE_CLOSE)
      open = near
    }
    lines.push(`[${formatTimestamp(u.start)}] ${speakerLabel(u.speaker, speakerNames)} : ${u.text.trim()}`)
  }
  if (open) lines.push(MARKED_PASSAGE_CLOSE)
  return lines.join('\n')
}
