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

export interface ApiError {
  error: string
}

/** Audio upload limits, checked on the front and on the server. */
export const AUDIO_MAX_BYTES = 200 * 1024 * 1024
export const AUDIO_BUCKET = 'audio'
