/**
 * Logique pure du parcours d'appel : niveaux de l'onde, progressions (import, analyse), statut d'une entrée
 * → notification, nom du fichier envoyé, projet par défaut. Ni React ni Tauri : testée dans callFlow.test.ts.
 */
import type { CallService, MicApp, MicState, RecordingResult } from '../../../shared/desktop-contract'
import type { Input, InputStatus } from '../../../shared/types'
import { inputTitle, reviewPath } from '../../inputs/inputUtils'
import { createNotification } from '../catalog'
import type { ActivityInput } from '../coordinator'
import { WAVE } from '../geometry'
import type { IslandNotification } from '../types'
import type { IslandProjectOption } from '../view/types'

// ---------------------------------------------------------------------------
// Onde de l'enregistrement
// ---------------------------------------------------------------------------

/** Nombre de niveaux gardés : une barre par niveau (26 barres de la maquette). */
export const LEVEL_BUFFER_SIZE = WAVE.bars

/**
 * Derniers niveaux sonores 0..1 (le plus récent en dernier). `values` garde la même identité : le rendu de
 * l'île la relit à chaque image (boucle de l'onde) sans que React ait à redessiner l'île toutes les 90 ms.
 */
export class LevelBuffer {
  readonly values: number[] = []

  constructor(private readonly size: number = LEVEL_BUFFER_SIZE) {}

  push(level: number): void {
    const clamped = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0
    this.values.push(clamped)
    if (this.values.length > this.size) this.values.splice(0, this.values.length - this.size)
  }

  reset(): void {
    this.values.length = 0
  }
}

// ---------------------------------------------------------------------------
// Appel détecté
// ---------------------------------------------------------------------------

/** Nom affiché quand aucune app d'appel n'est connue (enregistrement lancé à la main). */
export const FALLBACK_APP_NAME = 'Appel'

/** App retenue pour l'île : la première dont on reconnaît le service, sinon la première tout court. */
function mainMicApp(mic: MicState | null | undefined): MicApp | null {
  if (!mic) return null
  return mic.apps.find((a) => a.service) ?? mic.apps[0] ?? null
}

/** Première app d'appel qui utilise le micro (« Discord », « Google Meet »…), null si aucune. */
export function micAppName(mic: MicState | null | undefined): string | null {
  const name = mainMicApp(mic)?.displayName?.trim()
  return name ? name : null
}

/** Service d'appel reconnu de l'app qui utilise le micro (logo et couleur de l'île), null si inconnu. */
export function micService(mic: MicState | null | undefined): CallService | null {
  return mainMicApp(mic)?.service ?? null
}

/** Projet proposé par défaut : le dernier utilisé s'il est encore visible, sinon le premier de la liste. */
export function pickDefaultProject(projects: readonly IslandProjectOption[], lastProjectId: string | null): string | null {
  if (lastProjectId && projects.some((p) => p.id === lastProjectId)) return lastProjectId
  return projects[0]?.id ?? null
}

export function projectNameOf(projects: readonly IslandProjectOption[], projectId: string | null): string | null {
  if (!projectId) return null
  return projects.find((p) => p.id === projectId)?.name ?? null
}

/** Message lisible d'une erreur Tauri (chaîne) ou JS. */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

// ---------------------------------------------------------------------------
// Progressions : import de l'audio, analyse
// ---------------------------------------------------------------------------

export const UPLOAD_PROGRESS_ID = 'prog:upload'
export const UPLOAD_LABEL = 'Import de l’audio'
export const ANALYSIS_LABEL = 'Analyse de l’appel'

/** Débit d'envoi supposé pour l'anneau estimé (octets par seconde, prudent). */
const UPLOAD_BYTES_PER_SEC = 250_000
/** Lecture du fichier, création de l'entrée et lancement de la transcription. */
const UPLOAD_OVERHEAD_MS = 2500
/** Transcription + analyse : base, et part proportionnelle à la durée de l'appel. */
const ANALYSIS_BASE_MS = 25_000
const ANALYSIS_MS_PER_AUDIO_SEC = 40
/** Analyse relancée ou reprise sans durée connue. */
const ANALYSIS_DEFAULT_MS = 60_000

/** Durée estimée de l'import (ms) d'après la taille du fichier ; null : taille inconnue (avant l'arrêt). */
export function estimateUploadMs(sizeBytes: number | null): number {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return UPLOAD_OVERHEAD_MS * 2
  return Math.round(UPLOAD_OVERHEAD_MS + (sizeBytes / UPLOAD_BYTES_PER_SEC) * 1000)
}

