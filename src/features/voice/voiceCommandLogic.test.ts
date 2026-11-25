import { describe, expect, it } from 'vitest'
import type { VoiceTaskDraft } from '../../shared/ai/voiceCommand'
import { VOICE_ERRORS } from '../review/voiceNote'
import { commandErrorMessage, formatDueDate, isHold, taskDetails, taskInsert } from './voiceCommandLogic'

const draft: VoiceTaskDraft = {
  projectId: 'p1',
  projectName: 'App Ibé',
  title: 'Refaire le menu',
  skill: 'design',
  estimateHours: 1.5,
  dueDate: '2026-11-27',
  priority: 'high',
  assigneeMemberId: 'm1',
  assigneeName: 'Sacha',
}

describe('commandes vocales', () => {
  it('maintenir pour parler au-delà de 400 ms', () => {
    expect(isHold(399)).toBe(false)
    expect(isHold(400)).toBe(true)
  })

  it('messages du micro adaptés à une commande', () => {
    expect(commandErrorMessage(VOICE_ERRORS.denied)).toContain('tape ta recherche')
    expect(commandErrorMessage(VOICE_ERRORS.failed)).not.toContain('note')
    expect(commandErrorMessage('Serveur injoignable.')).toBe('Serveur injoignable.')
  })

  it('détails de la tâche à confirmer', () => {
    expect(formatDueDate('2026-11-27')).toBe('vendredi 27 novembre')
    const rows = Object.fromEntries(taskDetails(draft).map((r) => [r.label, r.value.replace(/\s/g, ' ')]))
    expect(rows).toEqual({
      Projet: 'App Ibé',
      Compétence: 'Design',
      Priorité: 'Haute',
      Échéance: 'vendredi 27 novembre',
      Estimation: '1,5 h',
      'Attribuée à': 'Sacha',
    })
    const empty = Object.fromEntries(
      taskDetails({ ...draft, dueDate: null, estimateHours: null, assigneeName: null, assigneeMemberId: null }).map((r) => [r.label, r.value]),
    )
    expect(empty.Échéance).toBe('Aucune')
    expect(empty['Attribuée à']).toContain('Personne')
  })

  it('ligne insérée : à faire, en fin de colonne, sans organisation (posée par la base)', () => {
    expect(taskInsert(draft, 4)).toEqual({
      project_id: 'p1',
      title: 'Refaire le menu',
      skill: 'design',
      estimate_hours: 1.5,
      due_date: '2026-11-27',
      priority: 'high',
      assignee_member_id: 'm1',
      status: 'todo',
      position: 5,
    })
    expect(taskInsert(draft, null).position).toBe(1)
  })
})
