import { describe, expect, it, vi } from 'vitest'
import type { BatchItem, BatchResult, FiledResult, IntakeOutcome, StartBatchOptions } from '../../../../lib/filing'
import type { FileIntake } from '../../../../shared/types'
import { CHOICE_IDLE_MS } from '../../coordinator'
import { FILING_PROGRESS_ID } from '../../drop/filing'
import { SAMPLE_NAMES, sampleBatchItems, sampleFiledFile, sampleIntake } from '../../drop/filingFixtures'
import { SIGN_IN_WAIT_MS } from '../runtime'
import { flush, setupRuntime } from '../testUtils'
import { createFilingSource, type FilingSourceDeps } from './filing'

const PROJECTS = [
  { id: 'p-ibe', name: 'App Ibé' },
  { id: 'p-site', name: 'Site Sordulo' },
]

const file = (name: string) => new File(['x'], name, { type: 'application/pdf' })

function setup(options: { items?: BatchItem[]; signedIn?: boolean } = {}) {
  let items = options.items ?? sampleBatchItems('sure')
  const deps = {
    startBatch: vi.fn(async (files: readonly File[], opts: StartBatchOptions): Promise<BatchResult> => {
      items.forEach((item, index) => opts.onProgress?.({ done: index + 1, total: files.length, item }))
      return { batchId: opts.batchId ?? 'b', items }
    }),
    classifyIntake: vi.fn(async (intakeId: string): Promise<IntakeOutcome> => ({ intake: sampleIntake({ id: intakeId }), classifyError: null })),
    fileReady: vi.fn(
      async (intake: FileIntake, always: boolean): Promise<FiledResult> => ({
        intake: { ...intake, status: 'filed' },
        file: sampleFiledFile({ kind: intake.proposal?.kind ?? 'other', folder: intake.proposal?.folder ?? 'Divers' }),
        rule: always ? { id: 'r-1' } as FiledResult['rule'] : null,
        ruleError: null,
      }),
    ),
    undoFiling: vi.fn(async (intakeId: string) => sampleIntake({ id: intakeId })),
    revokeFilingRule: vi.fn(async () => {}),
    fetchClientNames: vi.fn(async () => ({ ...SAMPLE_NAMES.clients })),
    openMain: vi.fn(),
    randomUUID: vi.fn(() => 'batch-1'),
  } satisfies FilingSourceDeps
  const env = setupRuntime({ sources: [createFilingSource(deps)], signedIn: options.signedIn, projects: PROJECTS })
  const batches = vi.fn()
  env.runtime.bus.on('filingBatch', batches)
  return {
    ...env,
    deps,
    batches,
    setItems: (next: BatchItem[]) => {
      items = next
    },
    drop: (files: File[] = [file('devis-ibe.pdf')]) => env.runtime.bus.emit('fileFiles', { files }),
    choose: (decision: 'primary' | 'secondary' | 'dismiss', always = false) => {
      const choice = env.coordinator.getSnapshot().choice
      if (!choice) throw new Error('aucune décision affichée')
      env.runtime.gestures.onChoiceDecision(decision, choice, always)
    },
    press: () => {
      const notification = env.coordinator.getSnapshot().notification
      if (!notification) throw new Error('aucune notification affichée')
      env.runtime.runAction(notification)
    },
  }
}

