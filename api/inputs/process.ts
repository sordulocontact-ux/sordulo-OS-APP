/**
 * POST /api/inputs/process { inputId }
 * (Re)starts the processing of an input in the background and answers 202 at once.
 * 409 if a processing step started less than 5 minutes ago.
 */
import { z } from 'zod'
import type { ProcessInputRequest, ProcessInputResponse } from '../../src/shared/api-contract.js'
import type { Input, InputStatus } from '../../src/shared/types.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { runInBackground } from '../_lib/background.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { processInput } from '../_lib/pipeline.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

/** Beyond this delay, a "transcribing"/"analyzing" status is considered stuck and can be restarted. */
export const STALE_PROCESSING_MS = 5 * 60 * 1000

const ProcessInputSchema = z.object({
  inputId: z.guid('Entrée invalide.'),
}) satisfies z.ZodType<ProcessInputRequest>

/** True if the input is being processed and the last update is recent. */
export function isProcessingInProgress(input: Pick<Input, 'status' | 'updated_at'>, now: number): boolean {
  if (input.status !== 'transcribing' && input.status !== 'analyzing') return false
  const updatedAt = Date.parse(input.updated_at)
  return Number.isFinite(updatedAt) && now - updatedAt < STALE_PROCESSING_MS
}

export function firstProcessingStatus(input: Pick<Input, 'kind' | 'transcript'>): InputStatus {
  const hasTranscript = Boolean(input.transcript && input.transcript.utterances.length > 0)
  return input.kind === 'meeting' && !hasTranscript ? 'transcribing' : 'analyzing'
}

export const POST = route(async (request) => {
  const { inputId } = await readJsonBody(request, ProcessInputSchema)
  const user = await requireUser(request)
  const admin = getSupabaseAdmin()

  const { data, error } = await admin.from('inputs').select('*').eq('id', inputId).maybeSingle()
  if (error) throw new Error(`Lecture de l'entrée impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Entrée introuvable.')
  const input = data as Input
  await requireOrgMember(user, input.organization_id)

  if (isProcessingInProgress(input, Date.now())) throw new HttpError(409, 'Traitement déjà en cours.')

  const status = firstProcessingStatus(input)
  // Optimistic lock: if another request changed the row since we read it, it already started the processing.
  const claimed = await admin
    .from('inputs')
    .update({ status, error_message: null, updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('status', input.status)
    .eq('updated_at', input.updated_at)
    .select('id')
  if (claimed.error) throw new Error(`Mise à jour de l'entrée impossible : ${claimed.error.message}`)
  if (!claimed.data || claimed.data.length === 0) throw new HttpError(409, 'Traitement déjà en cours.')

  console.log(`[process] relance de ${input.id} (${input.status} -> ${status})`)
  runInBackground(processInput(input.id))
  return json(202, { inputId: input.id, status } satisfies ProcessInputResponse)
})

export { OPTIONS } from '../_lib/cors.js'
