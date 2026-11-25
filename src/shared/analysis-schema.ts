/**
 * Schema of the AI analysis output (exactly the JSON of the ticket).
 * Only constraints supported by the API structured outputs are used here (types, enums,
 * nullable). Bounds, ids and indices are checked afterwards (api/_lib/analysis-postprocess.ts).
 */
import { z } from 'zod'
import { SKILLS, TICKET_PRIORITIES, TICKET_TYPES } from './types.js'

export const AnalysisTaskSchema = z.object({
  title: z.string(),
  skill: z.enum(SKILLS),
  estimate_hours: z.number(),
  depends_on_index: z.number().nullable(),
})

export const AnalysisTicketSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(TICKET_PRIORITIES),
  source_quote: z.string(),
  /**
   * Ticket tiré d'un passage marqué pendant l'appel (<moment_marque>). Avis de l'IA : le serveur le remplace
   * par le temps de la citation dans la transcription quand il la retrouve (api/_lib/analysis-postprocess.ts).
   */
  from_marker: z.boolean(),
  area: z.string(),
  related_ticket_id: z.string().nullable(),
  /** Personne désignée par les consignes du projet (id de <equipe>), null pour laisser le code choisir. */
  assignee_member_id: z.string().nullable(),
  /** Raison très courte de cette attribution (« Maël s'occupe des pages Finance »), null sinon. */
  assignment_reason: z.string().nullable(),
  tasks: z.array(AnalysisTaskSchema),
})

export const AnalysisSchema = z.object({
  tickets: z.array(AnalysisTicketSchema),
})

/**
 * Révision des tickets proposés par une note de l'équipe (POST /api/review/revise).
 * id = ticket proposé existant gardé (modifié ou non), null = nouveau ticket. Un ticket absent est supprimé.
 * Pas de tâches : un ticket = une tâche, donc compétence et durée portent sur le ticket.
 */
export const RevisionTicketSchema = z.object({
  id: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(TICKET_PRIORITIES),
  area: z.string(),
  source_quote: z.string(),
  assignee_member_id: z.string().nullable(),
  assignment_reason: z.string().nullable(),
  skill: z.enum(SKILLS),
  estimate_hours: z.number(),
})

export const RevisionSchema = z.object({
  tickets: z.array(RevisionTicketSchema),
  /** Mémoire complète du projet après la note (consignes durables, puces « - »). */
  project_instructions: z.string(),
})

export type AnalysisTask = z.infer<typeof AnalysisTaskSchema>
export type AnalysisTicket = z.infer<typeof AnalysisTicketSchema>
export type Analysis = z.infer<typeof AnalysisSchema>
export type RevisionTicket = z.infer<typeof RevisionTicketSchema>
export type Revision = z.infer<typeof RevisionSchema>
