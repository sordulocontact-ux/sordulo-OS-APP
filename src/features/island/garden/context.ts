/**
 * Ce que l'île donne au jardin (fourni par view/Island.tsx autour de la prop `garden`) : la scène (taille
 * animée réelle du ressort et abonnement aux images de la boucle de l'île), la visibilité du jardin, l'état,
 * la plateforme, la réduction des animations, l'humeur (appel en cours, musique) et la session affichée
 * dans `agent` (son personnage part de l'icône quand l'île devient un jardin).
 * La valeur ne change qu'avec ces réglages, jamais à chaque image : aucun rendu React par image.
 */
import { createContext } from 'react'
import type { IslandPlatform, IslandState } from '../types'
import type { IslandStage } from '../view/loop'
import type { GardenMood } from './simulation'

export interface GardenEnv {
  stage: IslandStage
  /** Jardin à l'écran : `multi` au repos, sans survol. */
  visible: boolean
  state: IslandState
  platform: IslandPlatform
  reduced: boolean
  mood: GardenMood
  /** Session affichée dans `agent` (null hors de cet état ou sans session). */
  agentSessionId: string | null
}

export const GardenEnvContext = createContext<GardenEnv | null>(null)
