import { describe, expect, it } from 'vitest'
import { SAMPLE_APP_NOTIFICATIONS, sampleAppNotification } from '../drop/filingFixtures'
import {
  islandViewOf,
  proposalAppliedNotification,
  proposalFailedNotification,
  proposalTitle,
  safeRoute,
  type AppNotificationContext,
} from './logic'

const ctx = (over: Partial<AppNotificationContext> = {}): AppNotificationContext => ({
  memberId: 'm-1',
  ownBatchIds: new Set(),
  trackedInputIds: new Set(),
  ...over,
})

describe('filtre des notifications de la base', () => {
  it('ignore celles d’un autre membre, déjà lues, et les attributions (source « attribution »)', () => {
    expect(islandViewOf(sampleAppNotification({ member_id: 'm-2' }), ctx())).toEqual({ type: 'ignore', reason: 'other' })
    expect(islandViewOf(sampleAppNotification({ read_at: '2026-11-25T10:01:00Z' }), ctx())).toEqual({ type: 'ignore', reason: 'read' })
    expect(islandViewOf(sampleAppNotification({ kind: 'task.assigned' }), ctx())).toEqual({ type: 'ignore', reason: 'kind' })
  })

  it('ignore file.ready / file.auto_filed d’un lot de cette île, garde ceux d’ailleurs', () => {
    const ready = sampleAppNotification({
      kind: 'file.ready',
      title: 'Fichier prêt à ranger : devis.pdf',
      link: '/files/intake/in-1',
      payload: { intake_id: 'in-1', batch_id: 'b-1', source: 'island' },
    })
    expect(islandViewOf(ready, ctx({ ownBatchIds: new Set(['b-1']) }))).toEqual({ type: 'ignore', reason: 'own-filing' })
    expect(islandViewOf({ ...ready, kind: 'file.auto_filed' }, ctx({ ownBatchIds: new Set(['b-1']) }))).toMatchObject({ type: 'ignore' })
    expect(islandViewOf(ready, ctx({ ownBatchIds: new Set(['b-2']) }))).toMatchObject({
      type: 'notify',
      notification: { title: 'Fichier prêt à ranger : devis.pdf', button: 'Ranger', action: { type: 'openNotification', route: '/files/intake/in-1' } },
    })
  })

  it('ignore input.ready d’une entrée suivie par cette île (déjà « N tickets à valider »)', () => {
    const row = SAMPLE_APP_NOTIFICATIONS['input.ready']!
    expect(islandViewOf(row, ctx({ trackedInputIds: new Set(['i-9']) }))).toEqual({ type: 'ignore', reason: 'tracked-input' })
    expect(islandViewOf(row, ctx())).toMatchObject({ type: 'notify', notification: { button: 'Valider', visual: { icon: 'tickets' } } })
  })
})

describe('traduction', () => {
  it('passage de main : titre de la base, texte, bouton vers le lien, notification marquée lue au clic', () => {
    expect(islandViewOf(SAMPLE_APP_NOTIFICATIONS['prospect.created']!, ctx())).toMatchObject({
      type: 'notify',
      notification: {
        kind: 'appNotification',
        visual: { type: 'icon', icon: 'bell' },
        tone: 'info',
        title: 'Gabi a ajouté un site : Boulangerie Lemoine',
        subtitle: 'boulangerie-lemoine.fr',
        button: 'Voir',
        action: { type: 'openNotification', notificationId: 'n-1', route: '/prospects/pr-1' },
      },
    })
    expect(islandViewOf(SAMPLE_APP_NOTIFICATIONS['commission.created']!, ctx())).toMatchObject({
      notification: { visual: { icon: 'euro' }, tone: 'success' },
    })
    expect(islandViewOf(SAMPLE_APP_NOTIFICATIONS['recap.weekly']!, ctx())).toMatchObject({
      notification: { visual: { icon: 'cal' }, button: 'Lire', action: { route: '/recap' } },
    })
  })

  it('sans lien sûr : pas de bouton ; sans texte : le libellé du type ; type inconnu : visuel par défaut', () => {
    const view = islandViewOf(sampleAppNotification({ kind: 'followup.due', link: 'https://exemple.fr', body: null }), ctx())
    expect(view).toMatchObject({
      type: 'notify',
      notification: { button: null, subtitle: 'Notification', visual: { icon: 'bell' }, action: { type: 'openNotification', route: null } },
    })
    expect(safeRoute('/a')).toBe('/a')
    expect(safeRoute('//evil.fr')).toBeNull()
    expect(safeRoute(null)).toBeNull()
  })

  it('proposition à valider : décision Valider / Refuser / Toujours', () => {
    expect(islandViewOf(SAMPLE_APP_NOTIFICATIONS['proposal.created']!, ctx())).toEqual({
      type: 'choice',
      proposalId: 'ap-1',
      choice: {
        id: 'proposal:ap-1',
        icon: 'tickets',
        tone: 'info',
        eyebrow: 'Proposition de l’IA · Maël est en école jeudi et vendredi',
        title: 'Donner 3 tâches de Maël à Sacha',
        always: { label: 'Toujours', hint: 'Appliquer seules les prochaines propositions de ce type' },
        secondary: 'Refuser',
        primary: 'Valider',
      },
    })
  })

  it('proposition appliquée seule : notification avec Annuler', () => {
    expect(islandViewOf(SAMPLE_APP_NOTIFICATIONS['proposal.auto_applied']!, ctx())).toMatchObject({
      type: 'notify',
      notification: {
        title: 'Appliqué automatiquement : Échéance de la maquette repoussée au 2 déc.',
        button: 'Annuler',
        action: { type: 'undoProposal', proposalId: 'ap-2', notificationId: 'n-5' },
      },
    })
  })

  it('textes des suites d’une proposition', () => {
    expect(proposalTitle('Proposition : Réattribuer')).toBe('Réattribuer')
    expect(proposalTitle('Réattribuer')).toBe('Réattribuer')
    expect(proposalAppliedNotification('Réattribuer', 'ap-1', true)).toMatchObject({
      title: 'Proposition appliquée',
      subtitle: 'Réattribuer, et les prochaines de ce type',
      action: { type: 'undoProposal', proposalId: 'ap-1', notificationId: null },
    })
    expect(proposalFailedNotification('Échec', 'accès refusé')).toMatchObject({ action: { type: 'openMain', route: '/proposals' } })
  })
})
