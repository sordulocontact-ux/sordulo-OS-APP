/**
 * HTTP contract of the serverless functions in /api.
 * Every request carries `Authorization: Bearer <supabase access token>`.
 * Errors: non-2xx with body { error: string } (French, shown to the user).
 */
import type { Input, Member, MemberRole } from './types.js'

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

/**
 * POST /api/members/invite — réservé aux admins de l'organisation.
 * Crée le membre (ou refuse si l'email existe déjà dans l'organisation : 409), crée son compte de connexion
 * s'il n'existe pas, puis renvoie un lien de connexion à usage unique à copier et envoyer soi-même
 * (aucun email n'est envoyé). Le lien expire selon le réglage Supabase (1 h par défaut).
 */
export interface InviteMemberRequest {
  organizationId: string
  name: string
  email: string
  role: MemberRole
}

export interface InviteMemberResponse {
  member: Member
  /**
   * Lien de connexion à usage unique, ou null quand l'email a déjà un compte qui s'est connecté :
   * le membre est alors relié à ce compte et se connecte comme d'habitude (aucun lien n'est généré,
   * pour qu'un admin n'obtienne jamais un accès au compte existant de quelqu'un d'autre).
   */
  link: string | null
}

/**
 * POST /api/members/link — réservé aux admins. Nouveau lien de connexion pour un membre actif
 * qui ne s'est encore jamais connecté (lien d'invitation expiré ou perdu). 409 s'il s'est déjà connecté.
 */
export interface MemberLinkRequest {
  memberId: string
}

export interface MemberLinkResponse {
  link: string
}
