import { describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../../../shared/types'
import { SAMPLE_APP_NOTIFICATIONS, sampleAppNotification } from '../../drop/filingFixtures'
import { SIGNED_OUT } from '../source'
import { SIGNED_IN, flush, setupRuntime } from '../testUtils'
import { createAppNotificationsSource, type AppNotificationsSourceDeps } from './appNotifications'

function setup(options: { signedIn?: boolean } = {}) {
  let onRow: ((row: AppNotification) => void) | null = null
  const unsubscribe = vi.fn()
  const deps = {
    subscribeNotifications: vi.fn((_memberId: string, handler: (row: AppNotification) => void) => {
      onRow = handler
      return unsubscribe
    }),
    markRead: vi.fn(async () => {}),
    applyProposal: vi.fn(async () => {}),
    refuseProposal: vi.fn(async () => {}),
    undoProposal: vi.fn(async () => {}),
    openMain: vi.fn(),
    isTrackedInput: vi.fn(() => false),
  } satisfies AppNotificationsSourceDeps
  const env = setupRuntime({ sources: [createAppNotificationsSource(deps)], signedIn: options.signedIn })
  return {
    ...env,
    deps,
    unsubscribe,
    insert: (row: AppNotification) => onRow?.(row),
    press: () => {
      const notification = env.coordinator.getSnapshot().notification
      if (!notification) throw new Error('aucune notification affichée')
      env.runtime.runAction(notification)
    },
    choose: (decision: 'primary' | 'secondary' | 'dismiss', always = false) => {
      const choice = env.coordinator.getSnapshot().choice
      if (!choice) throw new Error('aucune décision affichée')
      env.runtime.gestures.onChoiceDecision(decision, choice, always)
    },
  }
}

describe('source « notifications »', () => {
  it('s’abonne à mes notifications une fois connecté, se désabonne à la déconnexion', () => {
    const t = setup({ signedIn: false })
    expect(t.deps.subscribeNotifications).not.toHaveBeenCalled()
    t.session.set(SIGNED_IN)
    expect(t.deps.subscribeNotifications).toHaveBeenCalledWith('m-1', expect.any(Function))
    t.session.set(SIGNED_OUT)
    expect(t.unsubscribe).toHaveBeenCalled()
  })

  it('passage de main : notification ; clic → marquée lue et app ouverte sur son lien', async () => {
    const t = setup()
    t.insert(SAMPLE_APP_NOTIFICATIONS['prospect.created']!)
    expect(t.snap().notification).toMatchObject({ title: 'Gabi a ajouté un site : Boulangerie Lemoine', button: 'Voir' })
    t.press()
    await flush()
    expect(t.deps.markRead).toHaveBeenCalledWith('n-1')
    expect(t.deps.openMain).toHaveBeenCalledWith('/prospects/pr-1')
  })

  it('une même notification n’est montrée qu’une fois ; les attributions sont ignorées', () => {
    const t = setup()
    t.insert(sampleAppNotification({ kind: 'task.assigned', title: 'Maël t’a assigné une tâche' }))
    expect(t.snap().state).toBe('repos')
    t.insert(SAMPLE_APP_NOTIFICATIONS['recap.weekly']!)
    const shown = t.snap().notification
    t.coordinator.endNotification()
    t.clock.advance(450)
    t.insert(SAMPLE_APP_NOTIFICATIONS['recap.weekly']!)
    expect(t.snap().notification).toBeNull()
    expect(shown?.title).toBe('Récap de la semaine')
  })

  it('pas de doublon avec les lots de rangement de cette île ni les entrées qu’elle suit', () => {
    const t = setup()
    t.runtime.bus.emit('filingBatch', { batchId: 'b-1' })
    t.runtime.bus.emit('trackInput', { inputId: 'i-9', durationSecs: null })
    t.insert(sampleAppNotification({ id: 'n-f', kind: 'file.ready', payload: { intake_id: 'in-1', batch_id: 'b-1', source: 'island' } }))
    t.insert(SAMPLE_APP_NOTIFICATIONS['input.ready']!)
    expect(t.snap().state).toBe('repos')
  })

  it('entrée suivie avant le redémarrage (gardée sur l’ordinateur) : ignorée aussi', () => {
    const t = setup()
    t.deps.isTrackedInput.mockReturnValue(true)
    t.insert(SAMPLE_APP_NOTIFICATIONS['input.ready']!)
    expect(t.snap().state).toBe('repos')
  })

  it('proposition de l’IA : Valider + Toujours appelle apply_ai_proposal, marque lue, puis Annuler', async () => {
    const t = setup()
    t.insert(SAMPLE_APP_NOTIFICATIONS['proposal.created']!)
    expect(t.snap().choice).toMatchObject({ id: 'proposal:ap-1', primary: 'Valider', secondary: 'Refuser' })
    t.choose('primary', true)
    await flush()
    expect(t.deps.applyProposal).toHaveBeenCalledWith('ap-1', true)
    expect(t.deps.markRead).toHaveBeenCalledWith('n-4')
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({ title: 'Proposition appliquée', button: 'Annuler' })
    t.press()
    await flush()
    expect(t.deps.undoProposal).toHaveBeenCalledWith('ap-1')
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({ title: 'Proposition annulée' })
  })

  it('proposition : Refuser appelle refuse_ai_proposal ; Échap la laisse non lue', async () => {
    const t = setup()
    t.insert(SAMPLE_APP_NOTIFICATIONS['proposal.created']!)
    t.choose('secondary')
    await flush()
    expect(t.deps.refuseProposal).toHaveBeenCalledWith('ap-1')
    expect(t.deps.markRead).toHaveBeenCalledWith('n-4')

    const u = setup()
    u.insert(SAMPLE_APP_NOTIFICATIONS['proposal.created']!)
    u.choose('dismiss')
    await flush()
    expect(u.snap().choice).toBeNull()
    expect(u.deps.markRead).not.toHaveBeenCalled()
    expect(u.deps.applyProposal).not.toHaveBeenCalled()
  })

  it('proposition : échec de la RPC → notification d’erreur, non marquée lue', async () => {
    const t = setup()
    t.deps.applyProposal.mockRejectedValueOnce(new Error('Proposition déjà décidée'))
    t.insert(SAMPLE_APP_NOTIFICATIONS['proposal.created']!)
    t.choose('primary')
    await flush()
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({ title: 'La proposition n’a pas été appliquée', subtitle: 'Proposition déjà décidée' })
    expect(t.deps.markRead).not.toHaveBeenCalled()
  })

  it('proposition appliquée seule : Annuler appelle undo_ai_proposal et marque lue', async () => {
    const t = setup()
    t.insert(SAMPLE_APP_NOTIFICATIONS['proposal.auto_applied']!)
    t.press()
    await flush()
    expect(t.deps.undoProposal).toHaveBeenCalledWith('ap-2')
    expect(t.deps.markRead).toHaveBeenCalledWith('n-5')
  })
})
