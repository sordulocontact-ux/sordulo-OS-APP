/**
 * Registre des sources de l'île : le SEUL endroit où brancher une nouvelle source (voir l'en-tête de
 * ../runtime.ts). Ordre de démarrage = ordre du tableau ; il compte peu (les sources se parlent par le bus).
 */
import type { IslandSource } from '../source'
import { createAnalysisSource } from './analysis'
import { assignmentsSource } from './assignments'
import { createCallSource } from './call'
import { claudeSource } from './claude'
import { desktopDeps } from './desktopDeps'
import { dropSource } from './drop'
import { createFocusModeSource } from './focusMode'
import { createMusicSource } from './music'
import { createSpotifySource } from './spotify'
import { createUploadSource } from './upload'

export const ISLAND_SOURCES: readonly IslandSource[] = [
  createFocusModeSource(desktopDeps),
  createCallSource(desktopDeps),
  createUploadSource(desktopDeps),
  createAnalysisSource(desktopDeps),
  assignmentsSource,
  claudeSource,
  dropSource,
  createMusicSource(desktopDeps),
  createSpotifySource(desktopDeps),
]
