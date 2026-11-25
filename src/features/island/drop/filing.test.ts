import { describe, expect, it } from 'vitest'
import {
  NO_NAMES,
  autoFiledNotification,
  batchRoute,
  destinationLabel,
  filedManyNotification,
  filedNotification,
  filingErrorNotification,
  filingItemOf,
  filingItemsOf,
  filingProgressLabel,
  idsToName,
  intakeRoute,
  itemLabel,
  planBatch,
  readyChoice,
  readyManyChoice,
  reviewNotification,
  setAsideNotification,
  undoneNotification,
} from './filing'
import {
  SAMPLE_BATCH_ID,
  SAMPLE_NAMES,
  sampleBatchItem,
  sampleBatchItems,
  sampleFiledFile,
  sampleIntake,
  sampleProposal,
} from './filingFixtures'

const items = (kind: Parameters<typeof sampleBatchItems>[0]) => filingItemsOf(sampleBatchItems(kind))

describe('routes et progression', () => {
  it('écran du dépôt et du lot', () => {
    expect(intakeRoute('in-1')).toBe('/files/intake/in-1')
    expect(batchRoute('b 1')).toBe('/files/inbox?batch=b%201')
  })

  it('« Classement de N fichiers », puis « Classement… 2 / 3 »', () => {
    expect(filingProgressLabel(0, 1)).toBe('Classement du fichier')
    expect(filingProgressLabel(0, 3)).toBe('Classement de 3 fichiers')
    expect(filingProgressLabel(2, 3)).toBe('Classement… 2 / 3')
    expect(filingProgressLabel(5, 3)).toBe('Classement… 3 / 3')
  })
})

describe('état de chaque fichier', () => {
  it('sûr, rangé par une règle, à vérifier, doublon, erreur de classement, envoi en échec, annulé', () => {
    expect(filingItemOf(sampleBatchItem(sampleIntake()))).toMatchObject({ kind: 'ready', fileName: 'devis-ibe.pdf' })
    expect(items('auto')[0]).toMatchObject({ kind: 'auto' })
    expect(items('review')[0]).toMatchObject({ kind: 'review', reasons: ['no_project', 'low_confidence'] })
    expect(items('duplicate')[0]).toMatchObject({ kind: 'review', reasons: ['duplicate'] })
    expect(items('error')[0]).toMatchObject({ kind: 'error', error: 'Le modèle n’a pas répondu' })
    expect(filingItemOf(sampleBatchItem(null, { name: 'gros.mov', error: '« gros.mov » dépasse 100 Mo.' }))).toMatchObject({
      kind: 'error',
      intake: null,
      fileName: 'gros.mov',
      error: '« gros.mov » dépasse 100 Mo.',
    })
    expect(filingItemOf(sampleBatchItem(sampleIntake({ status: 'cancelled' })))).toBeNull()
    // Une nouvelle version n'est pas une raison de vérifier.
    expect(items('version')[0]).toMatchObject({ kind: 'ready' })
  })

  it('ids à nommer, libellés', () => {
    const three = items('three')
    expect(idsToName(three)).toEqual({ clientIds: ['c-ibe'], projectIds: ['p-ibe'] })
    expect(itemLabel(three[0]!, SAMPLE_NAMES)).toBe('Devis D-2026-012 · Ibé › App Ibé')
    expect(itemLabel(three[2]!, SAMPLE_NAMES)).toBe('Maquette · Ibé › App Ibé')
    expect(itemLabel(three[0]!, NO_NAMES)).toBe('Devis D-2026-012')
    expect(itemLabel(items('error')[0]!, SAMPLE_NAMES)).toBe('devis-ibe.pdf')
    expect(destinationLabel('App Ibé', 'Devis')).toBe('App Ibé › Devis')
    expect(destinationLabel(null, 'Devis')).toBe('Devis')
  })
})

