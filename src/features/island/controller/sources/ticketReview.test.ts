import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotification } from '../../catalog'
import type { Task, Ticket } from '../../../../shared/types'
import type { SavePlan } from '../../../review/diff'
import type { IslandReview } from '../../view/types'
import { flush, setupRuntime } from '../testUtils'
import {
  AUTO_CLOSE_MS,
  REVIEW_REFRESH_MS,
  UNDO_MS,
  createTicketReviewSource,
  nextCurrentId,
  type TicketReviewSourceDeps,
} from './ticketReview'

function ticket(id: string, minute: number, patch: Partial<Ticket> = {}): Ticket {
  return {
    id,
    organization_id: 'o-1',
    project_id: 'p-1',
    input_id: 'i-1',
    title: `Ticket ${id}`,
    description: `Description ${id}`,
    type: 'modification',
    priority: 'medium',
    source_quote: `Citation ${id}`,
    status: 'proposed',
    related_ticket_id: null,
    area: null,
    assignment_note: null,
    from_marker: false,
    created_at: `2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`,
    ...patch,
  }
}

function task(id: string, ticketId: string, position: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    organization_id: 'o-1',
    project_id: 'p-1',
    ticket_id: ticketId,
    title: `Tâche ${id}`,
    skill: 'dev',
    estimate_hours: 2,
    assignee_member_id: 'm-1',
    assigned_by_member_id: null,
    assigned_at: null,
    status: 'todo',
    depends_on_task_id: null,
    position,
    due_date: null,
    priority: 'medium',
    created_at: '2026-11-25T10:00:00.000Z',
    ...patch,
  }
}

/** Fausse base : les plans exécutés changent le statut des tickets. */
function fakeDeps(initial: { tickets?: Ticket[]; tasks?: Task[] } = {}) {
  const db = {
    tickets: initial.tickets ?? [ticket('a', 1), ticket('b', 2, { from_marker: true }), ticket('c', 3)],
    tasks: initial.tasks ?? [task('ta', 'a', 0), task('tb', 'b', 1, { assignee_member_id: 'm-2', skill: 'design' })],
  }
  let failNext: string | null = null
  const executePlan = vi.fn(async (ticketId: string, plan: SavePlan) => {
    if (failNext) {
      const message = failNext
      failNext = null
      throw new Error(message)
    }
    const status = plan.ticketPatch.status
    if (status) db.tickets = db.tickets.map((t) => (t.id === ticketId ? { ...t, status } : t))
  })
  const deps = {
    fetchReviewInput: vi.fn(async (inputId: string) =>
      inputId === 'i-1'
        ? {
            input: {
              id: 'i-1',
              project_id: 'p-1',
              organization_id: 'o-1',
              kind: 'meeting' as const,
              title: 'Point Ibé',
              raw_text: null,
              created_at: '2026-11-25T09:00:00.000Z',
            },
            projectName: 'App Ibé',
          }
        : null,
    ),
    fetchReviewTickets: vi.fn(async () => ({ tickets: db.tickets.map((t) => ({ ...t })), tasks: db.tasks.map((t) => ({ ...t })) })),
    fetchReviewMembers: vi.fn(async () => [
      { id: 'm-1', name: 'Maël Auzenet' },
      { id: 'm-2', name: 'Sacha Moricet' },
    ]),
    executePlan,
    openMainAt: vi.fn(async () => {}),
    notifyReviewChanged: vi.fn(async () => {}),
  } satisfies TicketReviewSourceDeps
  return { deps, db, failNext: (message: string) => (failNext = message) }
}

