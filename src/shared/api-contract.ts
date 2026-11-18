/**
 * HTTP contract of the serverless functions in /api.
 * Every request carries `Authorization: Bearer <supabase access token>`.
 * Errors: non-2xx with body { error: string } (French, shown to the user).
 */
import type { Input } from './types.js'

/** POST /api/inputs/create — written feedback: creates the input and starts the analysis. */
export interface CreateWrittenInputRequest {
  projectId: string
  kind: 'written'
  title?: string
  rawText: string
}

/** POST /api/inputs/create — meeting: creates the input (status "uploaded") and returns a signed upload URL. */
export interface CreateMeetingInputRequest {
  projectId: string
  kind: 'meeting'
  title?: string
  fileName: string
  contentType: string
  sizeBytes: number
}

export type CreateInputRequest = CreateWrittenInputRequest | CreateMeetingInputRequest

export interface SignedUpload {
  /** Storage path inside the audio bucket. */
  path: string
  /** Token for supabase.storage.from(bucket).uploadToSignedUrl(path, token, file). */
  token: string
  bucket: string
}

export interface CreateInputResponse {
  input: Input
  upload?: SignedUpload
}

/**
 * POST /api/inputs/process — (re)starts processing of an input in the background and answers 202 at once.
 * Meeting: transcription (skipped if a transcript already exists) then analysis. Written: analysis.
 * Re-running replaces the input's tickets still in "proposed" status (no duplicates).
 * Progress is read by polling the `inputs` row (status, error_message).
 */
export interface ProcessInputRequest {
  inputId: string
}

export interface ProcessInputResponse {
  inputId: string
  status: Input['status']
}

/**
 * POST /api/inputs/delete — supprime une entrée, ses tickets encore proposés ou refusés (et leurs tâches)
 * et son fichier audio. Les tickets validés ou faits restent dans le projet (input_id passe à null).
 * 409 pendant un traitement en cours.
 */
export interface DeleteInputRequest {
  inputId: string
}

export interface DeleteInputResponse {
  inputId: string
  /** Tickets supprimés avec l'entrée. */
  deletedTickets: number
  /** Tickets validés conservés dans le projet. */
  keptTickets: number
}

/** POST /api/inputs/audio-url — lien temporaire (5 min) pour télécharger l'audio d'une réunion. */
export interface AudioUrlRequest {
  inputId: string
}

export interface AudioUrlResponse {
  url: string
}

export interface ApiError {
  error: string
}

/** Audio upload limits, checked on the front and on the server. */
/** Supabase Free: 50 MB max per file (checked in the Storage settings). */
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024
export const AUDIO_BUCKET = 'audio'
