import { describe, expect, it } from 'vitest'
import { AnalysisSchema, RevisionSchema } from './analysis-schema.js'

const valid = {
  tickets: [
    {
      title: 'Agrandir le bouton de paiement',
      description: 'Le client trouve le bouton trop petit sur mobile.',
      type: 'modification',
      priority: 'high',
      source_quote: 'le bouton de paiement est vraiment trop petit',
      from_marker: false,
      area: 'Paiement',
      related_ticket_id: null,
      assignee_member_id: null,
      assignment_reason: null,
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
    const { from_marker: _marker, ...withoutMarker } = valid.tickets[0]!
    expect(AnalysisSchema.safeParse({ tickets: [withoutMarker] }).success).toBe(false)
  })
  it('refuse un from_marker qui n’est pas un booléen', () => {
    expect(AnalysisSchema.safeParse({ tickets: [{ ...valid.tickets[0]!, from_marker: 'oui' }] }).success).toBe(false)
  })
})

describe('RevisionSchema', () => {
  const ticket = {
    id: null,
    title: 'Agrandir le bouton de paiement',
    description: 'Le client trouve le bouton trop petit.',
    type: 'modification',
    priority: 'medium',
    area: 'Paiement',
    source_quote: 'le bouton est trop petit',
    assignee_member_id: 'mael',
    assignment_reason: 'Demandé dans la note',
    skill: 'dev',
    estimate_hours: 0.5,
  }
  it('accepte des tickets et la mémoire du projet', () => {
    expect(RevisionSchema.safeParse({ tickets: [ticket, { ...ticket, id: 'abc', assignee_member_id: null }], project_instructions: '' }).success).toBe(
      true,
    )
  })
  it('refuse une sortie sans mémoire ou une compétence inconnue', () => {
    expect(RevisionSchema.safeParse({ tickets: [ticket] }).success).toBe(false)
    expect(RevisionSchema.safeParse({ tickets: [{ ...ticket, skill: 'seo' }], project_instructions: '' }).success).toBe(false)
  })
})
