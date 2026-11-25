/**
 * Portail client public (lien secret /p/<jeton>), sans session :
 *   GET  /api/portal?token=…            projet, avancement, livrables (URLs signées 10 min), commentaires,
 *                                       devis envoyés / acceptés, contrats envoyés / signés, factures émises / payées
 *   POST /api/portal { token, action, … } comment | approve | request_changes | accept_quote | sign_contract
 * Tout passe par le jeton (projects.portal_token), cherché avec la clé service ; chaque action vérifie
 * que l'objet visé appartient au projet du jeton. Logique dans api/_lib/portal/.
 * 404 lien invalide ou désactivé, 400 corps invalide, 409 état qui ne permet plus l'action, 429 trop de requêtes.
 */
import { handlePortalGet, handlePortalPost, type PortalDeps } from './_lib/portal/handler.js'
import { route } from './_lib/http.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'

const deps: PortalDeps = { admin: getSupabaseAdmin }

export const GET = route((request) => handlePortalGet(request, deps))
export const POST = route((request) => handlePortalPost(request, deps))

export { OPTIONS } from './_lib/cors.js'
