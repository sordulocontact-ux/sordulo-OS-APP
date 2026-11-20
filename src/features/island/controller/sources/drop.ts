/**
 * Source « glisser-déposer » : un fichier glissé sur l'île (événements de dépôt natifs de la webview).
 *
 * Limite de Windows : la fenêtre de l'île est transparente aux clics ; elle ne devient cible de dépôt que
 * lorsque le curseur entre dans la marge de 24 px autour des formes, bouton principal enfoncé (Rust,
 * `dragMargin`). Avant cela, aucun événement n'arrive : on ne détecte pas un glissement partout sur l'écran.
 *
 * Déroulé
 * - enter : « Dépose ici » (overlay dragWake) et `view.drop` (nom du fichier, projet, zones proposées).
 *   Zones : Transcrire pour l'audio seulement, Claude Code si une session est active (statut autre que
 *   terminé ou inactif), Fichiers jamais (masquée tant que les fichiers de projet n'existent pas).
 * - over : curseur sur la forme (marge de 0 px) → les zones (dragOver) ; on y reste tant que le curseur
 *   est à moins de 24 px de la forme (le prototype réveillait à 24 px ; l'écart évite de clignoter entre
 *   les deux états). `view.hotZone` suit l'élément `[data-zone]` sous le curseur.
 * - leave : retour à l'état précédent (overlay retiré, `drop` et `hotZone` vidés).
 * - drop : sur Transcrire avec un audio → entrée « réunion » sur le dernier projet utilisé (sinon le premier),
 *   avec « Import de l'audio » puis le suivi d'analyse (bus trackInput) comme pour un appel ; échec :
 *   « L'envoi de l'audio a échoué », Réessayer reprend sans doublon. Sur Claude Code → le chemin du fichier
 *   est copié dans le presse-papiers, notification « Chemin copié ». Ailleurs ou zone absente → annulé.
 * - Un seul fichier est traité : le premier de la sélection.
 * - Pendant la proposition d'un appel (overlay `appel`), le glissement est ignoré : l'appel reste affiché.
 */
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { copyText, readDroppedAudio } from '../../../../lib/desktop'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import { createNotification } from '../../catalog'
import { readLastProjectId } from '../../../desktop/storage'
import {
  DRAG_ENTER_MARGIN,
  DRAG_KEEP_MARGIN,
  actionableZone,
  audioMimeOf,
  dropInfoFor,
  fileNameOf,
  inAnyRect,
  titleOf,
  toCssPoint,
  type DropRect,
} from '../../drop/logic'
import type { IslandDropInfo, IslandDropZone } from '../../view/types'
import { errorMessage, estimateUploadMs, pickDefaultProject, projectNameOf, uploadProgress } from '../callFlow'
import type { IslandSource } from '../source'
import { listen } from './listen'

/** Événement de dépôt natif (même forme que `DragDropEvent` de @tauri-apps/api/webview, positions en px physiques). */
export type DropEvent =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' }

export const DROP_PROGRESS_ID = 'prog:drop'

export interface DropSourceDeps {
  /** Abonnement aux événements de dépôt de la fenêtre (promesse de désabonnement). */
  onDragDrop: (handler: (event: DropEvent) => void) => Promise<() => void>
  devicePixelRatio: () => number
  /** Rectangles (px CSS) des formes de l'île ; vide si introuvables. */
  shapeRects: () => DropRect[]
  /** Zone (`data-zone`) sous le point (px CSS), null si aucune. */
  zoneAt: (x: number, y: number) => IslandDropZone | null
  readDroppedAudio: (path: string) => Promise<ArrayBuffer>
  uploadMeetingRecording: (params: UploadMeetingParams) => Promise<{ input: Input }>
  /** Copie dans le presse-papiers : commande Rust d'abord, `navigator.clipboard` en secours. */
  copyText: (text: string) => Promise<void>
  readLastProjectId: () => string | null
}

type Phase = 'idle' | 'wake' | 'over'

interface ImportJob {
  path: string
  fileName: string
  mimeType: string
  projectId: string
  resume: UploadResume
}

const NO_RESUME: UploadResume = { created: null, uploaded: false }

/** MeetingUploadError porte la reprise (lu sans importer la classe, qui tire l'API et Supabase). */
function resumeOf(error: unknown): UploadResume | null {
  if (!error || typeof error !== 'object' || !('resume' in error)) return null
  const resume = (error as { resume: unknown }).resume
  return resume && typeof resume === 'object' ? (resume as UploadResume) : null
}

