/** Place de l'île côté contrôleur : bord et variante (encoche ou non), lus dans l'URL puis mis à jour par Rust. */
import type { IslandPlacement } from '../../../shared/desktop-contract'
import { DEFAULT_EDGE, platformFromSearch } from '../geometry'
import type { IslandEdge, IslandPlatform } from '../types'

const EDGES: readonly IslandEdge[] = ['top', 'bottom', 'left', 'right']

/** Bord de la requête (`?edge=left`) ; 'top' si absent ou inconnu. */
export function edgeFromSearch(search: string): IslandEdge {
  const value = new URLSearchParams(search).get('edge')
  return EDGES.find((edge) => edge === value) ?? DEFAULT_EDGE
}

export interface IslandPlace {
  edge: IslandEdge
  platform: IslandPlatform
}

/** Place de départ, lue dans l'URL de la fenêtre. */
export function placeFromSearch(search: string): IslandPlace {
  return { edge: edgeFromSearch(search), platform: platformFromSearch(search) }
}

/** Place donnée par l'événement `island-placement` : `mac` seulement avec l'encoche. */
export function placeFromPlacement(placement: IslandPlacement): IslandPlace {
  return { edge: placement.edge, platform: placement.notch ? 'mac' : 'win' }
}
