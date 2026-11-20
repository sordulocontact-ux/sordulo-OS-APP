import { describe, expect, it, vi } from 'vitest'
import type { InputStatus } from '../../../../shared/types'
import type { TrackedInput } from '../../../desktop/storage'
import { POLL_MS, analysisProgressId } from '../callFlow'
import { flush, setupRuntime } from '../testUtils'
import { createAnalysisSource, type AnalysisSourceDeps, type PolledInput } from './analysis'

function row(status: InputStatus, error: string | null = null): PolledInput {
  return {
    id: 'i-1',
    project_id: 'p-1',
    kind: 'meeting',
    title: 'Call Ibé',
    raw_text: null,
    created_at: '2026-11-20T10:00:00.000Z',
    status,
    error_message: error,
  }
}

function setup(options: { statuses: (InputStatus | 'gone')[]; tracked?: TrackedInput[]; proposed?: number }) {
  const statuses = [...options.statuses]
  let tracked = [...(options.tracked ?? [])]
  const deps = {
    fetchInput: vi.fn(async () => {
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!
      return next === 'gone' ? null : row(next, next === 'error' ? 'Transcription impossible' : null)
    }),
    fetchOutcome: vi.fn(async () => ({ proposedCount: options.proposed ?? 4, projectName: 'App Ibé' })),
    restartProcessing: vi.fn(async () => {}),
    readTrackedInputs: vi.fn(() => [...tracked]),
    addTrackedInput: vi.fn((t: TrackedInput) => {
      tracked = [...tracked.filter((x) => x.inputId !== t.inputId), t]
    }),
    removeTrackedInput: vi.fn((id: string) => {
      tracked = tracked.filter((x) => x.inputId !== id)
    }),
  } satisfies AnalysisSourceDeps
  const env = setupRuntime({ sources: [createAnalysisSource(deps)] })
  /** Avance d'un intervalle de lecture et laisse la lecture aboutir. */
  const tick = async () => {
    env.clock.advance(POLL_MS)
    await flush()
  }
  return { ...env, deps, tick, tracked: () => tracked }
}

describe('source « analyse »', () => {
  it('suit les vrais statuts jusqu’à « N tickets à valider »', async () => {
    const t = setup({ statuses: ['transcribing', 'analyzing', 'ready'] })
    t.runtime.bus.emit('trackInput', { inputId: 'i-1', durationSecs: 600 })
    expect(t.snap().primary).toMatchObject({ id: analysisProgressId('i-1'), stage: 'analyse', label: 'Analyse de l’appel' })
    expect(t.tracked()).toEqual([{ inputId: 'i-1', durationSecs: 600 }])
    await t.tick()
    await t.tick()
    expect(t.snap().state).toBe('progress')
    await t.tick()
    expect(t.deps.fetchInput).toHaveBeenCalledTimes(3)
    expect(t.snap().primary).toBeNull()
    expect(t.snap().notification).toMatchObject({
      kind: 'tickets',
      title: '4 tickets à valider',
      subtitle: 'Call Ibé, App Ibé',
      action: { type: 'openMain', route: '/projects/p-1/inputs/i-1/review' },
    })
    expect(t.tracked()).toEqual([])
  })

  it('entrée en erreur : « L’analyse a échoué » ; Réessayer relance le traitement et reprend le suivi', async () => {
    const t = setup({ statuses: ['error', 'analyzing', 'ready'], proposed: 0 })
    t.runtime.bus.emit('trackInput', { inputId: 'i-1', durationSecs: null })
    await t.tick()
    expect(t.snap().notification).toMatchObject({
      kind: 'analysisError',
      subtitle: 'Transcription impossible',
      action: { type: 'retryAnalysis', inputId: 'i-1' },
    })
    t.runtime.runAction(t.snap().notification!)
    expect(t.snap().primary?.id).toBe(analysisProgressId('i-1'))
    await flush()
    expect(t.deps.restartProcessing).toHaveBeenCalledWith('i-1')
    await t.tick()
    await t.tick()
    expect(t.snap().notification).toMatchObject({ title: 'Aucun ticket proposé', button: 'Ouvrir' })
  })

  it('relance refusée : la notification d’erreur revient avec le message', async () => {
    const t = setup({ statuses: ['error'] })
    t.deps.restartProcessing.mockRejectedValueOnce(new Error('Session expirée, reconnecte-toi.'))
    t.runtime.bus.emit('trackInput', { inputId: 'i-1', durationSecs: null })
    await t.tick()
    t.runtime.runAction(t.snap().notification!)
    await flush()
    t.clock.advance(500)
    expect(t.snap().primary).toBeNull()
    expect(t.snap().notification).toMatchObject({ kind: 'analysisError', subtitle: 'Session expirée, reconnecte-toi.' })
  })

  it('reprend au démarrage les entrées suivies', async () => {
    const t = setup({ statuses: ['ready'], tracked: [{ inputId: 'i-1', durationSecs: 60 }] })
    expect(t.snap().primary?.id).toBe(analysisProgressId('i-1'))
    t.clock.advance(0)
    await flush()
    expect(t.snap().notification?.kind).toBe('tickets')
  })

  it('une lecture en échec est retentée ; une entrée disparue arrête le suivi', async () => {
    const t = setup({ statuses: ['gone'] })
    t.deps.fetchInput.mockRejectedValueOnce(new Error('réseau'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.runtime.bus.emit('trackInput', { inputId: 'i-1', durationSecs: null })
    await t.tick()
    expect(t.snap().primary).not.toBeNull()
    t.clock.advance(5000)
    await flush()
    expect(t.snap().primary).toBeNull()
    expect(t.snap().notification).toBeNull()
    warn.mockRestore()
  })
})
