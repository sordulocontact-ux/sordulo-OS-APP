import { describe, expect, it, vi } from 'vitest'
import { createNotification } from '../catalog'
import type { IslandSource, IslandSourceContext } from './source'
import { SIGNED_IN, flush, setupRuntime } from './testUtils'

function capture(onStart?: (ctx: IslandSourceContext) => void) {
  const box: { ctx: IslandSourceContext | null } = { ctx: null }
  const dispose = vi.fn()
  const source: IslandSource = {
    id: 'test',
    start(ctx) {
      box.ctx = ctx
      onStart?.(ctx)
      return { dispose }
    },
  }
  return { box, source, dispose }
}

describe('runtime du contrôleur', () => {
  it('ferme la notification puis confie l’action à la source qui la prend', () => {
    const retryUpload = vi.fn()
    const source: IslandSource = { id: 'envoi', start: () => ({ actions: { retryUpload } }) }
    const openMain = vi.fn()
    const { runtime, snap, clock } = setupRuntime({ sources: [source], defaultActions: { openMain, openUrl: vi.fn() } })
    const n = createNotification('uploadError', {})
    runtime.coordinator.notify(n)
    expect(snap().state).toBe('notif')
    runtime.runAction(n)
    expect(snap().state).toBe('repos')
    expect(retryUpload).toHaveBeenCalledWith({ type: 'retryUpload' }, n)
    expect(openMain).not.toHaveBeenCalled()
    clock.advance(1000)
  })

  it('par défaut : openMain ouvre la fenêtre principale, showSessions et dismiss ferment seulement', () => {
    const openMain = vi.fn()
    const { runtime } = setupRuntime({ sources: [], defaultActions: { openMain, openUrl: vi.fn() } })
    runtime.runAction(createNotification('tickets', { count: 2, inputTitle: 'Call', projectName: 'P', route: '/r' }))
    expect(openMain).toHaveBeenCalledWith('/r')
    expect(() => runtime.runAction(createNotification('claudeDone', { projectName: 'P', detail: '' }))).not.toThrow()
    expect(() => runtime.runAction(createNotification('pathCopied', { fileName: 'a.pdf' }))).not.toThrow()
  })

  it('distribue les gestes aux sources qui les prennent', () => {
    const onStopRecording = vi.fn()
    const onCallAccept = vi.fn()
    const sources: IslandSource[] = [
      { id: 'a', start: () => ({ gestures: { onStopRecording } }) },
      { id: 'b', start: () => ({ gestures: { onCallAccept } }) },
    ]
    const { runtime } = setupRuntime({ sources })
    runtime.gestures.onStopRecording()
    runtime.gestures.onCallAccept('p-1')
    runtime.gestures.onAnswerSession('s-1')
    expect(onStopRecording).toHaveBeenCalledTimes(1)
    expect(onCallAccept).toHaveBeenCalledWith('p-1')
  })

  it('attend la connexion, avec un délai', async () => {
    const { box, source } = capture()
    const { session, clock } = setupRuntime({ sources: [source], signedIn: false })
    const ctx = box.ctx!
    const late = ctx.waitForSignedIn()
    clock.advance(2500)
    await expect(late).resolves.toBe(false)
    const soon = ctx.waitForSignedIn()
    session.set(SIGNED_IN)
    await expect(soon).resolves.toBe(true)
    await expect(ctx.waitForSignedIn()).resolves.toBe(true)
  })

  it('whenSignedIn appelle une seule fois, à la connexion', () => {
    const callback = vi.fn()
    const { session } = setupRuntime({ sources: [capture((ctx) => ctx.whenSignedIn(callback)).source], signedIn: false })
    expect(callback).not.toHaveBeenCalled()
    session.set(SIGNED_IN)
    session.set({ ...SIGNED_IN, memberId: 'm-2' })
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('arrête les sources et la coordination', async () => {
    const { box, source, dispose } = capture()
    const { runtime } = setupRuntime({ sources: [source] })
    runtime.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(box.ctx!.isDisposed()).toBe(true)
    runtime.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    await flush(1)
  })

  it('une source qui plante au démarrage n’empêche pas les autres', () => {
    const ok = capture()
    const broken: IslandSource = {
      id: 'cassée',
      start: () => {
        throw new Error('boom')
      },
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setupRuntime({ sources: [broken, ok.source] })
    expect(ok.box.ctx).not.toBeNull()
    error.mockRestore()
  })
})