describe('source « rangement »', () => {
  it('fichier sûr : lot annoncé avant l’envoi, progression, puis décision Ranger / Modifier / Toujours', async () => {
    const t = setup()
    t.deps.startBatch.mockImplementationOnce(async (_files, opts) => {
      // Le lot est déjà connu de la source « notifications » quand l'envoi commence.
      expect(t.batches).toHaveBeenCalledWith({ batchId: 'batch-1' })
      expect(t.coordinator.getActivity(`${FILING_PROGRESS_ID}:batch-1`)).toMatchObject({ stage: 'file', label: 'Classement du fichier' })
      return { batchId: opts.batchId!, items: sampleBatchItems('sure') }
    })
    t.drop()
    await flush()
    expect(t.deps.startBatch).toHaveBeenCalledWith([expect.any(File)], expect.objectContaining({ source: 'island', organizationId: 'o-1', memberId: 'm-1', batchId: 'batch-1' }))
    expect(t.coordinator.getActivity(`${FILING_PROGRESS_ID}:batch-1`)).toBeNull()
    expect(t.deps.fetchClientNames).toHaveBeenCalledWith(['c-ibe'])
    expect(t.snap()).toMatchObject({ state: 'choice' })
    expect(t.snap().choice).toMatchObject({ title: 'Devis D-2026-012 · Ibé › App Ibé', primary: 'Ranger', secondary: 'Modifier' })
  })

  it('progression réelle : « Classement… 2 / 3 »', async () => {
    const t = setup({ items: sampleBatchItems('three') })
    const labels: string[] = []
    t.deps.startBatch.mockImplementationOnce(async (files, opts) => {
      const items = sampleBatchItems('three')
      items.forEach((item, index) => {
        opts.onProgress?.({ done: index + 1, total: files.length, item })
        const activity = t.coordinator.getActivity(`${FILING_PROGRESS_ID}:batch-1`)
        if (activity?.kind === 'progress') labels.push(`${activity.label} ${activity.fraction?.toFixed(2)}`)
      })
      return { batchId: opts.batchId!, items }
    })
    t.drop([file('a.pdf'), file('b.pdf'), file('c.png')])
    await flush()
    expect(labels).toEqual(['Classement… 1 / 3 0.33', 'Classement… 2 / 3 0.67', 'Classement… 3 / 3 1.00'])
  })

  it('Ranger + Toujours : rangé, « Rangé dans App Ibé › Devis » ; Annuler retire aussi la règle', async () => {
    const t = setup()
    t.drop()
    await flush()
    t.choose('primary', true)
    await flush()
    expect(t.deps.fileReady).toHaveBeenCalledWith(expect.objectContaining({ id: 'in-1' }), true)
    expect(t.snap().choice).toBeNull()
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({
      title: 'Rangé dans App Ibé › Devis',
      subtitle: 'Les prochains devis d’Ibé seront rangés seuls',
      button: 'Annuler',
    })
    t.press()
    await flush()
    expect(t.deps.revokeFilingRule).toHaveBeenCalledWith('r-1')
    expect(t.deps.undoFiling).toHaveBeenCalledWith('in-1')
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({ title: 'Rangement annulé', action: { type: 'openMain', route: '/files/intake/in-1' } })
  })

  it('Modifier : l’app s’ouvre sur l’écran de rangement du dépôt', async () => {
    const t = setup()
    t.drop()
    await flush()
    t.choose('secondary')
    expect(t.deps.openMain).toHaveBeenCalledWith('/files/intake/in-1')
    expect(t.deps.fileReady).not.toHaveBeenCalled()
    expect(t.snap().choice).toBeNull()
  })

  it('Échap : plus tard, rien n’est rangé ni ouvert', async () => {
    const t = setup()
    t.drop()
    await flush()
    t.choose('dismiss')
    expect(t.snap().choice).toBeNull()
    expect(t.deps.fileReady).not.toHaveBeenCalled()
    expect(t.deps.openMain).not.toHaveBeenCalled()
  })

  it('rangement impossible : erreur, Ouvrir l’écran du dépôt', async () => {
    const t = setup()
    t.deps.fileReady.mockRejectedValueOnce(new Error('Rangement impossible : accès refusé.'))
    t.drop()
    await flush()
    t.choose('primary')
    await flush()
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({
      title: 'Le rangement a échoué',
      subtitle: 'Rangement impossible : accès refusé.',
      action: { type: 'openMain', route: '/files/intake/in-1' },
    })
  })

  it('personne sur l’île : décision mise de côté, « Fichier prêt à ranger », Voir la remontre', async () => {
    const t = setup()
    t.drop()
    await flush()
    t.clock.advance(CHOICE_IDLE_MS)
    expect(t.snap().choice).toBeNull()
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({ title: 'Fichier prêt à ranger', button: 'Voir' })
    t.press()
    t.clock.advance(450)
    expect(t.snap().choice?.id).toBe('filing:in-1')
  })

  it('3 fichiers sûrs : « 3 fichiers prêts à ranger », Tout ranger, « 3 fichiers rangés » + Annuler', async () => {
    const t = setup({ items: sampleBatchItems('three') })
    t.drop([file('a.pdf'), file('b.pdf'), file('c.png')])
    await flush()
    expect(t.snap().choice).toMatchObject({ title: '3 fichiers prêts à ranger', primary: 'Tout ranger', secondary: 'Vérifier' })
    t.choose('primary')
    await flush()
    expect(t.deps.fileReady).toHaveBeenCalledTimes(3)
    t.clock.advance(450)
    expect(t.snap().notification).toMatchObject({
      title: '3 fichiers rangés',
      subtitle: 'Dans App Ibé',
      action: { type: 'undoFiling', intakeIds: ['in-1', 'in-2', 'in-3'] },
    })
  })

  it('3 fichiers : Vérifier ouvre l’écran du lot', async () => {
    const t = setup({ items: sampleBatchItems('three') })
    t.drop([file('a.pdf'), file('b.pdf'), file('c.png')])
    await flush()
    t.choose('secondary')
    expect(t.deps.openMain).toHaveBeenCalledWith('/files/inbox?batch=batch-1')
  })

  it('fichier à vérifier ou doublon : « À vérifier », bouton vers l’app', async () => {
    const t = setup({ items: sampleBatchItems('duplicate') })
    t.drop()
    await flush()
    expect(t.snap().state).toBe('notif')
    expect(t.snap().notification).toMatchObject({ title: 'À vérifier : devis-ibe.pdf', subtitle: 'Déjà rangé (doublon)' })
    t.press()
    expect(t.deps.openMain).not.toHaveBeenCalled() // openMain par défaut du contrôleur (aucune source ne le prend)
  })

  it('rangé par une règle « Toujours » : « Rangé : … » + Annuler (règle gardée)', async () => {
    const t = setup({ items: sampleBatchItems('auto') })
    t.drop()
    await flush()
    expect(t.snap().notification).toMatchObject({ title: 'Rangé : Devis D-2026-012 · Ibé › App Ibé', button: 'Annuler' })
    t.press()
    await flush()
    expect(t.deps.undoFiling).toHaveBeenCalledWith('in-1')
    expect(t.deps.revokeFilingRule).not.toHaveBeenCalled()
  })

  it('erreur de classement : Réessayer reclasse seulement ce dépôt, puis propose de ranger', async () => {
    const t = setup({ items: sampleBatchItems('error') })
    t.drop()
    await flush()
    expect(t.snap().notification).toMatchObject({ title: 'Le classement a échoué', button: 'Réessayer', action: { type: 'retryFiling', batchId: 'batch-1' } })
    t.press()
    await flush()
    expect(t.deps.classifyIntake).toHaveBeenCalledWith('in-1')
    expect(t.deps.startBatch).toHaveBeenCalledTimes(1)
    t.clock.advance(450)
    expect(t.snap().choice).toMatchObject({ id: 'filing:in-1', primary: 'Ranger' })
  })

  it('envoi en échec : Réessayer renvoie le fichier dans le même lot', async () => {
    const t = setup({ items: [{ file: file('a.pdf'), outcome: null, error: 'Envoi impossible' }] })
    t.drop([file('a.pdf')])
    await flush()
    expect(t.snap().notification).toMatchObject({ title: 'L’envoi du fichier a échoué' })
    t.setItems(sampleBatchItems('sure'))
    t.press()
    await flush()
    expect(t.deps.startBatch).toHaveBeenCalledTimes(2)
    expect(t.deps.startBatch.mock.calls[1]![1]).toMatchObject({ batchId: 'batch-1' })
    t.clock.advance(450)
    expect(t.snap().choice?.id).toBe('filing:in-1')
  })

  it('sans connexion : attend la session partagée, puis « Connecte-toi dans Sordulo OS »', async () => {
    const t = setup({ signedIn: false })
    t.drop()
    await flush()
    t.clock.advance(SIGN_IN_WAIT_MS)
    await flush()
    expect(t.snap().notification).toMatchObject({ kind: 'loginRequired', subtitle: 'Pour ranger tes fichiers' })
    expect(t.deps.startBatch).not.toHaveBeenCalled()
  })

  it('ignore les décisions des autres sources', async () => {
    const t = setup()
    t.runtime.gestures.onChoiceDecision(
      'primary',
      { id: 'proposal:1', icon: 'bell', tone: 'info', eyebrow: '', title: '', always: null, secondary: null, primary: 'Valider' },
      false,
    )
    await flush()
    expect(t.deps.fileReady).not.toHaveBeenCalled()
  })
})
