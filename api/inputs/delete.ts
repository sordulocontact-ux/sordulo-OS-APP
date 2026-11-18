/**
 * POST /api/inputs/delete { inputId }
 * Supprime l'entrée, ses tickets encore proposés ou refusés (les tâches suivent par cascade) et son
 * fichier audio. Les tickets validés ou faits restent dans le projet. 409 pendant un traitement.
 */
import { z } from 'zod'
import type { DeleteInputRequest, DeleteInputResponse } from '../../src/shared/api-contract.js'
import type { Input } from '../../src/shared/types.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { removeAudio } from '../_lib/storage.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { isProcessingInProgress } from './process.js'

const DeleteInputSchema = z.object({
  inputId: z.guid('Entrée invalide.'),
}) satisfies z.ZodType<DeleteInputRequest>

export const POST = route(async (request) => {
  const { inputId } = await readJsonBody(request, DeleteInputSchema)
  const user = await requireUser(request)
  const admin = getSupabaseAdmin()

  const { data, error } = await admin.from('inputs').select('*').eq('id', inputId).maybeSingle()
  if (error) throw new Error(`Lecture de l'entrée impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Entrée introuvable.')
  const input = data as Input
  await requireOrgMember(user, input.organization_id)
  if (isProcessingInProgress(input, Date.now())) {
    throw new HttpError(409, 'Traitement en cours : attends la fin avant de supprimer cette entrée.')
  }

  const removed = await admin
    .from('tickets')
    .delete({ count: 'exact' })
    .eq('input_id', input.id)
    .in('status', ['proposed', 'rejected'])
  if (removed.error) throw new Error(`Suppression des tickets impossible : ${removed.error.message}`)
  const kept = await admin.from('tickets').select('id', { count: 'exact', head: true }).eq('input_id', input.id)
  if (kept.error) throw new Error(`Lecture des tickets impossible : ${kept.error.message}`)

  const deleted = await admin.from('inputs').delete().eq('id', input.id)
  if (deleted.error) throw new Error(`Suppression de l'entrée impossible : ${deleted.error.message}`)

  if (input.audio_path) {
    // L'entrée est déjà supprimée : un fichier resté en place ne doit pas faire échouer la demande.
    await removeAudio(input.audio_path).catch((e: unknown) => console.error(`[delete] input=${input.id} :`, e))
  }
  console.log(`[delete] input=${input.id} supprimée (${removed.count ?? 0} tickets supprimés, ${kept.count ?? 0} conservés)`)

  return json(200, {
    inputId: input.id,
    deletedTickets: removed.count ?? 0,
    keptTickets: kept.count ?? 0,
  } satisfies DeleteInputResponse)
})
