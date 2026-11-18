import { describe, expect, it } from 'vitest'
import type { Analysis, AnalysisTask } from '../../src/shared/analysis-schema.js'
import { postProcessAnalysis } from './analysis-postprocess.js'

const OPEN_ID = '3f0c1d8e-5b7a-4c2e-9f11-2a6b8d4e0c99'

function task(overrides: Partial<AnalysisTask> = {}): AnalysisTask {
  return { title: 'Tâche', skill: 'dev', estimate_hours: 1, depends_on_index: null, ...overrides }
}

function analysis(tasks: AnalysisTask[], related: string | null = null): Analysis {
  return {
    tickets: [
      {
        title: '  Corriger le menu  ',
        description: 'Le menu ne s’ouvre pas.',
        type: 'bug',
        priority: 'medium',
        source_quote: 'le menu ne s’ouvre plus',
        related_ticket_id: related,
        tasks,
      },
    ],
  }
}

describe('postProcessAnalysis', () => {
  it('garde une dépendance valide et nettoie les titres', () => {
    const [ticket] = postProcessAnalysis(analysis([task({ skill: 'design' }), task({ depends_on_index: 0 })]), [])
    expect(ticket?.title).toBe('Corriger le menu')
    expect(ticket?.tasks.map((t) => t.depends_on_index)).toEqual([null, 0])
  })

  it('met à null un index hors bornes, négatif, décimal ou égal à lui-même', () => {
    const [ticket] = postProcessAnalysis(
      analysis([
        task({ depends_on_index: 0 }),
        task({ depends_on_index: 5 }),
        task({ depends_on_index: -1 }),
        task({ depends_on_index: 0.5 }),
      ]),
      [],
    )
    expect(ticket?.tasks.map((t) => t.depends_on_index)).toEqual([null, null, null, null])
  })

  it('casse un cycle de dépendances', () => {
    const [ticket] = postProcessAnalysis(analysis([task({ depends_on_index: 1 }), task({ depends_on_index: 0 })]), [])
    expect(ticket?.tasks.map((t) => t.depends_on_index)).toEqual([null, 0])
  })

  it('met à null un related_ticket_id inconnu et garde un id connu', () => {
    expect(postProcessAnalysis(analysis([], 'inconnu'), [OPEN_ID])[0]?.related_ticket_id).toBeNull()
    expect(postProcessAnalysis(analysis([], OPEN_ID.toUpperCase()), [OPEN_ID])[0]?.related_ticket_id).toBe(OPEN_ID)
    expect(postProcessAnalysis(analysis([], OPEN_ID), [])[0]?.related_ticket_id).toBeNull()
  })

  it('met à null une estimation négative ou non finie', () => {
    const [ticket] = postProcessAnalysis(
      analysis([
        task({ estimate_hours: -2 }),
        task({ estimate_hours: Number.NaN }),
        task({ estimate_hours: Number.POSITIVE_INFINITY }),
        task({ estimate_hours: 2.5 }),
        task({ estimate_hours: 0 }),
      ]),
      [],
    )
    expect(ticket?.tasks.map((t) => t.estimate_hours)).toEqual([null, null, null, 2.5, 0])
  })

  it('transforme une citation vide en null', () => {
    const input = analysis([])
    input.tickets[0]!.source_quote = '   '
    expect(postProcessAnalysis(input, [])[0]?.source_quote).toBeNull()
  })
})
