/**
 * Source « envoi » : après l'arrêt, « Import de l'audio » pendant la lecture du fichier, la création de
 * l'entrée et l'envoi ; puis la source « analyse » prend le relais (bus : trackInput).
 *
 * - Chaque enregistrement arrêté entre dans une file gardée sur l'ordinateur (storage.ts) : un échec, un
 *   redémarrage ou un nouvel appel ne perdent jamais un fichier. Le fichier local est supprimé seulement
 *   après un envoi réussi.
 * - Échec : notification « L'envoi de l'audio a échoué », Réessayer reprend sans doublon (entrée déjà créée,
 *   fichier déjà envoyé : voir UploadResume de src/features/inputs/uploadMeeting.ts).
 * - Au démarrage, une fois connecté : « Un appel n'a pas été envoyé », Réessayer.
 * - Les moments marqués pendant l'appel (RecordingResult.markers, gardés dans la file) partent avec l'entrée.
 */
import type { RecordingResult } from '../../../../shared/desktop-contract'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import { createNotification } from '../../catalog'
import { UPLOAD_PROGRESS_ID, errorMessage, pendingDetail, recordingFileName, uploadProgress, estimateUploadMs } from '../callFlow'
import type { IslandSource } from '../source'

export interface UploadSourceDeps {
  readRecording: (path: string) => Promise<ArrayBuffer>
  deleteRecording: (path: string) => Promise<void>
  uploadMeetingRecording: (params: UploadMeetingParams) => Promise<{ input: Input }>
  readPendingRecordings: () => RecordingResult[]
  addPendingRecording: (result: RecordingResult) => void
  removePendingRecording: (path: string) => void
}

const NO_RESUME: UploadResume = { created: null, uploaded: false }

/** MeetingUploadError porte la reprise (lu sans importer la classe, qui tire l'API et Supabase). */
/** Repères d'un enregistrement de la file (un enregistrement gardé par une version d'avant n'en a pas). */
export function markersOf(result: RecordingResult): number[] {
  const markers: unknown = (result as Partial<RecordingResult>).markers
  return Array.isArray(markers) ? markers.filter((m): m is number => typeof m === 'number') : []
}

function resumeOf(error: unknown): UploadResume | null {
  if (!error || typeof error !== 'object' || !('resume' in error)) return null
  const resume = (error as { resume: unknown }).resume
  return resume && typeof resume === 'object' ? (resume as UploadResume) : null
}

export function createUploadSource(deps: UploadSourceDeps): IslandSource {
  return {
    id: 'envoi',
    start(ctx) {
      const { coordinator } = ctx
      /** Reprise par fichier : ce qui est déjà fait (entrée créée, fichier envoyé). */
      const resumes = new Map<string, UploadResume>()
      let running = false

      function showProgress(sizeBytes: number | null): void {
        const existing = coordinator.getActivity(UPLOAD_PROGRESS_ID)
        if (existing?.kind === 'progress') {
          if (sizeBytes !== null) coordinator.updateActivity(UPLOAD_PROGRESS_ID, { estimatedMs: estimateUploadMs(sizeBytes) })
          return
        }
        coordinator.addActivity(uploadProgress(ctx.clock.now(), sizeBytes))
      }

      function hideProgress(): void {
        coordinator.removeActivity(UPLOAD_PROGRESS_ID)
      }

      async function sendOne(result: RecordingResult): Promise<Input> {
        const { path } = result
        try {
          const bytes = await deps.readRecording(path)
          const file = new Blob([bytes], { type: result.mimeType })
          const { input } = await deps.uploadMeetingRecording({
            projectId: result.projectId,
            title: result.title ?? undefined,
            file,
            fileName: recordingFileName(result, new Date(ctx.clock.now())),
            contentType: result.mimeType,
            markers: markersOf(result),
            resume: resumes.get(path) ?? NO_RESUME,
            onCreated: (created) => resumes.set(path, { ...(resumes.get(path) ?? NO_RESUME), created }),
          })
          resumes.delete(path)
          deps.removePendingRecording(path)
          // Le fichier local part seulement après un envoi réussi.
          deps.deleteRecording(path).catch((e: unknown) => console.warn('[île] suppression du fichier envoyé :', e))
          return input
        } catch (e) {
          const resume = resumeOf(e)
          if (resume) resumes.set(path, resume)
          throw e
        }
      }

      /** Envoie la file, du plus ancien au plus récent ; s'arrête au premier échec. */
      async function drain(): Promise<void> {
        if (running) return
        running = true
        try {
          for (;;) {
            if (ctx.isDisposed()) return
            const next = deps.readPendingRecordings()[0]
            if (!next) break
            showProgress(next.sizeBytes)
            let input: Input
            try {
              input = await sendOne(next)
            } catch (e) {
              if (ctx.isDisposed()) return
              hideProgress()
              coordinator.notify(
                createNotification('uploadError', { message: errorMessage(e, 'Une erreur est survenue. Réessaie.') }),
              )
              return
            }
            if (ctx.isDisposed()) return
            hideProgress()
            ctx.bus.emit('trackInput', { inputId: input.id, durationSecs: next.durationSecs })
          }
          hideProgress()
        } finally {
          running = false
        }
      }

      const stops = [
        ctx.bus.on('recordingStopping', () => showProgress(null)),
        ctx.bus.on('recordingStopFailed', () => {
          if (!running) hideProgress()
        }),
        ctx.bus.on('recordingStopped', (result) => {
          deps.addPendingRecording(result)
          void drain()
        }),
        ctx.whenSignedIn(() => {
          const pending = deps.readPendingRecordings()
          if (pending.length > 0 && !running) {
            coordinator.notify(createNotification('pendingUpload', { detail: pendingDetail(pending.length) }))
          }
        }),
      ]

      return {
        dispose: () => stops.forEach((stop) => stop()),
        actions: {
          retryUpload: () => drain(),
        },
      }
    },
  }
}