describe('plan d’un lot', () => {
  it('un fichier sûr → décision ; plusieurs → Tout ranger ; tout rangé → notification', () => {
    expect(planBatch(items('sure')).main.type).toBe('readyOne')
    expect(planBatch(items('three')).main.type).toBe('readyMany')
    expect(planBatch(items('auto')).main.type).toBe('auto')
    expect(planBatch([]).main).toEqual({ type: 'none' })
  })

  it('un fichier à vérifier envoie tout le lot dans l’app ; les erreurs à part', () => {
    const mixed = [...items('three'), ...items('duplicate'), ...items('auto'), ...items('error')]
    const plan = planBatch(mixed)
    expect(plan.errors).toHaveLength(1)
    expect(plan.main).toMatchObject({ type: 'review' })
    if (plan.main.type !== 'review') throw new Error('plan')
    expect(plan.main.review).toHaveLength(1)
    expect(plan.main.ready).toHaveLength(3)
    expect(plan.main.auto).toHaveLength(1)
  })

  it('un sûr et un rangé seul : décision, avec le rappel du rangé', () => {
    const plan = planBatch([...items('sure'), ...items('auto')])
    expect(plan.main).toMatchObject({ type: 'readyOne' })
    if (plan.main.type !== 'readyOne') throw new Error('plan')
    expect(readyChoice(plan.main.item, SAMPLE_NAMES, plan.main.auto).eyebrow).toBe('Classé par l’IA · devis-ibe.pdf · 1 rangé automatiquement')
  })
})

describe('décisions', () => {
  it('fichier sûr : libellé, Toujours pour le client, Modifier, Ranger', () => {
    const choice = readyChoice(items('sure')[0]!, SAMPLE_NAMES)
    expect(choice).toEqual({
      id: 'filing:in-1',
      icon: 'folder',
      tone: 'info',
      eyebrow: 'Classé par l’IA · devis-ibe.pdf',
      title: 'Devis D-2026-012 · Ibé › App Ibé',
      always: { label: 'Toujours', hint: 'Ranger seuls les prochains devis d’Ibé' },
      secondary: 'Modifier',
      primary: 'Ranger',
    })
  })

  it('nouvelle version signalée ; sans client, pas de « Toujours »', () => {
    expect(readyChoice(items('version')[0]!, SAMPLE_NAMES).eyebrow).toBe('Nouvelle version · devis-ibe-v2.pdf')
    const noClient = filingItemOf(sampleBatchItem(sampleIntake({ proposal: sampleProposal({ client_id: null }) })))!
    expect(readyChoice(noClient, SAMPLE_NAMES).always).toBeNull()
  })

  it('plusieurs fichiers sûrs : « 3 fichiers prêts à ranger », Vérifier, Tout ranger', () => {
    const choice = readyManyChoice(items('three'), SAMPLE_BATCH_ID, SAMPLE_NAMES)
    expect(choice).toMatchObject({
      id: 'filing:batch:batch-1',
      eyebrow: 'Dans App Ibé',
      title: '3 fichiers prêts à ranger',
      always: null,
      secondary: 'Vérifier',
      primary: 'Tout ranger',
    })
    expect(setAsideNotification(choice, 3)).toMatchObject({
      title: '3 fichiers prêts à ranger',
      button: 'Voir',
      action: { type: 'showChoice', choiceId: 'filing:batch:batch-1' },
    })
  })
})

