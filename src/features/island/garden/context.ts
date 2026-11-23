/**
 * Ce que l'île donne au jardin (fourni par view/Island.tsx autour de la prop `garden`) : la scène (taille
 * animée réelle du ressort et abonnement aux images de la boucle de l'île), la visibilité du jardin, l'état,
 * la plateforme, la réduction des animations, l'humeur (appel en cours, musique), le lecteur du vrai son
 * (objet stable, lu à chaque image) et la session affichée
 * dans `agent` (son personnage part de l'icône quand l'île devient un jardin).
 * La valeur ne change qu'avec ces réglages, jamais à chaque image : aucun rendu React par image.
 */
import { createContext } from 'react'
import type { IslandPlatform, IslandSizeKey, IslandState, MusicLevelsReader } from '../types'
import type { IslandStage } from '../view/loop'
import { musicBeatPhase, musicIsSilent } from '../view/music'
import type { GardenMood } from './simulation'

export interface GardenEnv {
  stage: IslandStage
  /** Jardin à l'écran : `multi` au repos sans survol, ou musique avec des sessions Claude (survol compris). */
  visible: boolean
  /** Forme qui accueille le jardin : `multi`, ou `musicGarden` (les Claude marchent sous la musique). */
  sizeKey: Extract<IslandSizeKey, 'multi' | 'musicGarden'>
  state: IslandState
  platform: IslandPlatform
  reduced: boolean
  mood: GardenMood
  /**
   * Vrai son de la musique (Windows), lu à chaque image par le jardin : hochement sur les vrais temps, pas de
   * hochement dans le silence. null (ou pas d'analyse récente) : tempo fixe GARDEN.musicTempoBpm.
   */
  musicLevels: MusicLevelsReader | null
  /** Session affichée dans `agent` (null hors de cet état ou sans session). */
  agentSessionId: string | null
  /**
   * Calque posé devant la pochette et l'égaliseur : les sous-agents (petits Claude) y sont dessinés, les
   * personnages principaux restent derrière pour ne pas cacher la pochette. null : tout dans le jardin.
   */
  front: HTMLElement | null
  /**
   * Calque posé derrière le texte de l'activité (titre et artiste de la musique) : avec la musique, les
   * personnages des plans du fond y passent, ceux du premier plan restent devant, pour que le titre reste
   * lisible. null : tout dans le jardin.
   */
  back: HTMLElement | null
}

export const GardenEnvContext = createContext<GardenEnv | null>(null)

/** Ce que le vrai son dit au jardin à cette image : phase du vrai temps et silence. */
export interface GardenBeat {
  /** Phase 0..1 du vrai temps ; absente : tempo fixe. */
  beatPhase?: number
  /** Silence analysé : pas de hochement ni de notes. */
  musicSilent?: boolean
}

/**
 * Vrai son → hochement (lu à chaque image, `nowMs` epoch ms) : sans analyse récente, rien (tempo fixe) ;
 * silence : pas de hochement ; tempo détecté : phase des vrais temps ; sinon tempo fixe.
 */
export function gardenBeat(env: Pick<GardenEnv, 'musicLevels'>, music: boolean, nowMs: number): GardenBeat {
  const levels = music ? (env.musicLevels?.get(nowMs) ?? null) : null
  if (!levels) return {}
  if (musicIsSilent(levels)) return { musicSilent: true }
  const phase = musicBeatPhase(levels, nowMs)
  return phase === null ? {} : { beatPhase: phase }
}
