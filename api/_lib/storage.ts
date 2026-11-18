/**
 * THE ONLY module that touches file storage (Supabase Storage today, Cloudflare R2 later).
 * Keep every storage call here so the provider can be swapped in one place.
 */
import { AUDIO_BUCKET, type SignedUpload } from '../../src/shared/api-contract.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

const MAX_FILE_NAME_LENGTH = 100

/** Keeps [A-Za-z0-9._-], removes accents, collapses the rest into "-". Never empty. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  let clean = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (clean.length > MAX_FILE_NAME_LENGTH) {
    const dot = clean.lastIndexOf('.')
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : ''
    clean = clean.slice(0, MAX_FILE_NAME_LENGTH - ext.length).replace(/[-.]+$/, '') + ext
  }
  return clean || 'audio'
}

/** Path inside the audio bucket: {orgId}/{projectId}/{inputId}/{file name}. */
export function buildAudioPath(orgId: string, projectId: string, inputId: string, fileName: string): string {
  return `${orgId}/${projectId}/${inputId}/${sanitizeFileName(fileName)}`
}

/** Signed upload for the browser (uploadToSignedUrl(path, token, file)). */
export async function createSignedUpload(path: string): Promise<SignedUpload> {
  const { data, error } = await getSupabaseAdmin().storage.from(AUDIO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new Error(`URL d'envoi signée impossible : ${error?.message ?? 'réponse vide'}`)
  return { path: data.path, token: data.token, bucket: AUDIO_BUCKET }
}

/** Temporary read URL (e.g. for the transcription provider). */
export async function createSignedReadUrl(path: string, expiresInSeconds: number): Promise<string> {
  const { data, error } = await getSupabaseAdmin().storage.from(AUDIO_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error || !data?.signedUrl) {
    throw new Error(`URL de lecture signée impossible : ${error?.message ?? 'fichier introuvable'}`)
  }
  return data.signedUrl
}
