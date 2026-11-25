/** Action IA « replan » : propositions de réorganisation du planning (POST /api/ai/run, action replan). */
import { z } from 'zod'
import type { AiProposal } from '../types.js'

export interface ReplanRequest {
  /** Limite l'analyse à un projet ; absent = toute l'organisation. */
  projectId?: string
  /** Organisation visée quand le compte en a plusieurs et qu'aucun projet n'est donné. */
  organizationId?: string
}

export interface ReplanResponse {
  /** Propositions créées (en attente, ou appliquées seules par une règle « Toujours »). Vide si tout va bien. */
  proposals: AiProposal[]
  /** Problèmes détectés par l'analyse (débordement, blocage, urgence), traités ou non. */
  issueCount: number
}

/** Sortie structurée de Claude : il choisit parmi les opérations candidates et rédige les textes. */
export const ReplanOutputSchema = z.object({
  proposals: z.array(
    z.object({
      /** Ids des opérations candidates retenues, exactement comme donnés. */
      candidate_ids: z.array(z.string()),
      /** Titre court, en français. */
      title: z.string(),
      /** Pourquoi ce changement, en 2 à 4 phrases. */
      explanation: z.string(),
    }),
  ),
})
export type ReplanOutput = z.infer<typeof ReplanOutputSchema>
