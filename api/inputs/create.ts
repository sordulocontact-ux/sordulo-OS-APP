/**
 * POST /api/inputs/create
 * - written: creates the input (status "analyzing") and starts the analysis in the background. 201 { input }.
 * - meeting: creates the input (status "uploaded") and returns a signed upload URL. 201 { input, upload }.
 *   The browser then uploads the file and calls /api/inputs/process.
 */
import { z } from 'zod'
import {
  AUDIO_MAX_BYTES,
  type CreateInputRequest,
  type CreateInputResponse,
} from '../../src/shared/api-contract.js'
import type { Input, Project } from '../../src/shared/types.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { runInBackground } from '../_lib/background.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { processInput } from '../_lib/pipeline.js'
import { buildAudioPath, createSignedUpload } from '../_lib/storage.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

export const RAW_TEXT_MAX_LENGTH = 100_000

const title = z.string().max(200, 'Le titre dépasse 200 caractères.').optional()

const CreateInputSchema = z.discriminatedUnion('kind', [
  z.object({
    projectId: z.guid('Projet invalide.'),
    kind: z.literal('written'),
    title,
    rawText: z
      .string()
      .refine((value) => value.trim() !== '', 'Le texte est vide.')
      .refine((value) => value.length <= RAW_TEXT_MAX_LENGTH, `Le texte dépasse ${RAW_TEXT_MAX_LENGTH} caractères.`),
  }),
  z.object({
    projectId: z.guid('Projet invalide.'),
    kind: z.literal('meeting'),
    title,
    fileName: z.string().min(1, 'Nom de fichier manquant.').max(255, 'Nom de fichier trop long.'),
    contentType: z.string(),
    sizeBytes: z.number().int().positive('Le fichier est vide.'),
  }),
]) satisfies z.ZodType<CreateInputRequest>

/** audio/*, video/mp4 or video/webm (parameters such as ";codecs=opus" are allowed). */
export function isAcceptedMediaType(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return /^audio\/[a-z0-9.+-]+$/.test(type) || type === 'video/mp4' || type === 'video/webm'
}

function cleanTitle(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function loadProject(projectId: string): Promise<Pick<Project, 'id' | 'organization_id'>> {
  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('id, organization_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw new Error(`Lecture du projet impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Projet introuvable.')
  return data as Pick<Project, 'id' | 'organization_id'>
}

export const POST = route(async (request) => {
  const body = await readJsonBody(request, CreateInputSchema)
  const user = await requireUser(request)
  const project = await loadProject(body.projectId)
  const member = await requireOrgMember(user, project.organization_id)
  const admin = getSupabaseAdmin()

  if (body.kind === 'written') {
    const { data, error } = await admin
      .from('inputs')
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        kind: 'written',
        title: cleanTitle(body.title),
        raw_text: body.rawText,
        status: 'analyzing',
        created_by: member.id,
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(`Création de l'entrée impossible : ${error?.message ?? 'réponse vide'}`)
    const input = data as Input
    console.log(`[create] entrée écrite ${input.id} créée (projet ${project.id})`)
    runInBackground(processInput(input.id))
    return json(201, { input } satisfies CreateInputResponse)
  }

  if (!isAcceptedMediaType(body.contentType)) {
    throw new HttpError(400, 'Format non pris en charge : envoie un fichier audio, ou une vidéo MP4 ou WebM.')
  }
  if (body.sizeBytes > AUDIO_MAX_BYTES) {
    throw new HttpError(413, `Fichier trop volumineux : ${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)} Mo au maximum.`)
  }

  const inputId = crypto.randomUUID()
  const audioPath = buildAudioPath(project.organization_id, project.id, inputId, body.fileName)
  const { data, error } = await admin
    .from('inputs')
    .insert({
      id: inputId,
      organization_id: project.organization_id,
      project_id: project.id,
      kind: 'meeting',
      title: cleanTitle(body.title),
      audio_path: audioPath,
      status: 'uploaded',
      created_by: member.id,
    })
    .select('*')
    .single()
  if (error || !data) throw new Error(`Création de l'entrée impossible : ${error?.message ?? 'réponse vide'}`)
  const input = data as Input

  let upload
  try {
    upload = await createSignedUpload(audioPath)
  } catch (uploadError) {
    await admin.from('inputs').delete().eq('id', inputId)
    console.error(`[create] URL d'envoi impossible pour ${inputId}`, uploadError)
    throw new HttpError(502, "Impossible de préparer l'envoi du fichier. Réessaie dans un instant.")
  }
  console.log(`[create] réunion ${input.id} créée (projet ${project.id}), en attente du fichier`)
  return json(201, { input, upload } satisfies CreateInputResponse)
})

export { OPTIONS } from '../_lib/cors.js'
