/**
 * Ce que l'île garde dans le stockage local (localStorage, partagé par les fenêtres de l'app de bureau) :
 * dernier projet choisi, enregistrements arrêtés mais pas encore envoyés, entrées dont on suit l'analyse.
 */
import type { RecordingResult } from '../../shared/desktop-contract'

const LAST_PROJECT_KEY = 'sordulo.desktop.lastProjectId'
/** Ancienne clé : un seul enregistrement en attente (lue pour reprise, puis remplacée par la file). */
const LEGACY_PENDING_KEY = 'sordulo.desktop.pendingRecording'
const PENDING_KEY = 'sordulo.desktop.pendingRecordings'
const TRACKED_KEY = 'sordulo.desktop.trackedInputs'

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Stockage indisponible : la reprise marche encore tant que la fenêtre reste ouverte.
  }
}

export function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function writeLastProjectId(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
  } catch {
    // Stockage indisponible : le projet par défaut ne sera simplement pas retenu.
  }
}

function isRecordingResult(value: unknown): value is RecordingResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<RecordingResult>
  return typeof v.path === 'string' && typeof v.projectId === 'string'
}

/**
 * Enregistrements arrêtés mais pas encore envoyés, du plus ancien au plus récent. Le fichier reste sur
 * l'ordinateur tant qu'il est ici : une relance ne perd jamais un appel, même après un nouvel enregistrement.
 */
export function readPendingRecordings(): RecordingResult[] {
  const list = readJson(PENDING_KEY)
  const pending = Array.isArray(list) ? list.filter(isRecordingResult) : []
  const legacy = readJson(LEGACY_PENDING_KEY)
  if (isRecordingResult(legacy) && !pending.some((r) => r.path === legacy.path)) pending.unshift(legacy)
  return pending
}

function writePendingRecordings(list: RecordingResult[]): void {
  writeJson(PENDING_KEY, list.length > 0 ? list : null)
  writeJson(LEGACY_PENDING_KEY, null)
}

/** Ajoute un enregistrement à la file (sans doublon de fichier). */
export function addPendingRecording(result: RecordingResult): void {
  const list = readPendingRecordings().filter((r) => r.path !== result.path)
  writePendingRecordings([...list, result])
}

/** Retire un enregistrement de la file (après un envoi réussi). */
export function removePendingRecording(path: string): void {
  writePendingRecordings(readPendingRecordings().filter((r) => r.path !== path))
}

/** Entrée dont l'île suit le traitement (transcription puis analyse), pour le reprendre au redémarrage. */
export interface TrackedInput {
  inputId: string
  /** Durée de l'appel, pour estimer l'anneau de l'analyse. */
  durationSecs: number | null
}

export function readTrackedInputs(): TrackedInput[] {
  const list = readJson(TRACKED_KEY)
  if (!Array.isArray(list)) return []
  return list.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const v = item as Partial<TrackedInput>
    if (typeof v.inputId !== 'string') return []
    return [{ inputId: v.inputId, durationSecs: typeof v.durationSecs === 'number' ? v.durationSecs : null }]
  })
}

export function addTrackedInput(tracked: TrackedInput): void {
  const list = readTrackedInputs().filter((t) => t.inputId !== tracked.inputId)
  writeJson(TRACKED_KEY, [...list, tracked])
}

export function removeTrackedInput(inputId: string): void {
  const list = readTrackedInputs().filter((t) => t.inputId !== inputId)
  writeJson(TRACKED_KEY, list.length > 0 ? list : null)
}
