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
  area: z.string(),
  related_ticket_id: z.string().nullable(),
  tasks: z.array(AnalysisTaskSchema),
})

export const AnalysisSchema = z.object({
  tickets: z.array(AnalysisTicketSchema),
})

export type AnalysisTask = z.infer<typeof AnalysisTaskSchema>
export type AnalysisTicket = z.infer<typeof AnalysisTicketSchema>
export type Analysis = z.infer<typeof AnalysisSchema>
