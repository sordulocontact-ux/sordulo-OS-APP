import { describe, expect, it } from 'vitest'
import type { DocumentLine } from '../../shared/types'
import { noProposalText, proposeErrorText, reviewPath, tasksProposal } from './quoteTasks'

const line = (service_id?: string): DocumentLine => ({
  label: 'L', description: null, quantity: 1, unit: 'day', unit_price_cents: 100, vat_rate: 20, service_id,
})
const withTasks = { id: 'a', task_templates: [{ title: 't', skill: 'dev' as const, estimate_hours: 1, depends_on: null }] }
const withoutTasks = { id: 'b', task_templates: [] }

describe('tasksProposal', () => {
  it('prêt : devis accepté, projet, ligne avec tâches types', () => {
    const p = tasksProposal({ status: 'accepted', project_id: 'p', lines: [line('a'), line('a'), line('b')] }, [withTasks, withoutTasks])
    expect(p).toEqual({ kind: 'ready', tickets: 2, tasks: 2 })
    expect(noProposalText(p)).toBeNull()
  })
  it('rien à proposer sans tâches types', () => {
    expect(tasksProposal({ status: 'accepted', project_id: 'p', lines: [line('b'), line()] }, [withTasks, withoutTasks]).kind).toBe('no-templates')
  })
  it('refuse sans projet, ou tant que le devis n’est pas accepté', () => {
    expect(tasksProposal({ status: 'accepted', project_id: null, lines: [line('a')] }, [withTasks]).kind).toBe('no-project')
    expect(tasksProposal({ status: 'sent', project_id: 'p', lines: [line('a')] }, [withTasks]).kind).toBe('not-accepted')
    expect(noProposalText({ kind: 'no-project' })).toMatch(/projet/)
  })
  it('chemin de validation et messages d’erreur', () => {
    expect(reviewPath('p1', 'i1')).toBe('/projects/p1/inputs/i1/review')
    expect(proposeErrorText({ code: '42501', message: 'x' })).toMatch(/droit/)
    expect(proposeErrorText({ code: 'P0001', message: 'Rattache d\'abord le devis à un projet' })).toBe('Rattache d\'abord le devis à un projet')
    expect(proposeErrorText(null)).toMatch(/Réessaie/)
  })
})
