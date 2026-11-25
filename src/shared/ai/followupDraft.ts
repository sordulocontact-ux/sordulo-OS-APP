/** Action IA « followupDraft » : relance d'un devis ou d'une facture (POST /api/ai/run, action followupDraft). */
import { z } from 'zod'
import type { Followup, FollowupTargetType } from '../types.js'

export interface FollowupDraftRequest {
  targetType: FollowupTargetType
  targetId: string
}

export interface FollowupDraftResponse {
  followup: Followup
}

/** Sortie structurée de Claude. */
export const FollowupDraftOutputSchema = z.object({
  subject: z.string(),
  body: z.string(),
})
export type FollowupDraftOutput = z.infer<typeof FollowupDraftOutputSchema>

const SUBJECT_PREFIX = 'Objet :'

/** Texte enregistré dans `followups.draft` : « Objet : … », ligne vide, corps. */
export function formatDraft(draft: FollowupDraftOutput): string {
  const subject = draft.subject.replace(/\s+/g, ' ').trim()
  return `${SUBJECT_PREFIX} ${subject}\n\n${draft.body.trim()}`
}

/** Inverse de `formatDraft` ; sans ligne « Objet : », tout le texte est le corps. */
export function parseDraft(text: string): FollowupDraftOutput {
  const normalized = text.replace(/\r\n/g, '\n')
  const match = /^Objet\s*:[ \t]*([^\n]*)\n*/i.exec(normalized)
  if (!match) return { subject: '', body: normalized.trim() }
  return { subject: (match[1] ?? '').trim(), body: normalized.slice(match[0].length).trim() }
}

/** Lien `mailto:` (objet et corps encodés) ; sans adresse, le champ destinataire reste vide. */
export function mailtoLink(email: string | null, draft: FollowupDraftOutput): string {
  const params = [`subject=${encodeURIComponent(draft.subject)}`, `body=${encodeURIComponent(draft.body)}`]
  return `mailto:${email ? encodeURIComponent(email).replace(/%40/g, '@') : ''}?${params.join('&')}`
}

/** Délai avant de reproposer un document déjà relancé (ou ignoré), en jours. */
export const FOLLOWUP_COOLDOWN_DAYS = 7
