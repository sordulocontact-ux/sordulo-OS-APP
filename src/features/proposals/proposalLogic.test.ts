import { describe, expect, it } from 'vitest'
import type { AiProposal } from '../../shared/types'
import { alwaysHint, canUndo, decisionMessage, describeChanges, describeOperation, proposalTaskIds, replanMessage, ruleScopeLabel } from './proposalLogic'

const ctx = {
  taskTitle: (id: string) => ({ t1: 'Maquette de l’accueil', t2: 'Intégration' })[id] ?? null,
  memberName: (id: string) => ({ mael: 'Maël', sacha: 'Sacha' })[id] ?? null,
}

describe('describeOperation', () => {
  it('réattribution', () => {
    expect(describeOperation({ task_id: 't1', before: { assignee_member_id: 'mael' }, after: { assignee_member_id: 'sacha' } }, ctx)).toBe(
      'Tâche « Maquette de l’accueil » : Maël → Sacha',
    )
  })

  it('échéance, priorité, ordre, plusieurs à la fois', () => {
    const op = {
      task_id: 't2',
      before: { due_date: '2026-12-03', priority: 'medium' as const, position: 1 },
      after: { due_date: '2026-12-05', priority: 'high' as const, position: 3 },
    }
    expect(describeOperation(op, ctx)).toBe('Tâche « Intégration » : échéance 3 déc. → 5 déc., priorité moyenne → haute, ordre dans la colonne modifié')
  })

  it('valeurs absentes, membre inconnu, tâche supprimée', () => {
    expect(describeChanges({ task_id: 't1', before: { assignee_member_id: null, due_date: null }, after: { assignee_member_id: 'x', due_date: '2026-12-01' } }, ctx)).toEqual([
      'personne → un ancien membre',
      'échéance aucune → 1 déc.',
    ])
    expect(describeOperation({ task_id: 'zzz', before: {}, after: {} }, ctx)).toBe('Tâche supprimée')
  })
})

describe('règles et messages', () => {
  it('périmètre d’une règle', () => {
    const name = (id: string) => (id === 'p1' ? 'App Ibé' : null)
    expect(ruleScopeLabel({}, name)).toBe('Toute l’organisation')
    expect(ruleScopeLabel({ project_id: 'p1' }, name)).toBe('Projet « App Ibé »')
    expect(ruleScopeLabel({ project_id: 'p2' }, name)).toBe('Projet supprimé')
  })

  it('aide de « Toujours » et confirmations', () => {
    expect(alwaysHint('reassign_task')).toContain('réattributions')
    expect(decisionMessage('always', 'move_due_date')).toContain('déplacements d’échéance')
    expect(decisionMessage('undo', 'reorder')).toBe('Changement annulé')
  })

  it('annulable seulement si appliquée', () => {
    expect(canUndo({ status: 'accepted' })).toBe(true)
    expect(canUndo({ status: 'auto_applied' })).toBe(true)
    expect(canUndo({ status: 'pending' })).toBe(false)
    expect(canUndo({ status: 'undone' })).toBe(false)
  })

  it('résultat de « Réorganiser le planning »', () => {
    const p = (status: AiProposal['status']) => ({ status }) as AiProposal
    expect(replanMessage({ proposals: [], issueCount: 0 })).toBe('Rien à réorganiser : le planning tient.')
    expect(replanMessage({ proposals: [], issueCount: 2 })).toContain('aucun changement raisonnable')
    expect(replanMessage({ proposals: [p('pending')], issueCount: 1 })).toBe('1 proposition créée.')
    expect(replanMessage({ proposals: [p('pending'), p('auto_applied')], issueCount: 2 })).toBe('2 propositions créées, dont 1 appliquée automatiquement.')
  })

  it('tâches citées, sans doublon', () => {
    const proposals = [
      { payload: { operations: [{ task_id: 'b', before: {}, after: {} }, { task_id: 'a', before: {}, after: {} }] } },
      { payload: { operations: [{ task_id: 'a', before: {}, after: {} }] } },
      { payload: {} },
    ]
    expect(proposalTaskIds(proposals)).toEqual(['a', 'b'])
  })
})
