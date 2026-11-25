/** Contrat d'une action IA servie par POST /api/ai/run (voir src/shared/ai-actions.ts). */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import type { Member, MemberRole } from '../../../src/shared/types.js'
import type { AuthUser } from '../auth.js'

export interface AiActionContext<Body> {
  /** Corps validé par le schéma de l'action (sans le champ `action`). */
  body: Body
  /** Utilisateur authentifié (jeton Supabase vérifié). */
  user: AuthUser
  /** Client Supabase avec la clé service : la RLS ne s'applique pas, chaque action vérifie les droits. */
  admin: SupabaseClient
  /**
   * Membre actif de `organizationId` lié à l'utilisateur, avec un des rôles donnés (tous si absent).
   * HttpError 403 sinon. À appeler dès que l'objet visé est chargé (son organization_id est connu).
   */
  requireMember: (organizationId: string, roles?: readonly MemberRole[]) => Promise<Member>
  request: Request
}

export interface AiAction<S extends z.ZodType = z.ZodType, Res = unknown> {
  /** Schéma du corps (sans `action`). Messages d'erreur en français. */
  schema: S
  run: (ctx: AiActionContext<z.output<S>>) => Promise<Res>
}

/** Aide au typage : `export default defineAiAction({ schema, run })`. */
export function defineAiAction<S extends z.ZodType, Res>(action: AiAction<S, Res>): AiAction<S, Res> {
  return action
}
