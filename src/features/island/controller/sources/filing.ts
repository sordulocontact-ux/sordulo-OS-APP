/**
 * Source « rangement » : les fichiers déposés sur la zone « Ranger » de l'île (bus fileFiles, émis par la source
 * « dépôt ») sont envoyés et classés par l'IA (bibliothèque src/lib/filing.ts, lot L5), puis l'île dit ce
 * qu'elle a trouvé et fait valider. Textes et choix : drop/filing.ts (pur, testé).
 *
 * Déroulé
 * - Sans connexion : on attend la session partagée (waitForSignedIn), sinon « Connecte-toi dans Sordulo OS ».
 * - Le lot est annoncé sur le bus (filingBatch) AVANT l'envoi : la source « notifications » ignore ensuite les
 *   notifications file.ready / file.auto_filed de ce lot (Realtime peut arriver avant la fin de startBatch).
 * - Progression « Classement de N fichiers », puis « Classement… 2 / 3 » (avancement réel).
 * - Puis, selon le plan (planBatch) : erreurs → « Le classement a échoué » + Réessayer (seulement ces
 *   fichiers) ; un fichier à vérifier ou un doublon → « À vérifier » + Vérifier (écran du dépôt, ou du lot) ;
 *   un fichier sûr → décision Ranger / Modifier / Toujours ; plusieurs → Tout ranger / Vérifier ; tout rangé
 *   par des règles « Toujours » → « Rangé : … » + Annuler.
 * - Ranger → fileIntake (avec « Toujours » si coché) → « Rangé dans App Ibé › Devis » + Annuler. Modifier /
 *   Vérifier → fenêtre principale sur l'écran de rangement. Échap : plus tard (le dépôt attend dans l'app).
 *   Décision mise de côté (personne sur l'île) → « Fichier prêt à ranger », Voir la remontre.
 * - Annuler → undoFiling (et révocation de la règle « Toujours » créée par ce rangement).
 */
import { openMainAt } from '../../../../lib/desktop'
import type { BatchResult, FiledResult, IntakeOutcome, StartBatchOptions } from '../../../../lib/filing'
import type { FileIntake } from '../../../../shared/types'
import { createNotification } from '../../catalog'
import {
  FILING_PROGRESS_STAGE,
  FILING_CHOICE_PREFIX,
  FILING_PROGRESS_ID,
  autoFiledNotification,
  batchRoute,
  estimateFilingMs,
  filedManyNotification,
  filedNotification,
  filingErrorNotification,
  filingFailedNotification,
  filingItemOf,
  filingItemsOf,
  filingProgressLabel,
  idsToName,
  intakeRoute,
  planBatch,
  readyChoice,
  readyManyChoice,
  reviewNotification,
  setAsideNotification,
  undoneNotification,
  type FilingItem,
  type FilingNames,
} from '../../drop/filing'
import type { IslandChoice } from '../../types'
import { errorMessage } from '../callFlow'
import type { IslandSource } from '../source'

export interface FilingSourceDeps {
  /** Envoie et fait classer les fichiers (startBatch de src/lib/filing.ts). Ne lève pas. */
  startBatch: (files: readonly File[], options: StartBatchOptions) => Promise<BatchResult>
  /** Relance le classement d'un dépôt (ne lève pas : l'échec revient dans classifyError). */
  classifyIntake: (intakeId: string) => Promise<IntakeOutcome>
  /** Range le dépôt comme l'IA l'a proposé (choiceFromProposal), avec la règle « Toujours » si `always`. */
  fileReady: (intake: FileIntake, always: boolean) => Promise<FiledResult>
  undoFiling: (intakeId: string) => Promise<FileIntake>
  revokeFilingRule: (ruleId: string) => Promise<void>
  /** Noms des clients par id (libellés « Ibé › App Ibé ») ; un échec donne des libellés sans client. */
  fetchClientNames: (clientIds: readonly string[]) => Promise<Record<string, string>>
  /** Fenêtre principale sur une route (écran de rangement). */
  openMain: (route: string) => Promise<void> | void
  randomUUID: () => string
}

/** Lot de cette île : fichiers à renvoyer, état de chaque fichier, noms. */
interface BatchRecord {
  /** Fichiers dont l'envoi a échoué (rien n'a été créé) : renvoyés par Réessayer. */
  unsent: File[]
  items: FilingItem[]
  names: FilingNames
}

