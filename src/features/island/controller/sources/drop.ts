/**
 * Source « glisser-déposer » : un fichier glissé sur l'île (dépôt HTML5 géré par WebView2 : `dragenter`,
 * `dragover`, `dragleave`, `drop` sur la fenêtre ; le gestionnaire natif de Tauri est désactivé sur l'île).
 *
 * Limite de Windows : la fenêtre de l'île est transparente aux clics ; elle ne devient cible de dépôt que
 * lorsque le curseur entre dans la marge de 24 px autour des formes, bouton principal enfoncé (Rust,
 * `dragMargin`). Avant cela, aucun événement n'arrive : on ne détecte pas un glissement partout sur l'écran.
 * Les positions (`clientX`, `clientY`) sont déjà en px CSS.
 *
 * Pendant le glissement, le navigateur ne donne pas le nom du fichier, seulement son type MIME
 * (`dataTransfer.items[0].type`) : l'île affiche un libellé provisoire (« Fichier audio », « Image »,
 * « Document »). Le vrai fichier (nom, type, octets) n'arrive qu'au dépôt.
 *
 * Déroulé
 * - enter : « Dépose ici » (overlay dragWake) et `view.drop` (libellé, projet, zones proposées).
 *   Zones : Transcrire pour l'audio seulement, Analyser pour un document (PDF, Word .docx, texte ; d'après
 *   le type MIME seulement), Claude Code si une session est active (statut autre que
 *   terminé ou inactif), Fichiers jamais (masquée tant que les fichiers de projet n'existent pas).
 * - over : curseur sur la forme (marge de 0 px) → les zones (dragOver) ; on y reste tant que le curseur
 *   est à moins de 24 px de la forme (le prototype réveillait à 24 px ; l'écart évite de clignoter entre
 *   les deux états). `view.hotZone` suit l'élément `[data-zone]` sous le curseur.
 * - leave : retour à l'état précédent (overlay retiré, `drop` et `hotZone` vidés).
 * - drop : sur Transcrire avec un audio → entrée « réunion » sur le dernier projet utilisé (sinon le premier),
 *   avec « Import de l'audio » puis le suivi d'analyse (bus trackInput) comme pour un appel ; échec :
 *   « L'envoi de l'audio a échoué », Réessayer reprend sans doublon. Sur Claude Code → le fichier est copié
 *   par Rust dans le dossier des dépôts (`saveDroppedFile`), le chemin de cette copie est mis dans le
 *   presse-papiers, notification « Chemin copié ». Ailleurs ou zone absente → annulé.
 * - drop sur Analyser : le nom réel est revérifié (`documentKind`), puis le texte est extrait et un retour
 *   écrit créé sur le même projet par `createWrittenInputFromDocument` (comme « Nouvelle entrée > Retour
 *   écrit ») ; progression « Lecture du document » puis suivi d'analyse (trackInput). Erreurs : `uploadError`
 *   avec le message (format, texte vide, API), sans connexion `loginRequired` ; Réessayer reprend le document.
 * - Un seul fichier est traité : le premier de la sélection.
 * - Pendant la proposition d'un appel (overlay `appel`), le glissement est ignoré : l'appel reste affiché.
 */
import { copyText, saveDroppedFile } from '../../../../lib/desktop'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import { createNotification } from '../../catalog'
import { readLastProjectId } from '../../../desktop/storage'
import {
  DRAG_ENTER_MARGIN,
  DRAG_KEEP_MARGIN,
  actionableZone,
  audioMimeOfFile,
  dropInfoForDrag,
  inAnyRect,
  isDocumentFile,
  titleOf,
  type DragSubject,
  type DropRect,
} from '../../drop/logic'
import type { IslandDropInfo, IslandDropZone } from '../../view/types'
import { errorMessage, estimateUploadMs, pickDefaultProject, projectNameOf, uploadProgress } from '../callFlow'
import type { IslandSource } from '../source'
import { listen } from './listen'

/** Événement de dépôt, dérivé des événements DOM (positions en px CSS de la fenêtre). */
export type DropEvent =
  | { type: 'enter'; mimeType: string; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; file: File; position: { x: number; y: number } }
  | { type: 'leave' }

export const DROP_PROGRESS_ID = 'prog:drop'
/** Libellé de la progression d'« Analyser » (même étape `upload` que l'import de l'audio). */
export const DOCUMENT_PROGRESS_LABEL = 'Lecture du document'

