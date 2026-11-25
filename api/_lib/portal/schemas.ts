/** Validation des actions du portail client (POST /api/portal). Messages en français. */
import { z } from 'zod'
import { PORTAL_LIMITS, PORTAL_TOKEN_PATTERN } from '../../../src/features/portal/portalContract.js'

const token = z.string().regex(PORTAL_TOKEN_PATTERN, 'Lien invalide.')
const id = z.uuid('Identifiant invalide.')
const fraction = z.number().min(0).max(1)

const personName = z
  .string()
  .trim()
  .min(1, 'Indiquez votre nom.')
  .max(PORTAL_LIMITS.name, `Votre nom doit faire au plus ${PORTAL_LIMITS.name} caractères.`)

const note = z
  .string()
  .trim()
  .max(PORTAL_LIMITS.note, `Le message doit faire au plus ${PORTAL_LIMITS.note} caractères.`)
  .optional()

const accepted = z.literal(true, 'Cochez la case « Bon pour accord ».')

export const portalActionSchema = z.discriminatedUnion('action', [
  z.object({
    token,
    action: z.literal('comment'),
    versionId: id,
    x: fraction.nullish(),
    y: fraction.nullish(),
    body: z
      .string()
      .trim()
      .min(1, 'Écrivez votre commentaire.')
      .max(PORTAL_LIMITS.comment, `Le commentaire doit faire au plus ${PORTAL_LIMITS.comment} caractères.`),
    authorName: personName,
  }),
  z.object({ token, action: z.literal('approve'), versionId: id, authorName: personName, note }),
  z.object({ token, action: z.literal('request_changes'), versionId: id, authorName: personName, note }),
  z.object({ token, action: z.literal('accept_quote'), quoteId: id, authorName: personName, accepted }),
  z.object({ token, action: z.literal('sign_contract'), contractId: id, signerName: personName, accepted }),
])

export type PortalActionInput = z.output<typeof portalActionSchema>
