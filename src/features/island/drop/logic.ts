/**
 * Logique pure du glisser-déposer : type du fichier, zones proposées, géométrie du curseur.
 * Ni React ni Tauri : testée dans logic.test.ts, utilisée par controller/sources/drop.ts.
 */
import type { ClaudeSession, ClaudeSessionStatus } from '../types'
import type { IslandDropInfo, IslandDropZone } from '../view/types'

// ---------------------------------------------------------------------------
// Fichier glissé
// ---------------------------------------------------------------------------

/** Type MIME par extension audio. Même liste que `AUDIO_EXTENSIONS` de src-tauri/src/dropped.rs. */
const AUDIO_MIME: Readonly<Record<string, string>> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  aac: 'audio/aac',
  flac: 'audio/flac',
  // Conteneur mp4 : accepté par l'API (video/mp4) et lu comme audio par la transcription.
  mp4: 'video/mp4',
}

export const AUDIO_EXTENSIONS: readonly string[] = Object.keys(AUDIO_MIME)

/** « C:\Users\moi\Documents\appel.M4A » → « appel.M4A » (les deux séparateurs, quel que soit le système). */
export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}

/** Extension en minuscules, sans point ; chaîne vide s'il n'y en a pas (« .mp3 » seul n'en a pas). */
export function extensionOf(path: string): string {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Type MIME du fichier si c'est un audio accepté, sinon null. */
export function audioMimeOf(path: string): string | null {
  return AUDIO_MIME[extensionOf(path)] ?? null
}

export function isAudioPath(path: string): boolean {
  return audioMimeOf(path) !== null
}

/** « Réunion Ibé.m4a » → « Réunion Ibé » (titre de l'entrée créée). */
export function titleOf(path: string): string {
  const name = fileNameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * Une session Claude Code « active » : tout statut sauf terminée (`done`) ou inactive (`idle`). Une session
 * qui travaille, attend une réponse ou dort (`sleep`) a encore son terminal ouvert, où coller un chemin.
 */
const INACTIVE_STATUSES: readonly ClaudeSessionStatus[] = ['done', 'idle']

export function hasActiveClaudeSession(sessions: readonly ClaudeSession[]): boolean {
  return sessions.some((session) => !INACTIVE_STATUSES.includes(session.status))
}

/**
 * Zones proposées pour un fichier : Transcrire pour l'audio seulement, Claude Code si une session est
 * active, Fichiers jamais (les fichiers de projet n'existent pas encore : zone masquée, pas seulement
 * inactive).
 */
export function zonesFor(path: string, sessions: readonly ClaudeSession[]): IslandDropInfo['zones'] {
  return { transcribe: isAudioPath(path), files: false, claude: hasActiveClaudeSession(sessions) }
}

export function dropInfoFor(params: {
  path: string
  sessions: readonly ClaudeSession[]
  projectName: string | null
}): IslandDropInfo {
  return { fileName: fileNameOf(params.path), projectName: params.projectName, zones: zonesFor(params.path, params.sessions) }
}

/** Une zone peut recevoir le fichier : proposée ET survolée valide. Null : le dépôt est annulé. */
export function actionableZone(zone: IslandDropZone | null, info: IslandDropInfo | null): 'transcribe' | 'claude' | null {
  if (!zone || !info?.zones[zone]) return null
  return zone === 'transcribe' || zone === 'claude' ? zone : null
}

// ---------------------------------------------------------------------------
// Géométrie
// ---------------------------------------------------------------------------

/** Rectangle en px CSS (comme `DOMRect`). */
export interface DropRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Marge autour de la forme qui garde l'île ouverte pendant le glissement (prototype : inRect(island, 24)). */
export const DRAG_KEEP_MARGIN = 24
/** Pour passer de « Dépose ici » aux zones, le curseur doit être sur la forme elle-même. */
export const DRAG_ENTER_MARGIN = 0

/** Le point (x, y) est dans `rect` agrandi de `margin` de chaque côté. */
export function inRect(rect: DropRect, margin: number, x: number, y: number): boolean {
  return x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin
}

export function inAnyRect(rects: readonly DropRect[], margin: number, x: number, y: number): boolean {
  return rects.some((rect) => inRect(rect, margin, x, y))
}

/** Position physique (px de l'écran, relative à la webview) → px CSS. Un ratio invalide vaut 1. */
export function toCssPoint(position: { x: number; y: number }, devicePixelRatio: number): { x: number; y: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return { x: position.x / ratio, y: position.y / ratio }
}
