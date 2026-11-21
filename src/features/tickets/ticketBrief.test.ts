import { describe, expect, it } from 'vitest'
import { ticketBrief } from './ticketBrief'

const ticket = {
  title: 'Mettre le bouton Payer en vert',
  description: 'Le bouton Payer est peu visible.\n\nÀ faire :\n- Passer le bouton en vert',
  type: 'modification' as const,
  priority: 'high' as const,
  area: 'Paiement',
  source_quote: "Le bouton « Payer » n'est pas assez visible.",
}

describe('ticketBrief', () => {
  it('commence par /ticket et reprend projet, type, description et citation', () => {
    const text = ticketBrief(ticket, { projectName: 'App Ibé', clientName: 'Ibé', quoteSource: 'Réunion du 12 novembre 2026 · 01:15' })
    expect(text).toBe(
      [
        '/ticket Mettre le bouton Payer en vert',
        'Projet : App Ibé (client : Ibé)\nType : Modification · Priorité : haute · Partie : Paiement',
        'Le bouton Payer est peu visible.\n\nÀ faire :\n- Passer le bouton en vert',
        "Passage de l'entrée (Réunion du 12 novembre 2026 · 01:15) :\n« Le bouton « Payer » n'est pas assez visible. »",
      ].join('\n\n'),
    )
  })

  it('omet ce qui manque (client, partie, description, citation)', () => {
    const text = ticketBrief(
      { ...ticket, area: null, description: '  ', source_quote: null },
      { projectName: 'App Ibé', clientName: null, quoteSource: null },
    )
    expect(text).toBe('/ticket Mettre le bouton Payer en vert\n\nProjet : App Ibé\nType : Modification · Priorité : haute')
  })
})
