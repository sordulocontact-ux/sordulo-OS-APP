/**
 * Registre des sources de l'île : le SEUL endroit où brancher une nouvelle source (voir l'en-tête de
 * ../runtime.ts). Ordre de démarrage = ordre du tableau ; il compte peu (les sources se parlent par le bus).
 */
import type { IslandSource } from '../source'
import { createAnalysisSource } from './analysis'
import { appNotificationsSource } from './appNotifications'
import { assignmentsSource } from './assignments'
import { createCalendarSource } from './calendar'
import { createCallSource } from './call'
import { claudeSource } from './claude'
import { createDeploymentsSource } from './deployments'
import { desktopDeps } from './desktopDeps'
import { dropSource } from './drop'
import { filingSource } from './filing'
import { createFocusModeSource } from './focusMode'
import { createGmailSource, gmailDesktopDeps } from './gmail'
import { createMusicSource } from './music'
import { createSpotifySource } from './spotify'
import { createTicketReviewSource, ticketReviewDesktopDeps } from './ticketReview'
import { createUploadSource } from './upload'

export const ISLAND_SOURCES: readonly IslandSource[] = [
  createFocusModeSource(desktopDeps),
  createCallSource(desktopDeps),
  createCalendarSource(desktopDeps),
  createUploadSource(desktopDeps),
  createAnalysisSource(desktopDeps),
  assignmentsSource,
  claudeSource,
  dropSource,
  filingSource,
  appNotificationsSource,
  createMusicSource(desktopDeps),
  createSpotifySource(desktopDeps),
  createDeploymentsSource(desktopDeps),
  createTicketReviewSource(ticketReviewDesktopDeps),
  createGmailSource(gmailDesktopDeps),
]