async function setup(initial?: Parameters<typeof fakeDeps>[0]) {
  const fake = fakeDeps(initial)
  const env = setupRuntime({ sources: [createTicketReviewSource(fake.deps)] })
  const hide = vi.spyOn(env.coordinator, 'hideOverlay')
  const review = () => env.runtime.view.get().review as IslandReview | null
  const act = async (action: Parameters<typeof env.runtime.gestures.onReviewAction>[0]) => {
    env.runtime.gestures.onReviewAction(action)
    await flush()
  }
  const open = async (inputId = 'i-1') => {
    const notification = createNotification('tickets', {
      count: 3,
      inputTitle: 'Point Ibé',
      projectName: 'App Ibé',
      route: '/projects/p-1/inputs/i-1/review',
      inputId,
    })
    env.runtime.runAction(notification)
    await flush()
  }
  const shown = () => {
    const r = review()
    return r ? r.tickets[r.index]?.id : undefined
  }
  return { ...env, ...fake, hide, review, act, open, shown }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('nextCurrentId', () => {
  it('prend le suivant dans l’ordre, sinon le premier', () => {
    const list = [ticket('a', 1), ticket('c', 3)]
    expect(nextCurrentId(list, ticket('b', 2))).toBe('c')
    expect(nextCurrentId(list, ticket('d', 4))).toBe('a')
    expect(nextCurrentId(list, null)).toBe('a')
    expect(nextCurrentId([], ticket('a', 1))).toBeNull()
  })
})

describe('source « validation dans l’île »', () => {
  it('« Valider ici » ouvre l’état review, en chargement puis avec les tickets proposés', async () => {
    const t = await setup({
      tickets: [ticket('a', 1), ticket('x', 2, { status: 'validated' }), ticket('b', 3, { from_marker: true })],
    })
    t.runtime.runAction(
      createNotification('tickets', { count: 2, inputTitle: 'Point Ibé', projectName: 'App Ibé', route: '/r', inputId: 'i-1' }),
    )
    expect(t.snap().state).toBe('review')
    expect(t.review()).toMatchObject({ loading: true, tickets: [] })
    await flush()
    expect(t.review()).toMatchObject({
      inputTitle: 'Point Ibé',
      projectName: 'App Ibé',
      loading: false,
      busy: false,
      error: null,
      index: 0,
      undo: null,
    })
    expect(t.review()?.tickets).toEqual([
      {
        id: 'a',
        type: 'modification',
        title: 'Ticket a',
        description: 'Description a',
        quote: 'Citation a',
        assignee: { name: 'Maël Auzenet', initials: 'MA' },
        fromMarker: false,
      },
      expect.objectContaining({ id: 'b', fromMarker: true, assignee: { name: 'Sacha Moricet', initials: 'SM' } }),
    ])
    await t.act({ type: 'close' })
    t.db.tasks = []
    await t.open()
    // Sans tâche (ou tâches à plusieurs personnes) : non attribué.
    expect(t.review()?.tickets[0]?.assignee).toBeNull()
    expect(t.deps.fetchReviewMembers).toHaveBeenCalledWith('o-1')
  })

  it('navigue en boucle avec précédent et suivant', async () => {
    const t = await setup()
    await t.open()
    expect(t.shown()).toBe('a')
    await t.act({ type: 'next' })
    expect(t.shown()).toBe('b')
    await t.act({ type: 'previous' })
    await t.act({ type: 'previous' })
    expect(t.shown()).toBe('c')
    await t.act({ type: 'next' })
    expect(t.shown()).toBe('a')
  })

  it('valide le ticket affiché comme l’écran de validation, puis passe au suivant et prévient la fenêtre principale', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'next' })
    await t.act({ type: 'validate' })
    expect(t.deps.executePlan).toHaveBeenCalledWith('b', {
      ticketPatch: { status: 'validated' },
      taskUpdates: [],
      taskInserts: [],
      taskDeletes: [],
    })
    expect(t.db.tickets.find((x) => x.id === 'b')?.status).toBe('validated')
    expect(t.review()?.tickets.map((x) => x.id)).toEqual(['a', 'c'])
    expect(t.shown()).toBe('c')
    expect(t.deps.notifyReviewChanged).toHaveBeenCalledWith({ projectId: 'p-1', inputId: 'i-1' })
  })

  it('n’enregistre pas un ticket aux champs invalides', async () => {
    const t = await setup({ tickets: [ticket('a', 1)], tasks: [task('ta', 'a', 0, { title: '  ' })] })
    await t.open()
    await t.act({ type: 'validate' })
    expect(t.deps.executePlan).not.toHaveBeenCalled()
    expect(t.review()?.error).toMatch(/champs à corriger/)
  })

  it('affiche l’erreur d’un enregistrement raté, en français', async () => {
    const t = await setup()
    await t.open()
    t.failNext('réseau indisponible')
    await t.act({ type: 'validate' })
    expect(t.review()).toMatchObject({ busy: false, error: 'Validation impossible : réseau indisponible' })
    expect(t.shown()).toBe('a')
    expect(t.deps.notifyReviewChanged).not.toHaveBeenCalled()
  })

  it('refuse, puis « Annuler » remet le ticket à sa place pendant 5 s', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'next' })
    await t.act({ type: 'reject' })
    expect(t.deps.executePlan).toHaveBeenLastCalledWith('b', expect.objectContaining({ ticketPatch: { status: 'rejected' } }))
    expect(t.review()?.undo).toEqual({ ticketTitle: 'Ticket b' })
    expect(t.shown()).toBe('c')
    t.clock.advance(UNDO_MS - 1)
    await t.act({ type: 'undo' })
    expect(t.deps.executePlan).toHaveBeenLastCalledWith('b', expect.objectContaining({ ticketPatch: { status: 'proposed' } }))
    expect(t.review()?.tickets.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(t.shown()).toBe('b')
    expect(t.review()?.undo).toBeNull()
    expect(t.deps.notifyReviewChanged).toHaveBeenCalledTimes(2)
  })

  it('l’annulation disparaît après 5 s', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'reject' })
    expect(t.review()?.undo).not.toBeNull()
    t.clock.advance(UNDO_MS)
    expect(t.review()?.undo).toBeNull()
    t.deps.executePlan.mockClear()
    await t.act({ type: 'undo' })
    expect(t.deps.executePlan).not.toHaveBeenCalled()
  })

  it('tout valider dans l’ordre, puis liste vide et fermeture automatique', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'validateAll' })
    expect(t.deps.executePlan.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(t.review()).toMatchObject({ tickets: [], loading: false, busy: false, error: null })
    expect(t.deps.notifyReviewChanged).toHaveBeenCalledTimes(1)
    t.clock.advance(AUTO_CLOSE_MS - 1)
    expect(t.snap().state).toBe('review')
    t.clock.advance(1)
    expect(t.hide).toHaveBeenCalledWith('review')
    expect(t.review()).toBeNull()
    expect(t.snap().state).not.toBe('review')
  })

  it('garde la fermeture tant qu’un refus peut être annulé', async () => {
    const t = await setup({ tickets: [ticket('a', 1)], tasks: [] })
    await t.open()
    await t.act({ type: 'reject' })
    expect(t.review()?.tickets).toEqual([])
    t.clock.advance(AUTO_CLOSE_MS)
    expect(t.review()).not.toBeNull()
    t.clock.advance(UNDO_MS - AUTO_CLOSE_MS)
    expect(t.review()).toBeNull()
  })

  it('relit les tickets toutes les 4 s : garde le ticket affiché, sinon passe au suivant', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'next' })
    // Quelqu'un valide « a » dans l'app : « b » reste affiché.
    t.db.tickets = t.db.tickets.map((x) => (x.id === 'a' ? { ...x, status: 'validated' } : x))
    t.clock.advance(REVIEW_REFRESH_MS)
    await flush()
    expect(t.review()?.tickets.map((x) => x.id)).toEqual(['b', 'c'])
    expect(t.shown()).toBe('b')
    // Puis « b » : on passe à « c ».
    t.db.tickets = t.db.tickets.map((x) => (x.id === 'b' ? { ...x, status: 'rejected' } : x))
    t.clock.advance(REVIEW_REFRESH_MS)
    await flush()
    expect(t.shown()).toBe('c')
  })

  it('« Modifier dans l’app » ouvre l’écran de validation sur ce ticket et ferme l’état', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'next' })
    await t.act({ type: 'openInApp' })
    expect(t.deps.openMainAt).toHaveBeenCalledWith('/projects/p-1/inputs/i-1/review?ticket=b')
    expect(t.review()).toBeNull()
    expect(t.hide).toHaveBeenCalledWith('review')
  })

  it('« Fermer » retire l’état et arrête la relecture', async () => {
    const t = await setup()
    await t.open()
    await t.act({ type: 'close' })
    expect(t.review()).toBeNull()
    expect(t.snap().state).not.toBe('review')
    t.deps.fetchReviewTickets.mockClear()
    t.clock.advance(REVIEW_REFRESH_MS * 3)
    await flush()
    expect(t.deps.fetchReviewTickets).not.toHaveBeenCalled()
  })

  it('signale une entrée introuvable sans fermer', async () => {
    const t = await setup()
    await t.open('i-404')
    expect(t.review()).toMatchObject({ loading: false, error: expect.stringMatching(/introuvable/) })
    t.clock.advance(AUTO_CLOSE_MS * 2)
    expect(t.review()).not.toBeNull()
  })

  it('une notification interruption passe devant puis l’île revient à la validation', async () => {
    const t = await setup()
    await t.open()
    const urgent = createNotification('rappel', { meetingTitle: 'Call Ibé', minutes: 5, appName: 'Meet', url: 'https://x' })
    t.coordinator.notify(urgent)
    expect(t.snap().state).toBe('notif')
    t.coordinator.endNotification(urgent.id)
    expect(t.snap().state).toBe('review')
    expect(t.review()?.tickets).toHaveLength(3)
  })

  it('se ferme à la déconnexion', async () => {
    const t = await setup()
    await t.open()
    t.session.set({ status: 'signedOut', userId: null, memberId: null, organizationId: null })
    expect(t.review()).toBeNull()
  })
})