type ChoiceRecord =
  | { kind: 'one'; batchId: string; item: FilingItem; choice: IslandChoice }
  | { kind: 'many'; batchId: string; items: readonly FilingItem[]; choice: IslandChoice }

export function createFilingSource(deps: FilingSourceDeps): IslandSource {
  return {
    id: 'rangement',
    start(ctx) {
      const { coordinator, clock } = ctx
      const batches = new Map<string, BatchRecord>()
      const choices = new Map<string, ChoiceRecord>()
      const busy = new Set<string>()

      const progressId = (batchId: string) => `${FILING_PROGRESS_ID}:${batchId}`

      function showProgress(batchId: string, total: number, label = filingProgressLabel(0, total)): void {
        coordinator.addActivity({
          id: progressId(batchId),
          kind: 'progress',
          stage: FILING_PROGRESS_STAGE,
          label,
          fraction: null,
          startedAt: clock.now(),
          estimatedMs: estimateFilingMs(total),
        })
      }

      async function namesFor(items: readonly FilingItem[]): Promise<FilingNames> {
        const { clientIds, projectIds } = idsToName(items)
        const projects: Record<string, string> = {}
        for (const project of ctx.projects.get()) if (projectIds.includes(project.id)) projects[project.id] = project.name
        let clients: Record<string, string> = {}
        if (clientIds.length > 0) {
          try {
            clients = await deps.fetchClientNames(clientIds)
          } catch (e) {
            console.warn('[île] noms des clients indisponibles :', e)
          }
        }
        return { clients, projects }
      }

      function offerChoice(record: ChoiceRecord): void {
        choices.set(record.choice.id, record)
        const count = record.kind === 'one' ? 1 : record.items.length
        coordinator.requestChoice(record.choice, {
          onSetAside: () => {
            if (!ctx.isDisposed() && choices.has(record.choice.id)) coordinator.notify(setAsideNotification(record.choice, count))
          },
        })
      }

      /** Ce que l'île annonce pour ces fichiers (un lot, ou les fichiers réessayés d'un lot). */
      function announce(batchId: string, items: readonly FilingItem[], names: FilingNames): void {
        const plan = planBatch(items)
        const { main } = plan
        if (main.type === 'auto') coordinator.notify(autoFiledNotification(main.items, names))
        else if (main.type === 'review') coordinator.notify(reviewNotification(main, batchId))
        else if (main.type === 'readyOne') {
          offerChoice({ kind: 'one', batchId, item: main.item, choice: readyChoice(main.item, names, main.auto) })
        } else if (main.type === 'readyMany') {
          offerChoice({ kind: 'many', batchId, items: main.items, choice: readyManyChoice(main.items, batchId, names, main.auto) })
        }
        if (plan.errors.length > 0) coordinator.notify(filingErrorNotification(plan.errors, batchId))
      }

      /** Classe des fichiers (nouveau lot, ou fichiers jamais envoyés d'un lot) ; renvoie leurs états. */
      async function sendFiles(batchId: string, files: readonly File[], record: BatchRecord, total: number, doneBefore = 0): Promise<FilingItem[]> {
        const { organizationId, memberId } = ctx.session.get()
        if (!organizationId || !memberId) return []
        const result = await deps.startBatch(files, {
          source: 'island',
          organizationId,
          memberId,
          batchId,
          onProgress: ({ done }) => {
            if (ctx.isDisposed()) return
            coordinator.updateActivity(progressId(batchId), {
              label: filingProgressLabel(doneBefore + done, total),
              fraction: (doneBefore + done) / total,
            })
          },
        })
        record.unsent.push(...result.items.filter((item) => item.outcome === null).map((item) => item.file))
        return filingItemsOf(result.items)
      }

      async function startFiling(files: readonly File[]): Promise<void> {
        if (files.length === 0) return
        if (ctx.session.get().status !== 'signedIn' && !(await ctx.waitForSignedIn())) {
          if (!ctx.isDisposed()) {
            coordinator.notify(createNotification('loginRequired', { reason: 'Pour ranger tes fichiers', route: '/login' }))
          }
          return
        }
        if (ctx.isDisposed()) return
        const batchId = deps.randomUUID()
        const record: BatchRecord = { unsent: [], items: [], names: { clients: {}, projects: {} } }
        batches.set(batchId, record)
        ctx.bus.emit('filingBatch', { batchId })
        showProgress(batchId, files.length)
        let items: FilingItem[]
        try {
          items = await sendFiles(batchId, files, record, files.length)
        } catch (e) {
          if (!ctx.isDisposed()) coordinator.notify(filingFailedNotification({ title: 'Le classement a échoué', message: errorMessage(e, 'Réessaie.'), route: batchRoute(batchId) }))
          return
        } finally {
          coordinator.removeActivity(progressId(batchId))
        }
        if (ctx.isDisposed()) return
        record.items = items
        record.names = await namesFor(items)
        if (ctx.isDisposed()) return
        announce(batchId, items, record.names)
      }

      /** Réessayer : reclasse les dépôts en erreur et renvoie les fichiers jamais envoyés, puis annonce ceux-là. */
      async function retry(batchId: string): Promise<void> {
        const record = batches.get(batchId)
        if (!record || busy.has(batchId)) return
        const failed = record.items.filter((item) => item.kind === 'error' && item.intake)
        const unsent = record.unsent.splice(0)
        const total = failed.length + unsent.length
        if (total === 0) return
        busy.add(batchId)
        showProgress(batchId, total)
        let retried: FilingItem[] = []
        try {
          let done = 0
          for (const item of failed) {
            const outcome = await deps.classifyIntake(item.intake!.id)
            done += 1
            coordinator.updateActivity(progressId(batchId), { label: filingProgressLabel(done, total), fraction: done / total })
            const state = filingItemOf({ file: { name: item.fileName }, outcome, error: outcome.classifyError })
            if (state) retried.push(state)
          }
          if (unsent.length > 0) retried = retried.concat(await sendFiles(batchId, unsent, record, total, done))
        } catch (e) {
          if (!ctx.isDisposed()) coordinator.notify(filingFailedNotification({ title: 'Le classement a échoué', message: errorMessage(e, 'Réessaie plus tard.'), route: batchRoute(batchId) }))
          return
        } finally {
          busy.delete(batchId)
          coordinator.removeActivity(progressId(batchId))
        }
        if (ctx.isDisposed()) return
        // Les fichiers réessayés remplacent leur ancien état (les autres du lot ont déjà été annoncés).
        const retriedIds = new Set(failed.map((item) => item.intake!.id))
        record.items = record.items.filter((item) => !(item.intake && retriedIds.has(item.intake.id)) && item.intake !== null).concat(retried)
        record.names = { ...record.names, ...(await namesFor(retried)) }
        if (ctx.isDisposed()) return
        announce(batchId, retried, record.names)
      }

      async function fileOne(record: Extract<ChoiceRecord, { kind: 'one' }>, always: boolean): Promise<void> {
        const intake = record.item.intake
        if (!intake) return
        const names = batches.get(record.batchId)?.names ?? { clients: {}, projects: {} }
        try {
          const result = await deps.fileReady(intake, always)
          if (ctx.isDisposed()) return
          coordinator.notify(filedNotification({ ...result, names }))
        } catch (e) {
          if (ctx.isDisposed()) return
          coordinator.notify(
            filingFailedNotification({ title: 'Le rangement a échoué', message: errorMessage(e, 'Réessaie dans l’app.'), route: intakeRoute(intake.id) }),
          )
        }
      }

      async function fileMany(record: Extract<ChoiceRecord, { kind: 'many' }>): Promise<void> {
        const names = batches.get(record.batchId)?.names ?? { clients: {}, projects: {} }
        const filed: FiledResult[] = []
        let failed = 0
        const total = record.items.length
        coordinator.addActivity({
          id: progressId(record.batchId),
          kind: 'progress',
          stage: FILING_PROGRESS_STAGE,
          label: `Rangement de ${total} fichiers`,
          fraction: 0,
          startedAt: clock.now(),
          estimatedMs: estimateFilingMs(total),
        })
        try {
          for (const item of record.items) {
            if (!item.intake) continue
            try {
              filed.push(await deps.fileReady(item.intake, false))
            } catch (e) {
              console.warn('[île] rangement :', e)
              failed += 1
            }
            coordinator.updateActivity(progressId(record.batchId), { fraction: (filed.length + failed) / total })
          }
        } finally {
          coordinator.removeActivity(progressId(record.batchId))
        }
        if (ctx.isDisposed()) return
        coordinator.notify(filedManyNotification({ filed, failed, batchId: record.batchId, names }))
      }

      async function undo(intakeIds: readonly string[], ruleIds: readonly string[]): Promise<void> {
        const undone: FileIntake[] = []
        let ruleRevoked = false
        try {
          for (const ruleId of ruleIds) {
            await deps.revokeFilingRule(ruleId)
            ruleRevoked = true
          }
          for (const id of intakeIds) undone.push(await deps.undoFiling(id))
        } catch (e) {
          if (ctx.isDisposed()) return
          const [first] = intakeIds
          coordinator.notify(
            filingFailedNotification({
              title: 'L’annulation a échoué',
              message: errorMessage(e, 'Annule le rangement dans l’app.'),
              route: first ? intakeRoute(first) : '/files/inbox',
            }),
          )
          return
        }
        if (ctx.isDisposed() || undone.length === 0) return
        const [first] = undone
        const batchId = first?.batch_id ?? null
        const route = undone.length === 1 && first ? intakeRoute(first.id) : batchId ? batchRoute(batchId) : '/files/inbox'
        coordinator.notify(undoneNotification({ count: undone.length, ruleRevoked, route }))
      }

      const stopFiles = ctx.bus.on('fileFiles', ({ files }) => void startFiling(files))

      return {
        dispose: () => {
          stopFiles()
          batches.clear()
          choices.clear()
        },
        gestures: {
          onChoiceDecision: (decision, choice, always) => {
            if (!choice.id.startsWith(FILING_CHOICE_PREFIX)) return
            const record = choices.get(choice.id)
            coordinator.resolveChoice(choice.id)
            if (!record || busy.has(choice.id)) return
            choices.delete(choice.id)
            if (decision === 'dismiss') return
            if (decision === 'secondary') {
              const route = record.kind === 'one' && record.item.intake ? intakeRoute(record.item.intake.id) : batchRoute(record.batchId)
              void Promise.resolve(deps.openMain(route)).catch((e: unknown) => console.warn('[île] ouverture de l’app :', e))
              return
            }
            busy.add(choice.id)
            const run = record.kind === 'one' ? fileOne(record, always) : fileMany(record)
            void run.finally(() => busy.delete(choice.id))
          },
        },
        actions: {
          retryFiling: (action) => retry(action.batchId),
          undoFiling: (action) => undo(action.intakeIds, action.ruleIds),
          showChoice: (action) => {
            const record = choices.get(action.choiceId)
            if (record && !coordinator.hasChoice(record.choice.id)) offerChoice(record)
          },
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels
// ---------------------------------------------------------------------------

/**
 * Bibliothèque de rangement et Supabase importées à la demande : importer ce fichier (tests, labo) ne crée
 * aucun client réseau.
 */
export const desktopFilingDeps: FilingSourceDeps = {
  async startBatch(files, options) {
    const { startBatch } = await import('../../../../lib/filing')
    return startBatch(files, options)
  },
  async classifyIntake(intakeId) {
    const { classifyIntake } = await import('../../../../lib/filing')
    return classifyIntake(intakeId)
  },
  async fileReady(intake, always) {
    const { FilingError, choiceFromProposal, fileIntake } = await import('../../../../lib/filing')
    const choice = choiceFromProposal(intake)
    if (!choice) throw new FilingError('Choisis un projet.')
    return fileIntake(intake.id, { ...choice, always })
  },
  async undoFiling(intakeId) {
    const { undoFiling } = await import('../../../../lib/filing')
    return undoFiling(intakeId)
  },
  async revokeFilingRule(ruleId) {
    const { revokeFilingRule } = await import('../../../../lib/filing')
    await revokeFilingRule(ruleId)
  },
  async fetchClientNames(clientIds) {
    const { supabase } = await import('../../../../lib/supabase')
    const { data, error } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', [...clientIds])
      .overrideTypes<{ id: string; name: string }[], { merge: false }>()
    if (error) throw error
    return Object.fromEntries(data.map((client) => [client.id, client.name]))
  },
  openMain: (route) => openMainAt({ route }),
  randomUUID: () => crypto.randomUUID(),
}

export const filingSource: IslandSource = createFilingSource(desktopFilingDeps)
