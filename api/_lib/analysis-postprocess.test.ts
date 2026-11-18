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
        area: ' Menu  principal ',
        related_ticket_id: related,
        tasks,
      },
    ],
  }
}

describe('postProcessAnalysis', () => {
  it('nettoie le titre et la partie, et garde une seule tâche telle quelle', () => {
    const [ticket] = postProcessAnalysis(analysis([task({ title: ' Corriger le menu mobile ', skill: 'design', estimate_hours: 0.75 })]), [])
    expect(ticket?.title).toBe('Corriger le menu')
    expect(ticket?.area).toBe('Menu principal')
    expect(ticket?.tasks).toEqual([{ title: 'Corriger le menu mobile', skill: 'design', estimate_hours: 0.75, depends_on_index: null }])
  })

  it('fusionne plusieurs tâches en une : titre du ticket, durée totale, compétence la plus lourde', () => {
    const [ticket] = postProcessAnalysis(
      analysis([
        task({ skill: 'design', estimate_hours: 0.5 }),
        task({ skill: 'dev', estimate_hours: 1.5, depends_on_index: 0 }),
        task({ skill: 'dev', estimate_hours: Number.NaN }),
      ]),
      [],
    )
    expect(ticket?.tasks).toEqual([{ title: 'Corriger le menu', skill: 'dev', estimate_hours: 2, depends_on_index: null }])
  })

  it('choisit design quand le design pèse le plus, et crée une tâche si l’analyse n’en donne pas', () => {
    const [heavyDesign] = postProcessAnalysis(analysis([task({ skill: 'design', estimate_hours: 3 }), task({ estimate_hours: 1 })]), [])
    expect(heavyDesign?.tasks[0]?.skill).toBe('design')
    const [empty] = postProcessAnalysis(analysis([]), [])
    expect(empty?.tasks).toEqual([{ title: 'Corriger le menu', skill: 'dev', estimate_hours: null, depends_on_index: null }])
  })

  it('met à null un related_ticket_id inconnu et garde un id connu', () => {
    expect(postProcessAnalysis(analysis([], 'inconnu'), [OPEN_ID])[0]?.related_ticket_id).toBeNull()
    expect(postProcessAnalysis(analysis([], OPEN_ID.toUpperCase()), [OPEN_ID])[0]?.related_ticket_id).toBe(OPEN_ID)
    expect(postProcessAnalysis(analysis([], OPEN_ID), [])[0]?.related_ticket_id).toBeNull()
  })

  it('ignore une estimation négative ou non finie', () => {
    const [ticket] = postProcessAnalysis(analysis([task({ estimate_hours: -2 })]), [])
    expect(ticket?.tasks[0]?.estimate_hours).toBeNull()
  })

  it('transforme une citation vide en null', () => {
    const input = analysis([])
    input.tickets[0]!.source_quote = '   '
    expect(postProcessAnalysis(input, [])[0]?.source_quote).toBeNull()
  })
})