export interface DropSourceDeps {
  /** Abonnement aux événements de dépôt de la fenêtre (promesse de désabonnement). */
  onDragDrop: (handler: (event: DropEvent) => void) => Promise<() => void>
  /** Rectangles (px CSS) des formes de l'île ; vide si introuvables. */
  shapeRects: () => DropRect[]
  /** Zone (`data-zone`) sous le point (px CSS), null si aucune. */
  zoneAt: (x: number, y: number) => IslandDropZone | null
  /** Copie le fichier côté Rust (dossier des dépôts) et renvoie le chemin absolu de la copie. */
  saveDroppedFile: (file: File, name: string) => Promise<string>
  uploadMeetingRecording: (params: UploadMeetingParams) => Promise<{ input: Input }>
  /** Retour écrit d'un document (texte extrait, entrée créée, analyse lancée par le serveur). Erreurs en français. */
  createDocumentInput: (file: File, projectId: string) => Promise<Input>
  /** Copie dans le presse-papiers : commande Rust d'abord, `navigator.clipboard` en secours. */
  copyText: (text: string) => Promise<void>
  readLastProjectId: () => string | null
}

type Phase = 'idle' | 'wake' | 'over'

interface ImportJob {
  file: File
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
      let subject: DragSubject | null = null
      let info: IslandDropInfo | null = null
      /** Glissement ignoré (appel proposé) jusqu'à sa fin. */
      let ignored = false
      /** Import en cours, et dernier import en échec (Réessayer). */
      let importing = false
      let failed: ImportJob | null = null
      /** Dernier document en échec (Réessayer de « Analyser »). */
      let failedDocument: { file: File; projectId: string } | null = null

      function projectForImport(): { id: string; name: string | null } | null {
        const projects = ctx.projects.get()
        const id = pickDefaultProject(projects, deps.readLastProjectId())
        return id ? { id, name: projectNameOf(projects, id) } : null
      }

