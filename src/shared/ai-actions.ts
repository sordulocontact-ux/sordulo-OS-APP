/**
 * Actions IA servies par la seule fonction POST /api/ai/run { action, ...données }.
 * Offre gratuite de Vercel (12 fonctions) : toute nouvelle action IA passe par ce routeur, jamais par un
 * nouveau fichier dans api/. Chaque action a son module dans api/_lib/ai/actions/<nom>.ts et ses types de
 * requête / réponse dans src/shared/ai/<nom>.ts (écrits par le lot qui la code).
 */
export const AI_ACTIONS = [
  /** Dépôt d'un fichier : type, client, projet, dossier, numéro, doublon, version (rangement). */
  'classify',
  /** Entrée (réunion ou retour) → brief structuré. */
  'brief',
  /** Brief → brouillon de devis à partir du catalogue. */
  'quoteDraft',
  /** Prospect : pré-audit du site (mobile, vitesse, référencement, design daté). */
  'prospectAudit',
  /** Prospect : argumentaire à partir de l'audit et de l'offre. */
  'pitch',
  /** Planning : propositions de réorganisation (semaine qui déborde, tâche bloquante, urgence). */
  'replan',
  /** Relance d'un devis ou d'une facture : brouillon de mail dans le tone of voice du projet. */
  'followupDraft',
  /** Contrat à partir d'un devis accepté. */
  'contractDraft',
  /** Étude de cas pour sordulo.com à la clôture d'un projet montrable. */
  'caseStudy',
  /** Commande vocale transcrite → action proposée (créer une tâche, répondre à une question). */
  'voiceCommand',
] as const

export type AiActionName = (typeof AI_ACTIONS)[number]

export function isAiActionName(value: unknown): value is AiActionName {
  return typeof value === 'string' && (AI_ACTIONS as readonly string[]).includes(value)
}
