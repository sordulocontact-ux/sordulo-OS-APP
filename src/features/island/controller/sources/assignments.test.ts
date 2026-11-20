import { describe, expect, it, vi } from 'vitest'
import { flush, setupRuntime } from '../testUtils'
import {
  BATCH_MS,
  createAssignmentsSource,
  type AssignedTaskRow,
  type AssignmentsSourceDeps,
} from './assignments'

/** Faux client Realtime : garde l'écouteur et compte les abonnements. */
function setup(options: { signedIn?: boolean } = {}) {
  let listener: ((row: AssignedTaskRow) => void) | null = null
  const unsubscribe = vi.fn(() => {
    listener = null
  })
  const subscribeAssignedTasks = vi.fn((_memberId: string, onRow: (row: AssignedTaskRow) => void) => {
    listener = onRow
    return unsubscribe
  })
  const fetchMembers = vi.fn(async () => [
    { id: 'm-2', name: 'Maël Dupont' },
    { id: 'm-3', name: 'Sacha Roy' },
  ])
  const deps: AssignmentsSourceDeps = { subscribeAssignedTasks, fetchMembers }
  const env = setupRuntime({ sources: [createAssignmentsSource(deps)], signedIn: options.signedIn })
  const emit = (row: Partial<AssignedTaskRow> = {}) =>
    listener?.({
      id: 't-1',
      project_id: 'p-1',
      title: 'Refaire le header',
      assignee_member_id: 'm-1',
      assigned_by_member_id: 'm-2',
      assigned_at: '2026-11-20T10:00:00.000Z',
      ...row,
    })
  const wait = async () => {
    env.clock.advance(BATCH_MS)
    await flush()
  }
  return { ...env, subscribeAssignedTasks, unsubscribe, fetchMembers, emit, wait, isListening: () => listener !== null }
}

describe('source « attribution »', () => {
  it('s’abonne pour mon membre une fois connecté', () => {
    const t = setup()
    expect(t.subscribeAssignedTasks).toHaveBeenCalledWith('m-1', expect.any(Function))
  })

  it('n’écoute rien hors connexion, puis s’abonne à la connexion', () => {
    const t = setup({ signedIn: false })
    expect(t.subscribeAssignedTasks).not.toHaveBeenCalled()
    t.session.set({ status: 'signedIn', userId: 'u-1', memberId: 'm-1', organizationId: 'o-1' })
    expect(t.subscribeAssignedTasks).toHaveBeenCalledTimes(1)
  })

  it('notifie « Maël t’a assigné une tâche » avec le bouton Ouvrir vers le kanban', async () => {
    const t = setup()
    t.emit()
    await t.wait()
    const n = t.snap().notification
    expect(n?.title).toBe('Maël t\'a assigné une tâche')
    expect(n?.subtitle).toBe('Refaire le header')
    expect(n?.action).toEqual({ type: 'openMain', route: '/projects/p-1/tasks' })
  })

  it('ignore une attribution sans auteur, par moi-même ou sans date', async () => {
    const t = setup()
    t.emit({ assigned_by_member_id: null })
    t.emit({ id: 't-2', assigned_by_member_id: 'm-1' })
    t.emit({ id: 't-3', assigned_at: null })
    await t.wait()
    expect(t.snap().notification).toBeNull()
  })

  it('ne renotifie pas une mise à jour de la même attribution', async () => {
    const t = setup()
    t.emit()
    await t.wait()
    t.coordinator.endNotification()
    t.emit() // statut modifié : même tâche, même assigned_at
    await t.wait()
    expect(t.snap().notification).toBeNull()
    t.emit({ assigned_at: '2026-11-20T11:00:00.000Z' }) // nouvelle attribution
    await t.wait()
    expect(t.snap().notification).not.toBeNull()
  })

  it('regroupe les attributions d’un même auteur en une notification', async () => {
    const t = setup()
    t.emit({ id: 't-1', title: 'Header' })
    t.emit({ id: 't-2', title: 'Footer' })
    t.emit({ id: 't-3', title: 'Menu' })
    await t.wait()
    const n = t.snap().notification
    expect(n?.title).toBe('Maël t\'a assigné 3 tâches')
    expect(n?.subtitle).toBe('Header et 2 autres')
  })

  it('une notification par auteur', async () => {
    const t = setup()
    t.emit({ id: 't-1' })
    t.emit({ id: 't-2', assigned_by_member_id: 'm-3' })
    await t.wait()
    const titles = [t.snap().notification?.title]
    t.coordinator.endNotification()
    t.clock.advance(2000)
    titles.push(t.snap().notification?.title)
    expect(titles.sort()).toEqual(["Maël t'a assigné une tâche", "Sacha t'a assigné une tâche"])
  })

  it('se désabonne à la déconnexion et au dispose', () => {
    const t = setup()
    t.session.set({ status: 'signedOut', userId: null, memberId: null, organizationId: null })
    expect(t.unsubscribe).toHaveBeenCalledTimes(1)
    expect(t.isListening()).toBe(false)

    const u = setup()
    u.runtime.dispose()
    expect(u.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('ne notifie plus après la déconnexion même si un envoi était en attente', async () => {
    const t = setup()
    t.emit()
    t.session.set({ status: 'signedOut', userId: null, memberId: null, organizationId: null })
    await t.wait()
    expect(t.snap().notification).toBeNull()
  })
})
