/**
 * Source « gmail » : les mails reçus des contacts clients deviennent, sur demande, des entrées écrites analysées.
 *
 * - Connexion : ligne `gmail` du compte (table `google_connections`, src/lib/google.ts), relue toutes les
 *   CONNECTION_CHECK_MS. Jeton d'accès demandé à Rust (`googleAccessToken`), Gmail appelé depuis le front.
 * - Relève toutes les POLL_MS (recul après une erreur réseau : pollDelayMs) : emails des contacts dont le client a
 *   un projet en cours (sauf mon adresse), mails reçus après `cursor_at` (sinon la date de connexion), en-têtes
 *   seulement. Écartés : ceux dont le Message-ID est déjà une entrée de l'organisation (`inputs.external_ref`),
 *   ceux déjà proposés ou traités dans cette session ou encore en attente. Chaque nouveau mail : notification
 *   « Ibé a envoyé un retour » (Analyser / Ignorer), puis le curseur avance au plus récent (plus jamais reproposé,
 *   autres ordinateurs compris).
 * - Analyser : seulement alors le mail est lu en entier (corps nettoyé, pièces jointes PDF et Word, celles qui
 *   échouent sont sautées), puis une entrée écrite est créée (`externalRef` = Message-ID ; 409 : « Ce mail est
 *   déjà analysé ») et suivie comme un dépôt (bus `trackInput` : progression puis « N tickets à valider »).
 *   Échec : « L'analyse du mail a échoué », Réessayer relance ce mail.
 * - Ignorer : le mail n'est plus proposé, rien n'est envoyé.
 * - Relance unique (décision de Maël, détail dans ./gmailPending.ts) : un mail resté sans réponse est relancé une
 *   fois, regroupé (« 2 mails clients pas encore traités »), au premier moment calme ; « Voir » les repropose un
 *   par un, puis ils sont oubliés. Le coordinateur ne dit pas ce que devient une notification : une notification
 *   suivie est « partie » quand elle a été affichée puis ne l'est plus, ou quand l'île est au repos (rien
 *   d'affiché, donc file vide) sans qu'elle ait été affichée (regroupée dans « N nouveautés »).
 * - Jeton refusé par Google : connexion marquée perdue et « Reconnecte Gmail », une fois par perte. 401 de Gmail :
 *   un nouveau jeton, puis abandon jusqu'au tour suivant. Erreurs réseau : silencieuses, tour suivant.
 *
 * Tout passe par `ctx.coordinator.notify` (concentration, regroupement, priorités). Jamais de jeton ni de contenu
 * de mail dans les journaux ; le stockage local ne garde que des identifiants, le client, l'objet et des dates.
 */
import { api } from '../../../../lib/api'
import {
  activeProjectOf,
  loadClientDirectory,
  normalizeEmail,
  type ClientDirectoryEntry,
} from '../../../../lib/clientDirectory'
import { googleAccessToken } from '../../../../lib/desktop'
import {
  GmailApiError,
  buildSenderQueries,
  getAttachmentBytes,
  getMessageMetadata,
  listMessageIds,
  readMailContent,
  type GmailMessageMeta,
  type MailAttachment,
  type MailContent,
} from '../../../../lib/gmail'
import {
  markGoogleConnectionLost,
  readGoogleConnection,
  saveGmailCursor,
  type GoogleAccountConnection,
} from '../../../../lib/google'
import { supabase } from '../../../../lib/supabase'
import type { CreateWrittenInputRequest } from '../../../../shared/api-contract'
import type { GoogleAccess } from '../../../../shared/desktop-contract'
import { DOCUMENT_TEXT_MAX_LENGTH, documentKind, extractDocumentText } from '../../../inputs/documentText'
import { createNotification } from '../../catalog'
import type { TimerId } from '../../coordinator/clock'
import type { IslandNotification } from '../../types'
import { errorMessage, estimateUploadMs } from '../callFlow'
import type { IslandSource } from '../source'
import {
  islandIsIdle,
  isCalmMoment,
  parsePending,
  pendingStorageKey,
  reminderCandidates,
  reminderParams,
  serializePending,
  type PendingMail,
} from './gmailPending'

