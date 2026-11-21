/**
 * GET /api/desktop/min-version — plus petite version de l'app de bureau que l'API déployée accepte.
 * Sans authentification (aucune donnée sensible) ; l'app l'appelle au démarrage pour se mettre à jour si besoin.
 */
import type { DesktopMinVersionResponse } from '../../src/shared/api-contract.js'
import { DESKTOP_MIN_VERSION } from '../../src/shared/desktop-version.js'
import { json, route } from '../_lib/http.js'

export const GET = route(async () => json(200, { minVersion: DESKTOP_MIN_VERSION } satisfies DesktopMinVersionResponse))

export { OPTIONS } from '../_lib/cors.js'
