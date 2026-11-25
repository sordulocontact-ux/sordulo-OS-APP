/**
 * Accès réels des sources (parcours d'appel, concentration, musique, Spotify, déploiements) : commandes et
 * événements Tauri (src/lib/desktop.ts), Supabase, API, API Vercel (src/lib/vercel.ts), connexion Spotify du
 * compte (src/lib/spotify.ts), connexion Google Agenda du compte (src/lib/google.ts) et API Google Agenda
 * (src/lib/googleCalendar.ts), annuaire des clients (src/lib/clientDirectory.ts), stockage local, URL blob: et
 * canvas. Les tests injectent de faux accès à la place.
 */
import { api, ApiRequestError } from '../../../../lib/api'
import { loadClientDirectory } from '../../../../lib/clientDirectory'
import {
  addRecordingMarker,
  deleteRecording,
  dismissPrompt,
  getDeploymentsEnabled,
  getFocusMode,
  getMusic,
  getMusicArtwork,
  getStatus,
  googleAccessToken,
  musicCommand,
  onAudioLevel,
  onDeploymentsEnabled,
  onFocusMode,
  onMicState,
  onMusic,
  onMusicLevels,
  onPrompt,
  onRecordingMarkers,
  onRecordingState,
  onSpotify,
  onSpotifyToken,
  readRecording,
  removeLastRecordingMarker,
  spotifySetConnection,
  startRecording,
  stopRecording,
} from '../../../../lib/desktop'
import { markGoogleConnectionLost, readGoogleConnection } from '../../../../lib/google'
import { fetchCalendarEvents } from '../../../../lib/googleCalendar'
import {
  readSpotifyConnection,
  replaceSpotifyRefreshToken,
  saveSpotifyProfile,
} from '../../../../lib/spotify'
import { supabase } from '../../../../lib/supabase'
import {
  fetchProductionDeployments,
  fetchProductionUrl,
  fetchVercelTeams,
  readVercelConnection,
} from '../../../../lib/vercel'
import {
  addPendingRecording,
  addTrackedInput,
  readLastProjectId,
  readPendingRecordings,
  readTrackedInputs,
  removePendingRecording,
  removeTrackedInput,
  writeLastProjectId,
} from '../../../desktop/storage'
import { uploadMeetingRecording } from '../../../inputs/uploadMeeting'
import { paletteFromImageUrl } from '../../music/artwork'
import { createCalendarStore } from '../calendarStore'
import type { AnalysisSourceDeps, PolledInput } from './analysis'
import type { CalendarSourceDeps } from './calendar'
import type { CallSourceDeps } from './call'
import type { DeploymentsSourceDeps } from './deployments'
import type { FocusModeDeps } from './focusMode'
import type { MusicSourceDeps } from './music'
import type { SpotifySourceDeps } from './spotify'
import type { UploadSourceDeps } from './upload'

const INPUT_COLUMNS = 'id, project_id, kind, title, raw_text, created_at, status, error_message'

/** Événements Google Agenda : écrits par la source « agenda », lus par la source « appel ». */
const calendarEvents = createCalendarStore()

export const desktopDeps: CallSourceDeps &
  UploadSourceDeps &
  AnalysisSourceDeps &
  FocusModeDeps &
  MusicSourceDeps &
  SpotifySourceDeps &
  DeploymentsSourceDeps &
  CalendarSourceDeps = {
  // Appel et enregistrement
  getStatus,
  startRecording,
  stopRecording,
  dismissPrompt,
  onPrompt,
  onRecordingState,
  onMicState,
  onAudioLevel,
  readLastProjectId,
  writeLastProjectId,
  addRecordingMarker,
  removeLastRecordingMarker,
  onRecordingMarkers,
  calendarEvents,
  loadClientDirectory,

  // Envoi
  readRecording,
  deleteRecording,
  uploadMeetingRecording,
  readPendingRecordings,
  addPendingRecording,
  removePendingRecording,

  // Analyse
  async fetchInput(inputId) {
    const { data, error } = await supabase
      .from('inputs')
      .select(INPUT_COLUMNS)
      .eq('id', inputId)
      .limit(1)
      .overrideTypes<PolledInput[], { merge: false }>()
    if (error) throw error
    return data[0] ?? null
  },
  async fetchOutcome(input) {
    const [tickets, project] = await Promise.all([
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('input_id', input.id)
        .eq('status', 'proposed'),
      supabase
        .from('projects')
        .select('name')
        .eq('id', input.project_id)
        .limit(1)
        .overrideTypes<{ name: string }[], { merge: false }>(),
    ])
    if (tickets.error) throw tickets.error
    return { proposedCount: tickets.count ?? 0, projectName: project.data?.[0]?.name ?? null }
  },
  async restartProcessing(inputId) {
    try {
      await api.processInput({ inputId })
    } catch (e) {
      // 409 : un traitement est déjà en cours, c'est ce qu'on voulait (comme la fiche d'une entrée).
      if (!(e instanceof ApiRequestError && e.status === 409)) throw e
    }
  },
  readTrackedInputs,
  addTrackedInput,
  removeTrackedInput,

  // Mode concentration
  getFocusMode,
  onFocusMode,

  // Musique
  getMusic,
  onMusic,
  onMusicLevels,
  getMusicArtwork,
  musicCommand,
  paletteFromImageUrl,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),

  // Connexion Spotify du compte (table spotify_connections) transmise à Rust
  onSpotify,
  onSpotifyToken,
  spotifySetConnection,
  readSpotifyConnection,
  replaceSpotifyRefreshToken,
  saveSpotifyProfile,

  // Déploiements Vercel
  getDeploymentsEnabled,
  onDeploymentsEnabled,
  readVercelConnection,
  fetchVercelTeams: (token) => fetchVercelTeams(token),
  fetchProductionDeployments: (token, teamId) => fetchProductionDeployments(token, teamId),
  fetchProductionUrl: (token, deploymentId, teamId) => fetchProductionUrl(token, deploymentId, teamId),

  // Google Agenda (ligne `calendar` de google_connections, jeton d'accès donné par Rust)
  readGoogleConnection,
  markGoogleConnectionLost,
  googleAccessToken,
  fetchCalendarEvents: (accessToken, now) => fetchCalendarEvents(accessToken, now),
}
