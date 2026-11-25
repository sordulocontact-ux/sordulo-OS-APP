/**
 * Source « validation dans l'île » : « Valider ici » sur « N tickets à valider » (action `reviewHere`) ouvre
 * l'état `review` de l'île, un ticket proposé à la fois.
 *
 * - Données : l'entrée (titre, projet), ses tickets dans l'ordre de l'écran de validation (création), leurs
 *   tâches et les membres de l'organisation (personne qui tient le ticket, comme ticketAssigneeOf).
 * - Gestes (`onReviewAction`) : précédent / suivant (circulaires), valider (même logique que validateOne de
 *   l'écran de validation : planSave puis executePlan), refuser, tout valider (positions cumulées), annuler le
 *   dernier refus pendant UNDO_MS, modifier dans l'app (écran de validation sur ce ticket), fermer.
 * - Mise à jour : relecture des tickets toutes les REVIEW_REFRESH_MS tant que l'état est ouvert (quelqu'un
 *   valide dans l'app en même temps) ; le ticket affiché reste s'il est encore proposé, sinon le suivant.
 * - Après chaque enregistrement, la fenêtre principale est prévenue (REVIEW_CHANGED_EVENT) et relit ses données.
 * - Plus rien à valider : liste vide (« Tous les tickets sont traités »), puis fermeture après AUTO_CLOSE_MS
 *   (ou à la fin de l'annulation possible d'un refus).
 * - L'overlay `review` de la coordination laisse passer les interruptions et revient ensuite
 *   (../../coordinator/coordinator.ts).
 */
import { emitTo } from '@tauri-apps/api/event'
import { initials } from '../../../../components/ui/initials'
import { openMainAt } from '../../../../lib/desktop'
import { supabase } from '../../../../lib/supabase'
import { DESKTOP_WINDOWS } from '../../../../shared/desktop-contract'
import type { Input, Member, Task, Ticket, TicketStatus } from '../../../../shared/types'
import { inputTitle } from '../../../inputs/inputUtils'
import { makeTicketDraft, nextPosition, planSave, ticketAssigneeOf, validateDraft, type SavePlan } from '../../../review/diff'
import { REVIEW_CHANGED_EVENT, reviewTicketRoute, type ReviewChangedPayload } from '../../../review/reviewSync'
import { executePlan } from '../../../review/save'
import type { TimerId } from '../../coordinator/clock'
import type { IslandReviewAction, IslandReviewTicket } from '../../view/types'
import type { IslandSource } from '../source'

/** Relecture des tickets pendant que l'état est ouvert (décision du ticket). */
export const REVIEW_REFRESH_MS = 4000
/** Durée pendant laquelle « Annuler » remet le dernier ticket refusé. */
export const UNDO_MS = 5000
/** Liste vide affichée avant la fermeture automatique. */
export const AUTO_CLOSE_MS = 2000

export type ReviewInputRow = Pick<Input, 'id' | 'project_id' | 'organization_id' | 'kind' | 'title' | 'raw_text' | 'created_at'>

export interface ReviewInputInfo {
  input: ReviewInputRow
  projectName: string
}

export interface ReviewTicketsData {
  /** Tous les tickets de l'entrée, les plus anciens d'abord (ordre de l'analyse et de l'écran de validation). */
  tickets: Ticket[]
  /** Tâches de ces tickets. */
  tasks: Task[]
}

export type ReviewMember = Pick<Member, 'id' | 'name'>

export interface TicketReviewSourceDeps {
  /** L'entrée et le nom de son projet ; null : introuvable ou hors de portée. */
  fetchReviewInput: (inputId: string) => Promise<ReviewInputInfo | null>
  fetchReviewTickets: (inputId: string) => Promise<ReviewTicketsData>
  fetchReviewMembers: (organizationId: string) => Promise<ReviewMember[]>
  /** review/save.ts : tâches d'abord, ticket ensuite. */
  executePlan: (ticketId: string, plan: SavePlan) => Promise<void>
  /** Fenêtre principale sur une route. */
  openMainAt: (route: string) => Promise<void>
  /** Prévient la fenêtre principale qu'elle doit relire les tickets de l'entrée. */
  notifyReviewChanged: (payload: ReviewChangedPayload) => Promise<void>
}