export function createDropSource(deps: DropSourceDeps): IslandSource {
  return {
    id: 'depot',
    start(ctx) {
      const { coordinator } = ctx
      let phase: Phase = 'idle'
      let path: string | null = null
      let info: IslandDropInfo | null = null
      /** Glissement ignoré (appel proposé) jusqu'à sa fin. */
      let ignored = false
      /** Import en cours, et dernier import en échec (Réessayer). */
      let importing = false
      let failed: ImportJob | null = null

      function projectForImport(): { id: string; name: string | null } | null {
        const projects = ctx.projects.get()
        const id = pickDefaultProject(projects, deps.readLastProjectId())
        return id ? { id, name: projectNameOf(projects, id) } : null
      }

      function currentInfo(forPath: string): IslandDropInfo {
        return dropInfoFor({
          path: forPath,
          sessions: ctx.view.get().sessions,
          projectName: projectForImport()?.name ?? null,
        })
      }

      function showPhase(next: 'wake' | 'over'): void {
        if (phase === next) return
        phase = next
        coordinator.showOverlay(next === 'wake' ? 'dragWake' : 'dragOver')
        if (next === 'wake') ctx.view.patch({ hotZone: null })
      }

      /** Retour à l'état précédent : plus d'overlay, plus de fichier dans la vue. */
      function reset(): void {
        const was = phase
        phase = 'idle'
        path = null
        info = null
        ignored = false
        ctx.view.patch({ drop: null, hotZone: null })
        if (was !== 'idle') coordinator.hideOverlay(was === 'wake' ? 'dragWake' : 'dragOver')
      }

      /** Position (px physiques) → état de l'île et zone survolée. */
      function follow(position: { x: number; y: number }): void {
        if (phase === 'idle') return
        const point = toCssPoint(position, deps.devicePixelRatio())
        const rects = deps.shapeRects()
        // Formes introuvables : on passe directement aux zones plutôt que de rester sur « Dépose ici ».
        const near = (margin: number) => rects.length === 0 || inAnyRect(rects, margin, point.x, point.y)
        if (phase === 'wake' && near(DRAG_ENTER_MARGIN) && path) {
          info = currentInfo(path)
          ctx.view.patch({ drop: info })
          showPhase('over')
        } else if (phase === 'over' && !near(DRAG_KEEP_MARGIN)) {
          showPhase('wake')
        }
        ctx.view.patch({ hotZone: phase === 'over' ? deps.zoneAt(point.x, point.y) : null })
      }

      function onEvent(event: DropEvent): void {
        switch (event.type) {
          case 'enter': {
            if (coordinator.getSnapshot().state === 'appel') {
              ignored = true
              return
            }
            const first = event.paths[0]
            if (!first) return
            ignored = false
            path = first
            info = currentInfo(first)
            ctx.view.patch({ drop: info, hotZone: null })
            showPhase('wake')
            follow(event.position)
            return
          }
          case 'over':
            follow(event.position)
            return
          case 'leave':
            reset()
            return
          case 'drop': {
            if (ignored || phase === 'idle') {
              reset()
              return
            }
            // La zone se lit à la position du dépôt, pas au dernier `over` (le curseur a pu bouger).
            follow(event.position)
            const dropped = event.paths[0] ?? path
            const zone = phase === 'over' ? actionableZone(ctx.view.get().hotZone, info) : null
            reset()
            if (!dropped || !zone) return
            if (zone === 'transcribe') void startImport(dropped)
            else void copyPath(dropped)
            return
          }
        }
      }

      // -----------------------------------------------------------------------
      // Claude Code : chemin copié
      // -----------------------------------------------------------------------

      async function copyPath(filePath: string): Promise<void> {
        try {
          await deps.copyText(filePath)
        } catch (e) {
          console.warn('[île] copie du chemin :', e)
          coordinator.notify(
            createNotification('uploadError', { message: errorMessage(e, 'Impossible de copier le chemin du fichier.') }),
          )
          return
        }
        if (!ctx.isDisposed()) coordinator.notify(createNotification('pathCopied', { fileName: fileNameOf(filePath) }))
      }

      // -----------------------------------------------------------------------
      // Transcrire : audio → entrée réunion
      // -----------------------------------------------------------------------

      function showProgress(sizeBytes: number | null): void {
        const existing = coordinator.getActivity(DROP_PROGRESS_ID)
        if (existing?.kind === 'progress') coordinator.updateActivity(DROP_PROGRESS_ID, { estimatedMs: estimateUploadMs(sizeBytes) })
        else coordinator.addActivity({ ...uploadProgress(ctx.clock.now(), sizeBytes), id: DROP_PROGRESS_ID })
      }

      function fail(message: string): void {
        coordinator.removeActivity(DROP_PROGRESS_ID)
        coordinator.notify(createNotification('uploadError', { message }))
      }

      async function startImport(filePath: string): Promise<void> {
        if (importing) return
        const mimeType = audioMimeOf(filePath)
        if (!mimeType) return
        if (ctx.session.get().status !== 'signedIn') {
          coordinator.notify(createNotification('loginRequired', {}))
          return
        }
        const project = projectForImport()
        if (!project) {
          coordinator.notify(createNotification('uploadError', { message: 'Aucun projet disponible pour importer ce fichier.' }))
          return
        }
        failed = null
        await runImport({ path: filePath, fileName: fileNameOf(filePath), mimeType, projectId: project.id, resume: NO_RESUME })
      }

      async function runImport(job: ImportJob): Promise<void> {
        if (importing) return
        importing = true
        showProgress(null)
        try {
          const bytes = await deps.readDroppedAudio(job.path)
          if (ctx.isDisposed()) return
          showProgress(bytes.byteLength)
          const { input } = await deps.uploadMeetingRecording({
            projectId: job.projectId,
            title: titleOf(job.path),
            file: new Blob([bytes], { type: job.mimeType }),
            fileName: job.fileName,
            contentType: job.mimeType,
            resume: job.resume,
            onCreated: (created) => {
              job.resume = { ...job.resume, created }
            },
          })
          failed = null
          if (ctx.isDisposed()) return
          coordinator.removeActivity(DROP_PROGRESS_ID)
          ctx.bus.emit('trackInput', { inputId: input.id, durationSecs: null })
        } catch (e) {
          // Reprise sans doublon : entrée déjà créée, fichier déjà envoyé.
          const resume = resumeOf(e)
          if (resume) job.resume = resume
          failed = job
          if (!ctx.isDisposed()) fail(errorMessage(e, 'Une erreur est survenue. Réessaie.'))
        } finally {
          importing = false
        }
      }

      const stops = [
        listen(ctx, deps.onDragDrop, onEvent),
        () => {
          if (phase !== 'idle') reset()
        },
      ]

      return {
        dispose: () => stops.forEach((stop) => stop()),
        actions: {
          // La source « envoi » prend aussi cette action pour les enregistrements : chacune reprend le sien.
          retryUpload: async () => {
            const job = failed
            if (job && !importing) await runImport(job)
          },
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels
// ---------------------------------------------------------------------------

const ZONE_SELECTOR = '[data-zone]'

function isDropZone(value: string | undefined): value is IslandDropZone {
  return value === 'transcribe' || value === 'files' || value === 'claude'
}

/** La forme de l'île est le premier enfant de la racine (`[data-state]`) ; sa taille suit l'animation. */
function domShapeRects(): DropRect[] {
  const shape = document.querySelector('[data-state]')?.firstElementChild
  if (!(shape instanceof HTMLElement)) return []
  const { left, top, right, bottom } = shape.getBoundingClientRect()
  return right > left && bottom > top ? [{ left, top, right, bottom }] : []
}

function domZoneAt(x: number, y: number): IslandDropZone | null {
  const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>(ZONE_SELECTOR)?.dataset.zone
  return isDropZone(zone) ? zone : null
}

/** Rust d'abord (marche sans focus), puis le presse-papiers du navigateur. */
async function copyTextWithFallback(text: string): Promise<void> {
  try {
    await copyText(text)
  } catch (e) {
    console.warn('[île] presse-papiers Rust indisponible, essai du navigateur :', e)
    await navigator.clipboard.writeText(text)
  }
}

/**
 * Accès réels. Supabase et l'API ne sont chargés qu'à l'envoi (import dynamique) : importer ce fichier (tests, labo)
 * ne les tire pas.
 */
export const desktopDropDeps: DropSourceDeps = {
  onDragDrop: (handler) => getCurrentWebview().onDragDropEvent((event) => handler(event.payload)),
  devicePixelRatio: () => window.devicePixelRatio,
  shapeRects: domShapeRects,
  zoneAt: domZoneAt,
  readDroppedAudio,
  async uploadMeetingRecording(params) {
    const { uploadMeetingRecording } = await import('../../../inputs/uploadMeeting')
    return uploadMeetingRecording(params)
  },
  copyText: copyTextWithFallback,
  readLastProjectId,
}

export const dropSource: IslandSource = createDropSource(desktopDropDeps)
