/**
 * Bus d'événements entre les sources du contrôleur : une source annonce, les autres réagissent, sans
 * s'importer entre elles. Pur : ni React ni Tauri.
 *
 * Ajouter un événement : une ligne dans IslandBusEvents (nom → contenu), documentée.
 */
import type { RecordingResult } from '../../../shared/desktop-contract'

export interface IslandBusEvents {
  /** L'arrêt de l'enregistrement est demandé (bouton, notification, menu du soleil) : l'île montre l'import. */
  recordingStopping: undefined
  /** L'enregistrement est arrêté : le fichier est sur l'ordinateur, prêt à envoyer. */
  recordingStopped: RecordingResult
  /** L'arrêt a échoué (l'enregistrement continue peut-être). */
  recordingStopFailed: { message: string }
  /**
   * Suivre le traitement d'une entrée (transcription puis analyse) : progression « Analyse de l'appel »,
   * puis « N tickets à valider » ou « L'analyse a échoué ». Émis après l'envoi d'un appel ; un fichier audio
   * déposé sur l'île (lot glisser-déposer) peut l'émettre aussi.
   */
  trackInput: { inputId: string; durationSecs: number | null }
  /** Fichiers déposés sur la zone « Ranger » (tous ceux de la sélection) : la source « rangement » les classe. */
  fileFiles: { files: readonly File[] }
  /**
   * Un lot de rangement part de cette île (avant l'envoi) : la source « notifications » ignore ensuite les
   * notifications file.ready / file.auto_filed de ce lot, déjà annoncées par le déroulé de l'île.
   */
  filingBatch: { batchId: string }
}

export type IslandBusEvent = keyof IslandBusEvents

type Handler<E extends IslandBusEvent> = (payload: IslandBusEvents[E]) => void

export interface IslandBus {
  emit<E extends IslandBusEvent>(event: E, ...payload: IslandBusEvents[E] extends undefined ? [] : [IslandBusEvents[E]]): void
  /** Renvoie la désinscription. */
  on<E extends IslandBusEvent>(event: E, handler: Handler<E>): () => void
}

export function createIslandBus(): IslandBus {
  const handlers = new Map<IslandBusEvent, Set<(payload: unknown) => void>>()
  return {
    emit(event, ...payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(payload[0])
        } catch (e) {
          console.error(`[île] événement ${event} :`, e)
        }
      }
    },
    on(event, handler) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      const wrapped = handler as (payload: unknown) => void
      set.add(wrapped)
      return () => {
        set.delete(wrapped)
      }
    },
  }
}
