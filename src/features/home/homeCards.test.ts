import { describe, expect, it } from 'vitest'
import { thresholdStatus } from '../../shared/thresholds'
import { dueSentence, dueSummary, followupsSentence, monthName, monthRevenueSentence, plain, thresholdAlertSentence, type HomeDueTask } from './homeLogic'

const text = (sentence: Parameters<typeof plain>[0]) => plain(sentence).replace(/\s/g, ' ')
const task = (over: Partial<HomeDueTask>): HomeDueTask => ({ id: 't', title: 'T', due_date: '2026-11-25', status: 'todo', ...over })

describe('Mes tâches du jour', () => {
  const today = '2026-11-25'
  it('compte les tâches du jour et en retard, hors terminées et sans échéance', () => {
    const summary = dueSummary(
      [task({ id: 'a' }), task({ id: 'b', due_date: '2026-11-20' }), task({ id: 'c', status: 'done' }), task({ id: 'd', due_date: null }), task({ id: 'e', due_date: '2026-12-01' })],
      today,
    )
    expect(summary).toEqual({ today: 1, overdue: 1 })
    expect(text(dueSentence(summary))).toBe('1 tâche à rendre aujourd’hui, 1 en retard')
  })
  it('dit quand rien n’est échu', () => {
    expect(text(dueSentence({ today: 0, overdue: 0 }))).toBe('Rien d’échu aujourd’hui.')
    expect(text(dueSentence({ today: 0, overdue: 3 }))).toBe('3 en retard')
  })
})

describe('CA du mois et relances', () => {
  it('nomme le mois et le montant', () => {
    expect(monthName('2026-11')).toBe('novembre')
    expect(text(monthRevenueSentence({ key: '2026-11', collectedCents: 150_000 }, '2026-11'))).toBe('Encaissé en novembre : 1 500 €')
    expect(text(monthRevenueSentence(undefined, '2026-11'))).toBe('Rien d’encaissé en novembre pour l’instant.')
  })
  it('compte les relances', () => {
    expect(text(followupsSentence(0))).toBe('Aucune relance à faire.')
    expect(text(followupsSentence(3))).toContain('3 documents')
  })
})

describe('alerte de seuil', () => {
  it('annonce la proximité puis le dépassement', () => {
    const near = thresholdStatus('vat', 3_200_000, 3_750_000)
    expect(text(thresholdAlertSentence('Maël Auzenet EI', near))).toContain('Maël est à 85 %')
    const over = thresholdStatus('micro', 9_000_000, 8_360_000)
    expect(text(thresholdAlertSentence('Maël Auzenet EI', over))).toContain('a dépassé')
  })
})