/** Relecture de la ligne du compte (et occasion de vérifier le moment calme). */
export const CONNECTION_CHECK_MS = 60_000
/** Relève des mails. */
export const POLL_MS = 4 * 60_000
/** Recul maximal après des erreurs répétées. */
export const POLL_MAX_DELAY_MS = 30 * 60_000
/** L'île doit rester au repos ce temps pour compter (la file repart 450 ms après une notification). */
export const IDLE_CONFIRM_MS = 1000
/** Messages dont on lit les en-têtes à chaque relève, au plus. */
export const METADATA_MAX_PER_POLL = 50
/** Pièce jointe lue au plus de cette taille. */
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024
export const MAIL_PROGRESS_ID = 'prog:mail'
export const MAIL_PROGRESS_LABEL = 'Lecture du mail'

export interface GmailSourceDeps {
  readGmailConnection: () => Promise<GoogleAccountConnection | null>
  /** Jeton d'accès Gmail (Rust). Rejet : erreur réseau ou de Rust. */
  googleAccessToken: (refreshToken: string, forceRefresh: boolean) => Promise<GoogleAccess>
  markGmailLost: () => Promise<void>
  saveGmailCursor: (at: Date) => Promise<void>
  loadClientDirectory: () => Promise<ClientDirectoryEntry[]>
  listMessageIds: (accessToken: string, query: string) => Promise<string[]>
  getMessageMetadata: (accessToken: string, id: string) => Promise<GmailMessageMeta | null>
  readMailContent: (accessToken: string, id: string) => Promise<MailContent>
  getAttachmentBytes: (accessToken: string, gmailId: string, attachment: MailAttachment) => Promise<Uint8Array<ArrayBuffer>>
  /** Texte d'un PDF ou d'un Word (rejet : illisible, vide, trop long). */
  extractDocumentText: (file: File) => Promise<string>
  /** Message-ID déjà présents dans `inputs.external_ref` de l'organisation. */
  findAnalyzedRefs: (refs: readonly string[]) => Promise<Set<string>>
  createInput: (body: CreateWrittenInputRequest) => Promise<{ id: string }>
  readStorage: (key: string) => string | null
  writeStorage: (key: string, value: string | null) => void
  /** Heure locale (0-23) de cet instant ; par défaut celle du système. */
  localHour?: (ms: number) => number
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Délai avant la relève suivante après `failures` échecs de suite (0 : normal). */
export function pollDelayMs(failures: number): number {
  if (failures <= 0) return POLL_MS
  return Math.min(POLL_MAX_DELAY_MS, POLL_MS * 2 ** (failures - 1))
}

/** Emails surveillés → client : contacts des clients qui ont un projet en cours, sauf mon adresse. */
export function targetEmails(
  directory: readonly ClientDirectoryEntry[],
  account: string | null,
): Map<string, { client: ClientDirectoryEntry; projectId: string }> {
  const mine = normalizeEmail(account)
  const targets = new Map<string, { client: ClientDirectoryEntry; projectId: string }>()
  for (const client of directory) {
    const project = activeProjectOf(client)
    if (!project) continue
    for (const email of client.emails) {
      if (email !== mine && !targets.has(email)) targets.set(email, { client, projectId: project.id })
    }
  }
  return targets
}

/** Pièces jointes lues pour l'analyse : PDF et Word, de taille raisonnable. */
export function analyzableAttachments(attachments: readonly MailAttachment[]): MailAttachment[] {
  return attachments.filter((a) => {
    const kind = documentKind(a.filename, a.mimeType)
    return (kind === 'pdf' || kind === 'docx') && a.size <= ATTACHMENT_MAX_BYTES
  })
}

/** « mardi 24 novembre 2026 à 18:02 » (fuseau du système, sauf `timeZone`). */
export function formatMailDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(ms)
}

/** Titre de l'entrée : l'objet, sinon « Mail de <client> ». */
export function mailTitle(subject: string, clientName: string): string {
  return (subject.trim() || `Mail de ${clientName}`).slice(0, 200)
}