      function currentInfo(forSubject: DragSubject): IslandDropInfo {
        return dropInfoForDrag({
          subject: forSubject,
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
        subject = null
        info = null
        ignored = false
        ctx.view.patch({ drop: null, hotZone: null })
        if (was !== 'idle') coordinator.hideOverlay(was === 'wake' ? 'dragWake' : 'dragOver')
      }

      /** Position (px CSS) → état de l'île et zone survolée. */
      function follow(point: { x: number; y: number }): void {
        if (phase === 'idle') return
        const rects = deps.shapeRects()
        // Formes introuvables : on passe directement aux zones plutôt que de rester sur « Dépose ici ».
        const near = (margin: number) => rects.length === 0 || inAnyRect(rects, margin, point.x, point.y)
        if (phase === 'wake' && near(DRAG_ENTER_MARGIN) && subject) {
          info = currentInfo(subject)
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
            ignored = false
            subject = { mimeType: event.mimeType }
            info = currentInfo(subject)
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
            const zone = phase === 'over' ? actionableZone(ctx.view.get().hotZone, info) : null
            reset()
            if (!zone) return
            if (zone === 'transcribe') void startImport(event.file)
            else if (zone === 'analyse') void startAnalyse(event.file)
            else void copyPath(event.file)
            return
          }
        }
      }

      // -----------------------------------------------------------------------
      // Claude Code : chemin copié
      // -----------------------------------------------------------------------

      async function copyPath(file: File): Promise<void> {
        try {
          // Le dépôt HTML5 ne donne pas le chemin d'origine : Rust garde une copie et en renvoie le chemin.
          const savedPath = await deps.saveDroppedFile(file, file.name)
          await deps.copyText(savedPath)
        } catch (e) {
          console.warn('[île] copie du chemin :', e)
          coordinator.notify(
            createNotification('uploadError', {
              title: 'La copie du chemin a échoué',
              message: errorMessage(e, 'Impossible de copier le chemin du fichier.'),
            }),
          )
          return
        }
        if (!ctx.isDisposed()) coordinator.notify(createNotification('pathCopied', { fileName: file.name }))
      }

      // -----------------------------------------------------------------------
      // Transcrire : audio → entrée réunion
      // -----------------------------------------------------------------------

      function showProgress(sizeBytes: number | null, label?: string): void {
        const existing = coordinator.getActivity(DROP_PROGRESS_ID)
        if (existing?.kind === 'progress') coordinator.updateActivity(DROP_PROGRESS_ID, { estimatedMs: estimateUploadMs(sizeBytes) })
        else {
          const progress = uploadProgress(ctx.clock.now(), sizeBytes)
          coordinator.addActivity({ ...progress, id: DROP_PROGRESS_ID, ...(label ? { label } : {}) })
        }
      }

      function fail(message: string, title?: string): void {
        coordinator.removeActivity(DROP_PROGRESS_ID)
        coordinator.notify(createNotification('uploadError', title ? { message, title } : { message }))
      }

      async function startImport(file: File): Promise<void> {
        if (importing) return
        const mimeType = audioMimeOfFile(file)
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
        failedDocument = null
        await runImport({ file, fileName: file.name, mimeType, projectId: project.id, resume: NO_RESUME })
      }

      async function runImport(job: ImportJob): Promise<void> {
        if (importing) return
        importing = true
        showProgress(job.file.size)
        try {
          const { input } = await deps.uploadMeetingRecording({
            projectId: job.projectId,
            title: titleOf(job.fileName),
            file: job.file,
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

      // -----------------------------------------------------------------------
      // Analyser : document → retour écrit
      // -----------------------------------------------------------------------

      async function startAnalyse(file: File): Promise<void> {
        if (importing) return
        // Au dépôt on a le vrai nom : on revérifie ce que le type MIME laissait supposer.
        if (!isDocumentFile(file)) {
          fail(`« ${file.name} » : format non pris en charge (PDF, Word .docx ou texte).`, "L'import du document a échoué")
          return
        }
        if (ctx.session.get().status !== 'signedIn') {
          coordinator.notify(createNotification('loginRequired', {}))
          return
        }
        const project = projectForImport()
        if (!project) {
          fail('Aucun projet disponible pour analyser ce document.', "L'import du document a échoué")
          return
        }
        failed = null
        await runAnalyse(file, project.id)
      }

      async function runAnalyse(file: File, projectId: string): Promise<void> {
        if (importing) return
        importing = true
        failedDocument = null
        showProgress(file.size, DOCUMENT_PROGRESS_LABEL)
        try {
          const input = await deps.createDocumentInput(file, projectId)
          if (ctx.isDisposed()) return
          coordinator.removeActivity(DROP_PROGRESS_ID)
          ctx.bus.emit('trackInput', { inputId: input.id, durationSecs: null })
        } catch (e) {
          failedDocument = { file, projectId }
          if (!ctx.isDisposed()) fail(errorMessage(e, `« ${file.name} » : une erreur est survenue.`), "L'import du document a échoué")
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
            const document = failedDocument
            if (job && !importing) await runImport(job)
            else if (document && !importing) await runAnalyse(document.file, document.projectId)
          },
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels
// ---------------------------------------------------------------------------

/** Le glissement contient un fichier (et pas du texte ou un lien). */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Événements DOM de glissement → `DropEvent`. Ne suit que les glissements de fichiers. `dragenter` et
 * `dragleave` se déclenchent aussi en passant d'un élément à l'autre : un compteur de profondeur ne garde que
 * la vraie entrée et la vraie sortie de la fenêtre. `preventDefault` sur dragenter, dragover et drop autorise le
 * dépôt (sinon WebView2 ouvre le fichier). Renvoie le désabonnement.
 */
export function domDragEvents(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, handler: (event: DropEvent) => void): () => void {
  let depth = 0
  const position = (e: DragEvent) => ({ x: e.clientX, y: e.clientY })

  const onEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth += 1
    if (depth === 1) handler({ type: 'enter', mimeType: e.dataTransfer?.items[0]?.type ?? '', position: position(e) })
  }
  const onOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    // Un dragover sans dragenter (page rechargée pendant le glissement) : on rattrape l'entrée.
    if (depth === 0) {
      depth = 1
      handler({ type: 'enter', mimeType: e.dataTransfer?.items[0]?.type ?? '', position: position(e) })
    }
    handler({ type: 'over', position: position(e) })
  }
  const onLeave = (e: DragEvent) => {
    if (!hasFiles(e) || depth === 0) return
    depth -= 1
    if (depth === 0) handler({ type: 'leave' })
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    const file = e.dataTransfer?.files[0]
    if (file) handler({ type: 'drop', file, position: position(e) })
    else handler({ type: 'leave' })
  }

  const listeners: Array<[string, (e: DragEvent) => void]> = [
    ['dragenter', onEnter],
    ['dragover', onOver],
    ['dragleave', onLeave],
    ['drop', onDrop],
  ]
  for (const [name, fn] of listeners) target.addEventListener(name, fn as EventListener)
  return () => {
    for (const [name, fn] of listeners) target.removeEventListener(name, fn as EventListener)
  }
}

const ZONE_SELECTOR = '[data-zone]'

function isDropZone(value: string | undefined): value is IslandDropZone {
  return value === 'transcribe' || value === 'analyse' || value === 'files' || value === 'claude'
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
  onDragDrop: async (handler) => domDragEvents(window, handler),
  shapeRects: domShapeRects,
  zoneAt: domZoneAt,
  saveDroppedFile,
  async uploadMeetingRecording(params) {
    const { uploadMeetingRecording } = await import('../../../inputs/uploadMeeting')
    return uploadMeetingRecording(params)
  },
  async createDocumentInput(file, projectId) {
    const { createWrittenInputFromDocument } = await import('../../../inputs/createDocumentInput')
    return createWrittenInputFromDocument(file, projectId)
  },
  copyText: copyTextWithFallback,
  readLastProjectId,
}

export const dropSource: IslandSource = createDropSource(desktopDropDeps)
