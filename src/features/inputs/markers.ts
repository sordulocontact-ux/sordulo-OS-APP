/**
 * Moments marqués dans la transcription de la fiche d'une entrée (inputs.markers, secondes depuis le début
 * de l'audio). Pur : ni React ni Supabase. La fenêtre ±30 s est celle de l'analyse (isNearMarker,
 * src/shared/transcript.ts).
 */
import type { TranscriptUtterance } from '../../shared/types'

/** Repères utilisables : finis, positifs, triés, sans doublon. Absent (anciennes entrées) : aucun. */
export function cleanMarkers(markers: readonly number[] | null | undefined): number[] {
  if (!Array.isArray(markers)) return []
  const valid = markers.filter((m) => typeof m === 'number' && Number.isFinite(m) && m >= 0)
  return [...new Set(valid)].sort((a, b) => a - b)
}

/**
 * Place de chaque repère dans la transcription : index de la première réplique qui le chevauche
 * (start ≤ repère ≤ end), sinon de la première qui commence après lui (repère dans un silence), sinon
 * `utterances.length` (après la dernière réplique). Renvoie, par index, les repères à afficher juste avant.
 */
export function markerAnchors(
  utterances: readonly Pick<TranscriptUtterance, 'start' | 'end'>[],
  markers: readonly number[],
): Map<number, number[]> {
  const anchors = new Map<number, number[]>()
  for (const marker of markers) {
    let index = utterances.findIndex((u) => u.start <= marker && marker <= Math.max(u.start, u.end))
    if (index < 0) index = utterances.findIndex((u) => u.start > marker)
    if (index < 0) index = utterances.length
    anchors.set(index, [...(anchors.get(index) ?? []), marker])
  }
  return anchors
}

/** Id DOM du repère n (0 = premier), pour y amener la liste des repères. */
export function markerElementId(index: number): string {
  return `moment-marque-${index + 1}`
}
