/**
 * POST /api/inputs/audio-url { inputId }
 * Lien temporaire pour télécharger l'audio d'une réunion (le stockage est privé, sans accès direct).
 */
import { z } from 'zod'
import type { AudioUrlRequest, AudioUrlResponse } from '../../src/shared/api-contract.js'
import type { Input } from '../../src/shared/types.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { createSignedDownloadUrl } from '../_lib/storage.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

const DOWNLOAD_URL_SECONDS = 5 * 60

const AudioUrlSchema = z.object({
  inputId: z.guid('Entrée invalide.'),
}) satisfies z.ZodType<AudioUrlRequest>

export const POST = route(async (request) => {
  const { inputId } = await readJsonBody(request, AudioUrlSchema)
  const user = await requireUser(request)
  const { data, error } = await getSupabaseAdmin().from('inputs').select('*').eq('id', inputId).maybeSingle()
  if (error) throw new Error(`Lecture de l'entrée impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Entrée introuvable.')
  const input = data as Input
  await requireOrgMember(user, input.organization_id)
  if (!input.audio_path) throw new HttpError(404, "Cette entrée n'a pas de fichier audio.")

  const extension = input.audio_path.split('.').pop() || 'mp3'
  const day = input.created_at.slice(0, 10)
  const url = await createSignedDownloadUrl(input.audio_path, DOWNLOAD_URL_SECONDS, `reunion-${day}.${extension}`)
  return json(200, { url } satisfies AudioUrlResponse)
})