describe('notifications', () => {
  it('rangé automatiquement : « Rangé : … » + Annuler ; plusieurs : « N fichiers rangés »', () => {
    expect(autoFiledNotification(items('auto'), SAMPLE_NAMES)).toMatchObject({
      kind: 'filing',
      tone: 'success',
      title: 'Rangé : Devis D-2026-012 · Ibé › App Ibé',
      subtitle: 'Automatiquement, dossier Devis',
      button: 'Annuler',
      action: { type: 'undoFiling', intakeIds: ['in-1'], ruleIds: [] },
    })
    const two = [...items('auto'), ...items('auto').map((item) => ({ ...item, intake: { ...item.intake!, id: 'in-2' } }))]
    expect(autoFiledNotification(two, SAMPLE_NAMES)).toMatchObject({ title: '2 fichiers rangés', action: { intakeIds: ['in-1', 'in-2'] } })
  })

  it('à vérifier : écran du dépôt pour un seul fichier, écran du lot sinon', () => {
    const one = planBatch(items('duplicate')).main
    if (one.type !== 'review') throw new Error('plan')
    expect(reviewNotification(one, SAMPLE_BATCH_ID)).toMatchObject({
      tone: 'alert',
      title: 'À vérifier : devis-ibe.pdf',
      subtitle: 'Déjà rangé (doublon)',
      button: 'Vérifier',
      action: { type: 'openMain', route: '/files/intake/in-1' },
    })
    const lowConfidence = planBatch(items('review')).main
    if (lowConfidence.type !== 'review') throw new Error('plan')
    expect(reviewNotification(lowConfidence, SAMPLE_BATCH_ID).subtitle).toBe('Projet à choisir')
    const mixed = planBatch([...items('duplicate'), ...items('three')]).main
    if (mixed.type !== 'review') throw new Error('plan')
    expect(reviewNotification(mixed, SAMPLE_BATCH_ID)).toMatchObject({
      title: 'À vérifier : devis-ibe.pdf',
      subtitle: 'Déjà rangé (doublon), 3 prêts',
      action: { type: 'openMain', route: '/files/inbox?batch=batch-1' },
    })
  })

  it('erreur : Réessayer le lot', () => {
    expect(filingErrorNotification(items('error'), SAMPLE_BATCH_ID)).toMatchObject({
      tone: 'danger',
      title: 'Le classement a échoué',
      subtitle: 'devis-ibe.pdf : Le modèle n’a pas répondu',
      button: 'Réessayer',
      action: { type: 'retryFiling', batchId: 'batch-1' },
    })
    const upload = filingItemsOf([sampleBatchItem(null, { name: 'a.pdf' }), sampleBatchItem(null, { name: 'b.pdf' })])
    expect(filingErrorNotification(upload, SAMPLE_BATCH_ID).title).toBe('2 fichiers non classés')
    expect(filingErrorNotification(upload.slice(0, 1), SAMPLE_BATCH_ID).title).toBe('L’envoi du fichier a échoué')
  })

  it('après Ranger : destination, Annuler ; avec Toujours, la suite ; règle en échec signalée', () => {
    const intake = sampleIntake()
    const file = sampleFiledFile()
    expect(filedNotification({ intake, file, rule: null, ruleError: null, names: SAMPLE_NAMES })).toMatchObject({
      title: 'Rangé dans App Ibé › Devis',
      subtitle: 'devis-ibe.pdf',
      button: 'Annuler',
      action: { type: 'undoFiling', intakeIds: ['in-1'], ruleIds: [] },
    })
    expect(filedNotification({ intake, file, rule: { id: 'r-1' }, ruleError: null, names: SAMPLE_NAMES })).toMatchObject({
      subtitle: 'Les prochains devis d’Ibé seront rangés seuls',
      action: { ruleIds: ['r-1'] },
    })
    expect(filedNotification({ intake, file, rule: null, ruleError: 'accès refusé', names: SAMPLE_NAMES }).subtitle).toBe(
      '« Toujours » non enregistré : accès refusé',
    )
  })

  it('après Tout ranger : Annuler, ou Vérifier si une partie a échoué', () => {
    const filed = [{ intake: sampleIntake(), file: sampleFiledFile() }, { intake: sampleIntake({ id: 'in-2' }), file: sampleFiledFile() }]
    expect(filedManyNotification({ filed, failed: 0, batchId: SAMPLE_BATCH_ID, names: SAMPLE_NAMES })).toMatchObject({
      title: '2 fichiers rangés',
      subtitle: 'Dans App Ibé',
      action: { type: 'undoFiling', intakeIds: ['in-1', 'in-2'] },
    })
    expect(filedManyNotification({ filed, failed: 1, batchId: SAMPLE_BATCH_ID, names: SAMPLE_NAMES })).toMatchObject({
      title: '2 fichiers rangés, 1 à vérifier',
      action: { type: 'openMain', route: '/files/inbox?batch=batch-1' },
    })
  })

  it('rangement annulé', () => {
    expect(undoneNotification({ count: 1, ruleRevoked: true, route: '/files/intake/in-1' })).toMatchObject({
      title: 'Rangement annulé',
      subtitle: 'Le fichier est à ranger, règle « Toujours » retirée',
      action: { type: 'openMain', route: '/files/intake/in-1' },
    })
  })
})
