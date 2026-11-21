/**
 * POST /api/review/revise { inputId, note, tickets }
 * Applique une note de l'équipe aux tickets proposés d'une entrée (contenu, regroupement, attribution)
 * et met à jour la mémoire de l'IA du projet. Synchrone : répond quand les tickets sont réécrits.
 * Réservé aux admins et membres de l'organisation. 404 entrée introuvable, 409 traitement en cours ou
 * aucun ticket proposé, 502 si Claude échoue.
 */
import { z } from 'zod'
import {
  AI_NOTE_MAX_LENGTH,
  type ReviseTicketState,
  type ReviseTicketsRequest,
  type ReviseTicketsResponse,
} from '../../src/shared/api-contract.js'
import { TICKET_PRIORITIES, TICKET_TYPES, type Input } from '../../src/shared/types.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { reviseTickets } from '../_lib/revision.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { isProcessingInProgress } from '../inputs/process.js'

/** Nombre maximal de tickets envoyés par l'écran. */
export const REVISE_MAX_TICKETS = 100

const ReviseTicketStateSchema = z.object({
  id: z.guid('Ticket invalide.'),
  title: z.string().max(500, 'Titre trop long (500 caractères au maximum).'),
  description: z.string().max(20_000, 'Description trop longue (20 000 caractères au maximum).'),
  type: z.enum(TICKET_TYPES, 'Type de ticket invalide.'),
  priority: z.enum(TICKET_PRIORITIES, 'Priorité invalide.'),
  area: z.string().max(200, 'Partie trop longue.').nullable(),
  assigneeMemberId: z.guid('Personne invalide.').nullable(),
  estimateHours: z.number().nullable(),
}) satisfies z.ZodType<ReviseTicketState>

const ReviseTicketsSchema = z.object({
  inputId: z.guid('Entrée invalide.'),
  note: z
    .string()
    .trim()
    .min(1, 'La note est vide.')
    .max(AI_NOTE_MAX_LENGTH, `La note dépasse ${AI_NOTE_MAX_LENGTH} caractères.`),
  tickets: z.array(ReviseTicketStateSchema).max(REVISE_MAX_TICKETS, `Trop de tickets (${REVISE_MAX_TICKETS} au maximum).`),
}) satisfies z.ZodType<ReviseTicketsRequest>

export const POST = route(async (request) => {
  const body = await readJsonBody(request, ReviseTicketsSchema)
  const user = await requireUser(request)
  const admin = getSupabaseAdmin()

  const { data, error } = await admin.from('inputs').select('*').eq('id', body.inputId).maybeSingle()
  if (error) throw new Error(`Lecture de l'entrée impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Entrée introuvable.')
  const input = data as Input
  const member = await requireOrgMember(user, input.organization_id)
  if (member.role !== 'admin' && member.role !== 'membre') {
    throw new HttpError(403, "Accès refusé : réservé aux admins et aux membres de l'équipe.")
  }
  if (isProcessingInProgress(input, Date.now())) {
    throw new HttpError(409, "Traitement en cours : attends la fin de l'analyse avant d'envoyer une note.")
  }

  const result = await reviseTickets(admin, input, { note: body.note, tickets: body.tickets })
  return json(200, result satisfies ReviseTicketsResponse)
})
