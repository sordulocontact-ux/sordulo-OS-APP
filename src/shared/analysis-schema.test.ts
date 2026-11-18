import { describe, expect, it } from 'vitest'
import { AnalysisSchema } from './analysis-schema.js'

const valid = {
  tickets: [
    {
      title: 'Agrandir le bouton de paiement',
      description: 'Le client trouve le bouton trop petit sur mobile.',
      type: 'modification',
      priority: 'high',
      source_quote: 'le bouton de paiement est vraiment trop petit',
      related_ticket_id: null,
      tasks: [
        { title: 'Ajuster la maquette du bouton', skill: 'design', estimate_hours: 1, depends_on_index: null },
        { title: 'Intégrer le nouveau bouton', skill: 'dev', estimate_hours: 1.5, depends_on_index: 0 },
      ],
    },
  ],
}

describe('AnalysisSchema', () => {
  it('accepte le JSON du ticket', () => {
    expect(AnalysisSchema.safeParse(valid).success).toBe(true)
  })
  it('accepte une liste vide', () => {
    expect(AnalysisSchema.safeParse({ tickets: [] }).success).toBe(true)
  })
  it('refuse un type, une priorité ou une compétence inconnus', () => {
    const t = valid.tickets[0]!
    expect(AnalysisSchema.safeParse({ tickets: [{ ...t, type: 'feature' }] }).success).toBe(false)
    expect(AnalysisSchema.safeParse({ tickets: [{ ...t, priority: 'urgent' }] }).success).toBe(false)
    const badTask = { ...t.tasks[0]!, skill: 'seo' }
    expect(AnalysisSchema.safeParse({ tickets: [{ ...t, tasks: [badTask] }] }).success).toBe(false)
  })
  it('refuse un champ manquant', () => {
    const { source_quote: _unused, ...withoutQuote } = valid.tickets[0]!
    expect(AnalysisSchema.safeParse({ tickets: [withoutQuote] }).success).toBe(false)
  })
})
