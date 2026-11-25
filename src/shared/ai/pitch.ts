/**
 * Action IA « pitch » : argumentaire d'un prospect, à partir de l'audit et de l'offre recommandée.
 * Un mail court prêt à envoyer + des points pour l'appel, en texte simple (prospects.pitch).
 */
import { z } from 'zod'

export const PitchRequestSchema = z.object({ prospectId: z.uuid() })
export type PitchRequest = z.infer<typeof PitchRequestSchema>

/** Sortie structurée de Claude (contraintes compatibles avec l'API seulement). */
export const PitchOutputSchema = z.object({
  /** Objet du mail, sans « Objet : ». */
  subject: z.string(),
  /** Corps du mail, texte simple, de la formule d'appel à la signature. */
  email: z.string(),
  /** Points à aborder au téléphone, une phrase chacun. */
  call_points: z.array(z.string()),
})
export type PitchOutput = z.infer<typeof PitchOutputSchema>

export interface PitchResponse {
  pitch: string
}

/** Longueur maximale de prospects.pitch (contrainte de la base). */
export const PITCH_MAX_LENGTH = 10_000

/** Assemble l'argumentaire final : objet, mail, puis points d'appel. Borné à la longueur de la base. */
export function composePitch(output: PitchOutput): string {
  const points = output.call_points.map((p) => p.trim()).filter((p) => p !== '')
  const parts = [
    `Objet : ${output.subject.trim().replace(/\s+/g, ' ')}`,
    output.email.trim(),
    points.length > 0 ? `Points pour l'appel :\n${points.map((p) => `- ${p}`).join('\n')}` : '',
  ].filter((part) => part !== '')
  const text = parts.join('\n\n')
  return text.length > PITCH_MAX_LENGTH ? `${text.slice(0, PITCH_MAX_LENGTH - 1).trimEnd()}…` : text
}