/** Durée estimée de la transcription et de l'analyse (ms) d'après la durée de l'appel. */
export function estimateAnalysisMs(durationSecs: number | null): number {
  if (durationSecs === null || !Number.isFinite(durationSecs) || durationSecs <= 0) return ANALYSIS_DEFAULT_MS
  return Math.round(ANALYSIS_BASE_MS + durationSecs * ANALYSIS_MS_PER_AUDIO_SEC)
}

/**
 * « Import de l'audio » : lecture du fichier, création de l'entrée, envoi. L'envoi Supabase ne donne pas
 * d'avancement : anneau estimé (fraction null) d'après la taille du fichier.
 */
export function uploadProgress(now: number, sizeBytes: number | null): ActivityInput {
  return {
    id: UPLOAD_PROGRESS_ID,
    kind: 'progress',
    stage: 'upload',
    label: UPLOAD_LABEL,
    fraction: null,
    startedAt: now,
    estimatedMs: estimateUploadMs(sizeBytes),
    inputId: null,
  }
}

export function analysisProgressId(inputId: string): string {
  return `prog:analyse:${inputId}`
}

/** « Analyse de l'appel » : transcription puis analyse, anneau estimé d'après la durée de l'appel. */
export function analysisProgress(inputId: string, now: number, durationSecs: number | null): ActivityInput {
  return {
    id: analysisProgressId(inputId),
    kind: 'progress',
    stage: 'analyse',
    label: ANALYSIS_LABEL,
    fraction: null,
    startedAt: now,
    estimatedMs: estimateAnalysisMs(durationSecs),
    inputId,
  }
}

// ---------------------------------------------------------------------------
// Statut d'une entrée → suite du parcours
// ---------------------------------------------------------------------------

/** waiting : le serveur travaille (on interroge encore) ; ready / error : on prévient et on arrête. */
export type InputPhase = 'waiting' | 'ready' | 'error'

export function inputPhase(status: InputStatus): InputPhase {
  if (status === 'ready') return 'ready'
  if (status === 'error') return 'error'
  return 'waiting'
}

/** Intervalle entre deux lectures de l'entrée pendant le traitement, et après une lecture en échec. */
export const POLL_MS = 2000
export const POLL_RETRY_MS = 5000

export function inputPath(projectId: string, inputId: string): string {
  return `/projects/${projectId}/inputs/${inputId}`
}

export type AnalysedInput = Pick<Input, 'id' | 'project_id' | 'kind' | 'title' | 'raw_text' | 'created_at'>

/**
 * Analyse terminée : « N tickets à valider » (bouton Valider → écran de validation). Sans ticket proposé :
 * « Aucun ticket proposé » (bouton Ouvrir → fiche de l'entrée, pour lire la transcription).
 */
export function analysisDoneNotification(params: {
  input: AnalysedInput
  proposedCount: number
  projectName: string | null
}): IslandNotification {
  const { input, proposedCount, projectName } = params
  const count = Math.max(0, Math.floor(proposedCount))
  return createNotification('tickets', {
    count,
    inputTitle: inputTitle(input),
    projectName: projectName ?? 'le projet',
    route: count > 0 ? reviewPath(input.project_id, input.id) : inputPath(input.project_id, input.id),
    inputId: input.id,
  })
}

export const DEFAULT_ANALYSIS_ERROR = 'Une erreur est survenue pendant le traitement'

export function analysisErrorNotification(inputId: string, message: string | null): IslandNotification {
  return createNotification('analysisError', { inputId, message: message?.trim() || DEFAULT_ANALYSIS_ERROR })
}

// ---------------------------------------------------------------------------
// Fichier envoyé
// ---------------------------------------------------------------------------

export function extensionOf(mimeType: string): string {
  if (mimeType === 'audio/mpeg') return 'mp3'
  return mimeType.split('/')[1]?.split(';')[0]?.trim() || 'mp3'
}

/** « appel-202611201430.mp3 » (heure locale de l'envoi). */
export function recordingFileName(result: Pick<RecordingResult, 'mimeType'>, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
  return `appel-${stamp}.${extensionOf(result.mimeType)}`
}

/** Sous-titre de « Un appel n'a pas été envoyé » quand plusieurs enregistrements attendent. */
export function pendingDetail(count: number): string | undefined {
  return count > 1 ? `${count} enregistrements gardés sur cet ordinateur` : undefined
}
