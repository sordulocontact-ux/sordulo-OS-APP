/**
 * POST /api/voice/transcribe[?projectId=<uuid>]
 * Body = raw audio (audio/webm, audio/ogg, audio/mp4...). Transcribes a short voice note with Deepgram
 * and answers { text }. The audio is never stored. Reserved for active members of the project's organization;
 * without projectId (voice commands of the Cmd+K palette), for active members of any organization.
 */
import { z } from 'zod'
import { VOICE_NOTE_MAX_BYTES, type TranscribeVoiceResponse } from '../../src/shared/api-contract.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { MissingEnvError } from '../_lib/env.js'
import { HttpError, json, route } from '../_lib/http.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { NoSpeechError, transcribeAudio } from '../_lib/transcription.js'

const TOO_LARGE = 'Note vocale trop longue (4 Mo max).'

function isSupportedAudio(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  // Some browsers label an audio-only recording video/webm.
  return type.startsWith('audio/') || type === 'video/webm'
}

export const POST = route(async (request) => {
  const rawProjectId = new URL(request.url).searchParams.get('projectId')
  const projectId = rawProjectId === null ? null : z.guid().safeParse(rawProjectId)
  if (projectId && !projectId.success) throw new HttpError(400, 'Projet invalide.')

  const user = await requireUser(request)
  const admin = getSupabaseAdmin()
  if (projectId) {
    const { data, error } = await admin.from('projects').select('id, organization_id').eq('id', projectId.data).maybeSingle()
    if (error) throw new Error(`Lecture du projet impossible : ${error.message}`)
    if (!data) throw new HttpError(404, 'Projet introuvable.')
    await requireOrgMember(user, (data as { organization_id: string }).organization_id)
  } else {
    // Commande vocale : pas de projet, il suffit d'être membre actif d'une organisation.
    const { data, error } = await admin
      .from('members')
      .select('organization_id')
      .eq('user_id', user.id)
      .is('removed_at', null)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Lecture des membres impossible : ${error.message}`)
    if (!data) throw new HttpError(403, "Accès refusé : tu n'es membre d'aucune organisation.")
    await requireOrgMember(user, (data as { organization_id: string }).organization_id)
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!isSupportedAudio(contentType)) throw new HttpError(415, 'Format audio non pris en charge.')

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > VOICE_NOTE_MAX_BYTES) throw new HttpError(413, TOO_LARGE)
  const audio = await request.arrayBuffer()
  if (audio.byteLength > VOICE_NOTE_MAX_BYTES) throw new HttpError(413, TOO_LARGE)
  if (audio.byteLength === 0) throw new HttpError(400, 'Enregistrement vide.')

  let text: string
  try {
    text = await transcribeAudio(audio, contentType.split(';')[0]?.trim() ?? contentType)
  } catch (err) {
    if (err instanceof NoSpeechError) throw new HttpError(422, "Aucune parole détectée dans l'enregistrement.")
    if (err instanceof MissingEnvError) throw err
    console.error(`[voice] transcription échouée : ${err instanceof Error ? err.message : 'erreur inconnue'}`)
    throw new HttpError(502, 'La transcription a échoué. Réessaie dans un instant.')
  }

  console.log(`[voice] note transcrite (${projectId ? `projet ${projectId.data}` : 'commande vocale'}, ${audio.byteLength} octets)`)
  return json(200, { text } satisfies TranscribeVoiceResponse)
})