// ---------------------------------------------------------------------------
// Logique pure
// ---------------------------------------------------------------------------

export function proposedOf(tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter((ticket) => ticket.status === 'proposed')
}

function compareTickets(a: Pick<Ticket, 'created_at' | 'id'>, b: Pick<Ticket, 'created_at' | 'id'>): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Ticket à afficher après `after` (traité ou disparu) : le premier proposé qui le suit dans l'ordre de
 * l'écran, sinon le premier ; null s'il n'y en a plus.
 */
export function nextCurrentId(proposed: readonly Ticket[], after: Pick<Ticket, 'created_at' | 'id'> | null): string | null {
  if (after) {
    const following = proposed.find((ticket) => compareTickets(ticket, after) > 0)
    if (following) return following.id
  }
  return proposed[0]?.id ?? null
}

/** Ticket tel que l'île le montre. */
export function toIslandTicket(
  ticket: Ticket,
  tasks: readonly Task[],
  members: ReadonlyMap<string, ReviewMember>,
): IslandReviewTicket {
  const holderId = ticketAssigneeOf(makeTicketDraft(ticket, tasks))
  const holder = holderId ? members.get(holderId) : undefined
  return {
    id: ticket.id,
    type: ticket.type,
    title: ticket.title,
    description: ticket.description,
    quote: ticket.source_quote?.trim() ? ticket.source_quote : null,
    assignee: holder ? { name: holder.name, initials: initials(holder.name) } : null,
    fromMarker: ticket.from_marker === true,
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'erreur inconnue'
}

const EMPTY_PLAN: Omit<SavePlan, 'ticketPatch'> = { taskUpdates: [], taskInserts: [], taskDeletes: [] }

function statusPlan(status: TicketStatus): SavePlan {
  return { ticketPatch: { status }, ...EMPTY_PLAN }
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface ReviewSession {
  inputId: string
  projectId: string | null
  inputTitle: string
  projectName: string
  members: Map<string, ReviewMember>
  loaded: boolean
  tickets: Ticket[]
  tasks: Task[]
  currentId: string | null
  busy: boolean
  error: string | null
  undo: { ticket: Ticket; until: number; timer: TimerId } | null
  /** Change à chaque modification locale : une relecture partie avant est ignorée. */
  version: number
}

export function createTicketReviewSource(deps: TicketReviewSourceDeps): IslandSource {
  return {
    id: 'validation',
    start(ctx) {
      const { clock, coordinator, view } = ctx
      let session: ReviewSession | null = null
      let refreshTimer: TimerId | null = null
      let closeTimer: TimerId | null = null

      function tasksOf(s: ReviewSession, ticket: Ticket): Task[] {
        return s.tasks.filter((task) => task.ticket_id === ticket.id)
      }

      function currentOf(s: ReviewSession): Ticket | null {
        return proposedOf(s.tickets).find((ticket) => ticket.id === s.currentId) ?? null
      }

      function clearCloseTimer(): void {
        if (closeTimer !== null) clock.clearTimeout(closeTimer)
        closeTimer = null
      }

      function clearRefreshTimer(): void {
        if (refreshTimer !== null) clock.clearTimeout(refreshTimer)
        refreshTimer = null
      }

      function clearUndo(s: ReviewSession): void {
        if (s.undo) clock.clearTimeout(s.undo.timer)
        s.undo = null
      }

      /** Fermeture automatique quand plus rien n'est proposé (sans erreur ni enregistrement en cours). */
      function updateAutoClose(s: ReviewSession, empty: boolean): void {
        const due = s.loaded && empty && !s.busy && s.error === null
        if (!due) {
          clearCloseTimer()
          return
        }
        if (closeTimer !== null) return
        const delay = Math.max(AUTO_CLOSE_MS, s.undo ? s.undo.until - clock.now() : 0)
        closeTimer = clock.setTimeout(() => {
          closeTimer = null
          if (session === s && proposedOf(s.tickets).length === 0 && !s.busy) close()
        }, delay)
      }

      function render(): void {
        const s = session
        if (!s) {
          view.patch({ review: null })
          return
        }
        const proposed = proposedOf(s.tickets)
        const index = Math.max(0, proposed.findIndex((ticket) => ticket.id === s.currentId))
        view.patch({
          review: {
            inputTitle: s.inputTitle,
            projectName: s.projectName,
            tickets: proposed.map((ticket) => toIslandTicket(ticket, tasksOf(s, ticket), s.members)),
            index,
            loading: !s.loaded,
            busy: s.busy,
            error: s.error,
            undo: s.undo ? { ticketTitle: s.undo.ticket.title } : null,
          },
        })
        updateAutoClose(s, proposed.length === 0)
      }

      /** Nouvelles données : garde le ticket affiché s'il est encore proposé, sinon passe au suivant. */
      function applyData(s: ReviewSession, data: ReviewTicketsData): void {
        const previous = s.tickets.find((ticket) => ticket.id === s.currentId) ?? null
        s.tickets = data.tickets
        s.tasks = data.tasks
        const proposed = proposedOf(s.tickets)
        if (!proposed.some((ticket) => ticket.id === s.currentId)) s.currentId = nextCurrentId(proposed, previous)
      }

      function setStatus(s: ReviewSession, ticketId: string, status: TicketStatus): void {
        s.tickets = s.tickets.map((ticket) => (ticket.id === ticketId ? { ...ticket, status } : ticket))
        s.version += 1
      }

      function changed(s: ReviewSession): void {
        if (!s.projectId) return
        deps
          .notifyReviewChanged({ projectId: s.projectId, inputId: s.inputId })
          .catch((e: unknown) => console.warn('[île] fenêtre principale non prévenue :', e))
      }

      async function load(s: ReviewSession): Promise<void> {
        try {
          if (!(await ctx.waitForSignedIn())) {
            if (session !== s) return
            s.error = 'Connecte-toi à Sordulo OS pour valider les tickets.'
            render()
            return
          }
          const info = await deps.fetchReviewInput(s.inputId)
          if (session !== s) return
          if (!info) {
            s.loaded = true
            s.error = "Entrée introuvable, ou tu n'y as pas accès."
            render()
            return
          }
          const [data, members] = await Promise.all([
            deps.fetchReviewTickets(s.inputId),
            deps.fetchReviewMembers(info.input.organization_id),
          ])
          if (session !== s) return
          s.projectId = info.input.project_id
          s.inputTitle = inputTitle(info.input)
          s.projectName = info.projectName
          s.members = new Map(members.map((member) => [member.id, member]))
          applyData(s, data)
          s.loaded = true
          s.error = null
          s.version += 1
        } catch (e) {
          if (session !== s) return
          s.error = `Impossible de charger les tickets : ${errorText(e)}`
        }
        render()
      }

      async function refresh(): Promise<void> {
        const s = session
        if (!s) return
        if (!s.loaded || s.projectId === null) {
          await load(s)
        } else if (!s.busy) {
          const version = s.version
          try {
            const data = await deps.fetchReviewTickets(s.inputId)
            if (session === s && !s.busy && s.version === version) {
              applyData(s, data)
              render()
            }
          } catch (e) {
            // On garde l'affichage : la relecture suivante réessaie.
            console.warn('[île] relecture des tickets :', e)
          }
        }
        if (session === s) scheduleRefresh()
      }

      function scheduleRefresh(): void {
        clearRefreshTimer()
        refreshTimer = clock.setTimeout(() => {
          refreshTimer = null
          void refresh()
        }, REVIEW_REFRESH_MS)
      }

      function endSession(): void {
        if (session) clearUndo(session)
        clearRefreshTimer()
        clearCloseTimer()
        session = null
      }

      function open(inputId: string): void {
        endSession()
        const s: ReviewSession = {
          inputId,
          projectId: null,
          inputTitle: '',
          projectName: '',
          members: new Map(),
          loaded: false,
          tickets: [],
          tasks: [],
          currentId: null,
          busy: false,
          error: null,
          undo: null,
          version: 0,
        }
        session = s
        coordinator.showOverlay('review')
        render()
        scheduleRefresh()
        void load(s)
      }

      function close(): void {
        if (!session) return
        endSession()
        coordinator.hideOverlay('review')
        view.patch({ review: null })
      }

      /** Enregistrement : boutons désactivés, erreur effacée ; après coup, fenêtre principale prévenue et relecture. */
      async function save(s: ReviewSession, work: () => Promise<boolean>): Promise<void> {
        s.busy = true
        s.error = null
        s.version += 1
        render()
        let saved = false
        try {
          saved = await work()
        } finally {
          s.busy = false
          s.version += 1
          if (saved) changed(s)
          if (session === s) {
            render()
            if (saved) void refresh()
          }
        }
      }

      function validate(s: ReviewSession): Promise<void> | void {
        const ticket = currentOf(s)
        if (!ticket) return
        const tasks = tasksOf(s, ticket)
        const draft = makeTicketDraft(ticket, tasks)
        if (!validateDraft(draft).valid) {
          s.error = "Ce ticket a des champs à corriger : modifie-le dans l'app."
          render()
          return
        }
        return save(s, async () => {
          try {
            const plan = planSave(ticket, tasks, draft, { startPosition: nextPosition(s.tasks), status: 'validated' })
            await deps.executePlan(ticket.id, plan)
            setStatus(s, ticket.id, 'validated')
            s.currentId = nextCurrentId(proposedOf(s.tickets), ticket)
            return true
          } catch (e) {
            s.error = `Validation impossible : ${errorText(e)}`
            return false
          }
        })
      }

      function reject(s: ReviewSession): Promise<void> | void {
        const ticket = currentOf(s)
        if (!ticket) return
        return save(s, async () => {
          try {
            await deps.executePlan(ticket.id, statusPlan('rejected'))
            setStatus(s, ticket.id, 'rejected')
            s.currentId = nextCurrentId(proposedOf(s.tickets), ticket)
            clearUndo(s)
            const timer = clock.setTimeout(() => {
              if (s.undo?.timer !== timer) return
              s.undo = null
              if (session === s) render()
            }, UNDO_MS)
            s.undo = { ticket, until: clock.now() + UNDO_MS, timer }
            return true
          } catch (e) {
            s.error = `Refus impossible : ${errorText(e)}`
            return false
          }
        })
      }

      function undo(s: ReviewSession): Promise<void> | void {
        const pending = s.undo
        if (!pending) return
        return save(s, async () => {
          try {
            await deps.executePlan(pending.ticket.id, statusPlan('proposed'))
            if (s.undo === pending) clearUndo(s)
            if (s.tickets.some((ticket) => ticket.id === pending.ticket.id)) {
              setStatus(s, pending.ticket.id, 'proposed')
            } else {
              const restored: Ticket = { ...pending.ticket, status: 'proposed' }
              s.tickets = [...s.tickets, restored].sort(compareTickets)
              s.version += 1
            }
            s.currentId = pending.ticket.id
            return true
          } catch (e) {
            s.error = `Annulation impossible : ${errorText(e)}`
            return false
          }
        })
      }

      function validateAll(s: ReviewSession): Promise<void> | void {
        const proposed = proposedOf(s.tickets)
        if (proposed.length === 0) return
        return save(s, async () => {
          const failed: string[] = []
          let done = 0
          let position = nextPosition(s.tasks)
          for (const ticket of proposed) {
            const tasks = tasksOf(s, ticket)
            const draft = makeTicketDraft(ticket, tasks)
            if (!validateDraft(draft).valid) {
              failed.push(`${ticket.title} (champs à corriger)`)
              continue
            }
            try {
              const plan = planSave(ticket, tasks, draft, { startPosition: position, status: 'validated' })
              await deps.executePlan(ticket.id, plan)
              position += plan.taskInserts.length
              setStatus(s, ticket.id, 'validated')
              done += 1
            } catch (e) {
              failed.push(`${ticket.title} (${errorText(e)})`)
            }
          }
          s.currentId = nextCurrentId(proposedOf(s.tickets), null)
          if (failed.length > 0) {
            s.error = `${done} validé${done > 1 ? 's' : ''}, ${failed.length} en échec : ${failed.join(' ; ')}`
          }
          return done > 0
        })
      }

      function move(s: ReviewSession, step: 1 | -1): void {
        const proposed = proposedOf(s.tickets)
        if (proposed.length === 0) return
        const index = Math.max(0, proposed.findIndex((ticket) => ticket.id === s.currentId))
        const next = proposed[(index + step + proposed.length) % proposed.length]
        s.currentId = next?.id ?? null
        s.error = null
        render()
      }

      function openInApp(s: ReviewSession): void {
        const ticket = currentOf(s)
        const route = s.projectId ? reviewTicketRoute(s.projectId, s.inputId, ticket?.id) : null
        close()
        if (route) deps.openMainAt(route).catch((e: unknown) => console.warn('[île] ouverture de la validation :', e))
      }

      function onReviewAction(action: IslandReviewAction): Promise<void> | void {
        const s = session
        if (!s) return
        if (action.type === 'close') return close()
        if (s.busy) return
        switch (action.type) {
          case 'previous':
            return move(s, -1)
          case 'next':
            return move(s, 1)
          case 'openInApp':
            return openInApp(s)
        }
        if (!s.loaded) return
        switch (action.type) {
          case 'validate':
            return validate(s)
          case 'reject':
            return reject(s)
          case 'validateAll':
            return validateAll(s)
          case 'undo':
            return undo(s)
        }
      }

      // Déconnexion : l'état se ferme (plus rien n'est lisible).
      const unsubscribeSession = ctx.session.subscribe(() => {
        if (ctx.session.get().status === 'signedOut') close()
      })

      return {
        actions: {
          reviewHere: (action) => open(action.inputId),
        },
        gestures: { onReviewAction },
        dispose: () => {
          unsubscribeSession()
          endSession()
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels : createTicketReviewSource(ticketReviewDesktopDeps) dans sources/index.ts
// ---------------------------------------------------------------------------

const INPUT_COLUMNS = 'id, project_id, organization_id, kind, title, raw_text, created_at'

export const ticketReviewDesktopDeps: TicketReviewSourceDeps = {
  async fetchReviewInput(inputId) {
    const { data, error } = await supabase
      .from('inputs')
      .select(INPUT_COLUMNS)
      .eq('id', inputId)
      .limit(1)
      .overrideTypes<ReviewInputRow[], { merge: false }>()
    if (error) throw error
    const input = data[0]
    if (!input) return null
    const project = await supabase
      .from('projects')
      .select('name')
      .eq('id', input.project_id)
      .limit(1)
      .overrideTypes<{ name: string }[], { merge: false }>()
    if (project.error) throw project.error
    return { input, projectName: project.data[0]?.name ?? '' }
  },
  async fetchReviewTickets(inputId) {
    const tickets = await supabase
      .from('tickets')
      .select('*')
      .eq('input_id', inputId)
      .order('created_at', { ascending: true })
      .overrideTypes<Ticket[], { merge: false }>()
    if (tickets.error) throw tickets.error
    const ids = tickets.data.map((ticket) => ticket.id)
    if (ids.length === 0) return { tickets: tickets.data, tasks: [] }
    const tasks = await supabase
      .from('tasks')
      .select('*')
      .in('ticket_id', ids)
      .order('position', { ascending: true })
      .overrideTypes<Task[], { merge: false }>()
    if (tasks.error) throw tasks.error
    return { tickets: tickets.data, tasks: tasks.data }
  },
  async fetchReviewMembers(organizationId) {
    const { data, error } = await supabase
      .from('members')
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name')
      .overrideTypes<ReviewMember[], { merge: false }>()
    if (error) throw error
    return data
  },
  executePlan,
  openMainAt: (route) => openMainAt({ route }),
  notifyReviewChanged: (payload) => emitTo(DESKTOP_WINDOWS.main, REVIEW_CHANGED_EVENT, payload),
}