/** Texte de l'entrée écrite : expéditeur et date, objet, corps, une section par pièce jointe ; coupé à `maxLength`. */
export function buildMailInputText(
  mail: {
    fromName: string | null
    fromEmail: string | null
    fallbackName: string
    date: number
    subject: string
    body: string
    attachments: readonly { filename: string; text: string }[]
  },
  options: { maxLength?: number; timeZone?: string } = {},
): string {
  const maxLength = options.maxLength ?? DOCUMENT_TEXT_MAX_LENGTH
  const sender =
    mail.fromEmail && mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : (mail.fromEmail ?? mail.fallbackName)
  const sections = [
    `Mail de ${sender}, le ${formatMailDate(mail.date, options.timeZone)}\nObjet : ${mail.subject.trim() || '(sans objet)'}`,
    mail.body.trim(),
    ...mail.attachments.map((a) => `Pièce jointe : ${a.filename}\n\n${a.text.trim()}`),
  ].filter((section) => section !== '')
  const text = sections.join('\n\n')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`
}

/** Réponse 409 de l'API (entrée déjà créée pour ce Message-ID). */
export function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 409
}

/** « Ce mail est déjà analysé » : notification courte, sans bouton (sorte uploadError, ton info). */
export function alreadyAnalyzedNotification(): IslandNotification {
  const base = createNotification('uploadError', {
    title: 'Ce mail est déjà analysé',
    message: 'Ses tickets sont dans le projet',
  })
  return { ...base, tone: 'info', button: null, action: { type: 'dismiss' } }
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/** Plus de jeton (refusé ou pas de connexion) : la relève s'arrête jusqu'au tour suivant. */
class GmailUnavailable extends Error {}

interface Run {
  stop: () => void
  analyze: (messageId: string) => void
  ignore: (messageId: string) => void
  showPending: () => void
  retry: (notificationId: string) => void
}

export function createGmailSource(deps: GmailSourceDeps): IslandSource {
  const hourOf = deps.localHour ?? ((ms: number) => new Date(ms).getHours())

  return {
    id: 'gmail',
    start(ctx) {
      const { clock, coordinator } = ctx

      // -----------------------------------------------------------------------
      // Notifications suivies : partie = affichée puis plus affichée, ou île au repos sans l'avoir affichée.
      // -----------------------------------------------------------------------

      const watches = new Map<string, { displayed: boolean; onGone: () => void }>()
      let idleTimer: TimerId | null = null

      function finishWatch(id: string): void {
        const watch = watches.get(id)
        if (!watch) return
        watches.delete(id)
        // Après le reste du clic : runAction ferme la notification puis exécute l'action, dans le même tour.
        void Promise.resolve().then(() => {
          if (!ctx.isDisposed()) watch.onGone()
        })
      }

      function scheduleIdleCheck(): void {
        if (watches.size === 0 || !islandIsIdle(coordinator.getSnapshot())) {
          if (idleTimer !== null) clock.clearTimeout(idleTimer)
          idleTimer = null
          return
        }
        if (idleTimer !== null) return
        idleTimer = clock.setTimeout(() => {
          idleTimer = null
          if (!islandIsIdle(coordinator.getSnapshot())) return
          for (const [id, watch] of [...watches]) if (!watch.displayed) finishWatch(id)
        }, IDLE_CONFIRM_MS)
      }

      function onSnapshot(): void {
        const shown = coordinator.getSnapshot().notification?.id ?? null
        for (const [id, watch] of [...watches]) {
          if (shown === id) watch.displayed = true
          else if (watch.displayed) finishWatch(id)
        }
        scheduleIdleCheck()
      }

      function notifyWatched(notification: IslandNotification, onGone: () => void): void {
        watches.set(notification.id, { displayed: false, onGone })
        coordinator.notify(notification)
        onSnapshot()
      }

      const stopSnapshot = coordinator.subscribe(onSnapshot)

      // -----------------------------------------------------------------------
      // Suivi pour un compte
      // -----------------------------------------------------------------------

      function startRun(userId: string): Run {
        let stopped = false
        let tickTimer: TimerId | null = null
        let calmTimer: TimerId | null = null
        /** Dernière ligne lue (undefined : pas encore lue). */
        let row: GoogleAccountConnection | null | undefined
        let lostNotified = false
        let polling = false
        let failures = 0
        let nextPollAt = clock.now()
        const storageKey = pendingStorageKey(userId)
        /** Mails proposés sans réponse (relance), gardés en localStorage. */
        let pending: PendingMail[] = parsePending(safeRead(storageKey))
        /** Mails connus de cette session (Analyser après une relance ou un redémarrage). */
        const known = new Map<string, PendingMail>(pending.map((m) => [m.messageId, m]))
        /** Message-ID traités, ignorés ou oubliés dans cette session : plus jamais proposés. */
        const handled = new Set<string>()
        /** En-têtes déjà lus dans cette session (ids Gmail). */
        const seenIds = new Set<string>()
        const analyzing = new Set<string>()
        let reminder: { notificationId: string; messageIds: string[] } | null = null
        let replay: { queue: string[]; current: { messageId: string; notificationId: string } | null } | null = null
        let failedAnalysis: { messageId: string; notificationId: string } | null = null

        const alive = () => !stopped && !ctx.isDisposed()

        function safeRead(key: string): string | null {
          try {
            return deps.readStorage(key)
          } catch {
            return null
          }
        }

        function persist(): void {
          try {
            deps.writeStorage(storageKey, serializePending(pending))
          } catch {
            // Stockage indisponible : la relance marche encore tant que la fenêtre reste ouverte.
          }
        }

        /** Le mail ne sera plus proposé ni relancé. */
        function forget(messageId: string): void {
          handled.add(messageId)
          const before = pending.length
          pending = pending.filter((m) => m.messageId !== messageId)
          if (pending.length !== before) persist()
        }

        // ---------------------------------------------------------------------
        // Connexion et jeton
        // ---------------------------------------------------------------------

        function notifyIfLost(current: GoogleAccountConnection | null): void {
          if (!current || current.refreshToken) {
            lostNotified = false
            return
          }
          if (lostNotified) return
          lostNotified = true
          coordinator.notify(createNotification('googleReconnect', { service: 'gmail' }))
        }

        async function onRefused(): Promise<void> {
          console.warn("[île] Gmail refuse le jeton du compte : à reconnecter")
          try {
            await deps.markGmailLost()
          } catch (e) {
            console.warn("[île] perte d'accès Gmail non enregistrée :", errorMessage(e, 'erreur inconnue'))
          }
          if (!alive()) return
          if (row) row = { ...row, refreshToken: null }
          notifyIfLost(row ?? null)
        }

        async function accessToken(forceRefresh = false): Promise<string> {
          const refreshToken = row?.refreshToken
          if (!refreshToken) throw new GmailUnavailable()
          const access = await deps.googleAccessToken(refreshToken, forceRefresh)
          if (access.status === 'refused') {
            await onRefused()
            throw new GmailUnavailable()
          }
          return access.accessToken
        }

        /** Appel Gmail avec un jeton ; 401 : un jeton renouvelé (forceRefresh) et un seul nouvel essai. */
        async function withGmail<T>(run: (token: string) => Promise<T>): Promise<T> {
          const token = await accessToken()
          try {
            return await run(token)
          } catch (e) {
            if (!(e instanceof GmailApiError) || !e.unauthorized || !alive()) throw e
            return await run(await accessToken(true))
          }
        }

        async function readRow(): Promise<void> {
          let fresh: GoogleAccountConnection | null
          try {
            fresh = await deps.readGmailConnection()
          } catch (e) {
            console.warn('[île] connexion Gmail illisible :', errorMessage(e, 'erreur inconnue'))
            return
          }
          if (!alive()) return
          row = fresh
          notifyIfLost(fresh)
        }

        // ---------------------------------------------------------------------
        // Relève
        // ---------------------------------------------------------------------

        async function poll(): Promise<void> {
          const current = row
          if (!current?.refreshToken) return
          const afterMs = Date.parse(current.cursorAt ?? current.createdAt)
          if (!Number.isFinite(afterMs)) return
          const directory = await deps.loadClientDirectory()
          if (!alive()) return
          const targets = targetEmails(directory, current.account)
          const queries = buildSenderQueries([...targets.keys()], afterMs)
          if (queries.length === 0) return
          const mine = normalizeEmail(current.account)

          const metas = new Map<string, GmailMessageMeta | null>()
          await withGmail(async (token) => {
            const ids: string[] = []
            for (const query of queries) {
              for (const id of await deps.listMessageIds(token, query)) if (!ids.includes(id)) ids.push(id)
              if (!alive()) return
            }
            const fresh = ids.filter((id) => !seenIds.has(id)).slice(0, METADATA_MAX_PER_POLL)
            for (const id of fresh) {
              if (metas.has(id)) continue
              metas.set(id, await deps.getMessageMetadata(token, id))
              if (!alive()) return
            }
          })
          if (!alive()) return

          const proposedIds = new Set(pending.map((m) => m.messageId))
          const batch = new Map<string, { meta: GmailMessageMeta; client: ClientDirectoryEntry; projectId: string }>()
          for (const meta of metas.values()) {
            const email = meta?.from?.email
            const target = email ? targets.get(email) : undefined
            if (!meta || !email || !target || email === mine || meta.date <= afterMs) continue
            if (handled.has(meta.messageId) || known.has(meta.messageId) || proposedIds.has(meta.messageId)) continue
            if (meta.labelIds.some((l) => l === 'SENT' || l === 'DRAFT' || l === 'SPAM' || l === 'TRASH')) continue
            if (!batch.has(meta.messageId)) batch.set(meta.messageId, { meta, ...target })
          }

          const analyzed = batch.size > 0 ? await deps.findAnalyzedRefs([...batch.keys()]) : new Set<string>()
          if (!alive()) return
          for (const id of metas.keys()) seenIds.add(id)

          let newest = 0
          const toPropose = [...batch.values()].sort((a, b) => a.meta.date - b.meta.date)
          for (const { meta, client, projectId } of toPropose) {
            newest = Math.max(newest, meta.date)
            if (analyzed.has(meta.messageId)) {
              handled.add(meta.messageId)
              continue
            }
            const mail: PendingMail = {
              messageId: meta.messageId,
              gmailId: meta.id,
              clientId: client.clientId,
              clientName: client.clientName,
              projectId,
              subject: meta.subject,
              receivedAt: meta.date,
              proposedAt: clock.now(),
              stage: 'proposed',
            }
            pending.push(mail)
            known.set(mail.messageId, mail)
            coordinator.notify(
              createNotification('mailFeedback', { clientName: mail.clientName, subject: mail.subject, messageId: mail.messageId }),
            )
          }
          if (toPropose.length > 0) persist()

          if (newest > afterMs) {
            try {
              await deps.saveGmailCursor(new Date(newest))
              if (alive() && row) row = { ...row, cursorAt: new Date(newest).toISOString() }
            } catch (e) {
              // Pas grave : la session écarte déjà ces mails, le prochain tour réessaiera.
              console.warn('[île] curseur Gmail non enregistré :', errorMessage(e, 'erreur inconnue'))
            }
          }
        }

        async function runPoll(): Promise<void> {
          if (polling || !row?.refreshToken) return
          polling = true
          try {
            await poll()
            failures = 0
          } catch (e) {
            if (e instanceof GmailUnavailable) {
              failures = 0
            } else if (e instanceof GmailApiError && e.unauthorized) {
              // Deux refus de suite : on attend le tour suivant.
              failures = 0
              console.warn('[île] Gmail refuse le jeton d’accès, nouvel essai au prochain tour')
            } else {
              failures += 1
              const status = e instanceof GmailApiError ? ` (${e.status})` : ''
              console.warn(`[île] relève Gmail impossible${status}, nouvel essai plus tard`)
            }
          } finally {
            polling = false
            nextPollAt = clock.now() + pollDelayMs(failures)
          }
        }

        // ---------------------------------------------------------------------
        // Relance
        // ---------------------------------------------------------------------

        function calmNow(): boolean {
          return isCalmMoment(coordinator.getSnapshot(), ctx.view.get().sessions, hourOf(clock.now()))
        }

        function checkReminder(): void {
          if (reminder || replay || calmTimer !== null) return
          if (reminderCandidates(pending, clock.now()).length === 0 || !calmNow()) return
          calmTimer = clock.setTimeout(() => {
            calmTimer = null
            if (!alive() || reminder || replay || !calmNow()) return
            const mails = reminderCandidates(pending, clock.now())
            if (mails.length > 0) sendReminder(mails)
          }, IDLE_CONFIRM_MS)
        }

        function sendReminder(mails: PendingMail[]): void {
          const ids = new Set(mails.map((m) => m.messageId))
          pending = pending.map((m) => (ids.has(m.messageId) ? { ...m, stage: 'reminded' } : m))
          persist()
          const notification = createNotification('mailReminder', reminderParams(mails))
          const current = { notificationId: notification.id, messageIds: mails.map((m) => m.messageId) }
          reminder = current
          notifyWatched(notification, () => {
            // Partie sans « Voir » : une seule relance, les mails sont oubliés.
            if (reminder !== current) return
            reminder = null
            for (const id of current.messageIds) forget(id)
          })
        }

        function showPending(): void {
          const current = reminder
          if (!current) return
          reminder = null
          const ids = current.messageIds.filter((id) => pending.some((m) => m.messageId === id))
          pending = pending.map((m) => (ids.includes(m.messageId) ? { ...m, stage: 'replay' } : m))
          persist()
          replay = { queue: ids, current: null }
          showNextReplay()
        }

        function showNextReplay(): void {
          const state = replay
          if (!state || !alive()) return
          for (;;) {
            const id = state.queue.shift()
            if (id === undefined) {
              replay = null
              return
            }
            const mail = pending.find((m) => m.messageId === id && m.stage === 'replay')
            if (!mail) continue
            const notification = createNotification('mailFeedback', {
              clientName: mail.clientName,
              subject: mail.subject,
              messageId: mail.messageId,
            })
            state.current = { messageId: id, notificationId: notification.id }
            notifyWatched(notification, () => {
              if (replay !== state || state.current?.notificationId !== notification.id) return
              // Traité ou parti : oublié (pas de nouvelle relance), puis le suivant.
              forget(id)
              state.current = null
              showNextReplay()
            })
            return
          }
        }

        // ---------------------------------------------------------------------
        // Analyser, Ignorer
        // ---------------------------------------------------------------------

        function showProgress(): void {
          if (coordinator.getActivity(MAIL_PROGRESS_ID)) return
          coordinator.addActivity({
            id: MAIL_PROGRESS_ID,
            kind: 'progress',
            stage: 'upload',
            label: MAIL_PROGRESS_LABEL,
            fraction: null,
            startedAt: clock.now(),
            estimatedMs: estimateUploadMs(null),
            inputId: null,
          })
        }

        async function readForAnalysis(token: string, mail: PendingMail): Promise<{ content: MailContent; files: { filename: string; text: string }[] }> {
          const content = await deps.readMailContent(token, mail.gmailId)
          const files: { filename: string; text: string }[] = []
          for (const attachment of analyzableAttachments(content.attachments)) {
            try {
              const bytes = await deps.getAttachmentBytes(token, mail.gmailId, attachment)
              const file = new File([bytes], attachment.filename, { type: attachment.mimeType })
              files.push({ filename: attachment.filename, text: await deps.extractDocumentText(file) })
            } catch (e) {
              // Pièce jointe illisible : on la saute, le reste du mail part quand même.
              if (e instanceof GmailApiError && e.unauthorized) throw e
              console.warn('[île] pièce jointe de mail sautée')
            }
            if (!alive()) break
          }
          return { content, files }
        }

        async function analyze(messageId: string): Promise<void> {
          const mail = known.get(messageId)
          forget(messageId)
          if (!mail || analyzing.has(messageId)) return
          analyzing.add(messageId)
          if (failedAnalysis?.messageId === messageId) failedAnalysis = null
          showProgress()
          try {
            const { content, files } = await withGmail((token) => readForAnalysis(token, mail))
            if (!alive()) return
            const rawText = buildMailInputText({
              fromName: content.meta.from?.name ?? null,
              fromEmail: content.meta.from?.email ?? null,
              fallbackName: mail.clientName,
              date: content.meta.date,
              subject: content.meta.subject,
              body: content.body,
              attachments: files,
            })
            const input = await deps.createInput({
              projectId: mail.projectId,
              kind: 'written',
              title: mailTitle(content.meta.subject, mail.clientName),
              rawText,
              externalRef: messageId,
            })
            if (!alive()) return
            coordinator.removeActivity(MAIL_PROGRESS_ID)
            ctx.bus.emit('trackInput', { inputId: input.id, durationSecs: null })
          } catch (e) {
            if (!alive()) return
            coordinator.removeActivity(MAIL_PROGRESS_ID)
            // Jeton refusé : « Reconnecte Gmail » est déjà parti.
            if (e instanceof GmailUnavailable) return
            if (isConflict(e)) {
              coordinator.notify(alreadyAnalyzedNotification())
              return
            }
            console.warn("[île] analyse d'un mail impossible :", e instanceof GmailApiError ? e.status : 'API')
            const notification = createNotification('uploadError', {
              title: "L'analyse du mail a échoué",
              message: errorMessage(e, 'Une erreur est survenue. Réessaie.'),
            })
            failedAnalysis = { messageId, notificationId: notification.id }
            coordinator.notify(notification)
          } finally {
            analyzing.delete(messageId)
          }
        }

        // ---------------------------------------------------------------------
        // Tours
        // ---------------------------------------------------------------------

        async function tick(): Promise<void> {
          await readRow()
          if (!alive()) return
          if (clock.now() >= nextPollAt) await runPoll()
          if (alive()) checkReminder()
        }

        function scheduleTick(): void {
          tickTimer = clock.setTimeout(() => {
            tickTimer = null
            void tick().finally(() => {
              if (alive()) scheduleTick()
            })
          }, CONNECTION_CHECK_MS)
        }

        void tick().finally(() => {
          if (alive()) scheduleTick()
        })

        return {
          stop() {
            stopped = true
            if (tickTimer !== null) clock.clearTimeout(tickTimer)
            if (calmTimer !== null) clock.clearTimeout(calmTimer)
            tickTimer = null
            calmTimer = null
            reminder = null
            replay = null
          },
          analyze: (messageId) => void analyze(messageId),
          ignore: (messageId) => forget(messageId),
          showPending,
          retry(notificationId) {
            const failed = failedAnalysis
            if (!failed || failed.notificationId !== notificationId) return
            failedAnalysis = null
            void analyze(failed.messageId)
          },
        }
      }

      let run: Run | null = null
      let runUser: string | null = null

      function refresh(): void {
        if (ctx.isDisposed()) return
        const session = ctx.session.get()
        if (session.status === 'loading') return
        const user = session.status === 'signedIn' ? session.userId : null
        if (run && runUser !== user) {
          run.stop()
          run = null
          runUser = null
        }
        if (user && !run) {
          runUser = user
          run = startRun(user)
        }
      }

      const stopSession = ctx.session.subscribe(refresh)
      refresh()

      return {
        dispose() {
          stopSession()
          stopSnapshot()
          if (idleTimer !== null) clock.clearTimeout(idleTimer)
          idleTimer = null
          watches.clear()
          run?.stop()
          run = null
          runUser = null
        },
        actions: {
          analyzeMail: (action) => run?.analyze(action.messageId),
          ignoreMail: (action) => run?.ignore(action.messageId),
          showPendingMails: () => run?.showPending(),
          // La zone de dépôt et l'envoi prennent aussi cette action : on ne reprend que notre échec.
          retryUpload: (_action, notification) => run?.retry(notification.id),
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels
// ---------------------------------------------------------------------------

/** Message-ID par groupes (URL de PostgREST courtes). */
const REFS_PER_QUERY = 20

async function findAnalyzedRefs(refs: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < refs.length; i += REFS_PER_QUERY) {
    const group = refs.slice(i, i + REFS_PER_QUERY)
    const { data, error } = await supabase.from('inputs').select('id, external_ref').in('external_ref', group)
    if (error) throw new Error('Impossible de lire les entrées.')
    for (const row of (data ?? []) as { external_ref: unknown }[]) {
      if (typeof row.external_ref === 'string') found.add(row.external_ref)
    }
  }
  return found
}

/** Accès réels, à brancher dans desktopDeps.ts / sources/index.ts. */
export const gmailDesktopDeps: GmailSourceDeps = {
  readGmailConnection: () => readGoogleConnection('gmail'),
  googleAccessToken: (refreshToken, forceRefresh) => googleAccessToken({ service: 'gmail', refreshToken, forceRefresh }),
  markGmailLost: () => markGoogleConnectionLost('gmail'),
  saveGmailCursor,
  loadClientDirectory,
  listMessageIds: (token, query) => listMessageIds(token, query),
  getMessageMetadata: (token, id) => getMessageMetadata(token, id),
  readMailContent: (token, id) => readMailContent(token, id),
  getAttachmentBytes: (token, gmailId, attachment) => getAttachmentBytes(token, gmailId, attachment),
  // unpdf et mammoth ne sont chargés qu'à la première pièce jointe (imports dynamiques de documentText.ts) ;
  // documentText.ts lui-même est déjà dans l'île (drop/logic.ts).
  extractDocumentText,
  findAnalyzedRefs,
  async createInput(body) {
    const { input } = await api.createInput(body)
    return input
  },
  readStorage(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  writeStorage(key, value) {
    try {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      // Stockage indisponible : rien à garder.
    }
  },
}
