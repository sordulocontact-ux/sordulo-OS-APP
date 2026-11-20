import { describe, expect, it } from 'vitest'
import type { ClaudeSession, IslandNotification, IslandSnapshot } from '../types'
import { formatElapsed, islandLabel, sessionsSummary, sessionsTitle } from './labels'

const snap = (over: Partial<IslandSnapshot>): IslandSnapshot => ({
  state: 'repos',
  primary: null,
  secondary: null,
  activityCount: 0,
  pinnedId: null,
  notification: null,
  withCall: false,
  ask: null,
  askPosition: null,
  focusMode: false,
  ...over,
})

const session = (status: ClaudeSession['status']): ClaudeSession => ({
  id: status,
  projectName: 'PDS OS',
  projectId: null,
  cwd: 'C:/pds',
  branch: null,
  task: null,
  step: null,
  status,
  startedAt: 0,
  conflict: false,
  error: false,
  subagents: 0,
})

describe('formatElapsed', () => {
  it('formats mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65_400)).toBe('01:05')
    expect(formatElapsed(-10)).toBe('00:00')
  })
})

describe('sessionsSummary', () => {
  it('counts like the prototype', () => {
    const list = [session('working'), session('working'), session('waiting'), session('done'), session('idle')]
    expect(sessionsSummary(list)).toBe('2 en cours, 1 à autoriser, 1 en pause, 1 terminée')
    expect(sessionsTitle(5)).toBe('5 sessions Claude Code')
  })
})

describe('islandLabel', () => {
  it('uses the prototype labels', () => {
    expect(islandLabel(snap({}), 0, null)).toBe('Repos')
    expect(islandLabel(snap({ state: 'meet' }), 0, null)).toBe('Appel en cours')
    expect(islandLabel(snap({ state: 'multi' }), 3, null)).toBe('3 sessions Claude Code')
    expect(islandLabel(snap({ state: 'appel' }), 0, 'Discord')).toBe('Appel détecté dans Discord')
    expect(islandLabel(snap({ state: 'appel' }), 0, '')).toBe('Enregistrer un appel')
    expect(islandLabel(snap({ state: 'appel' }), 0, null)).toBe('Appel détecté')
    expect(islandLabel(snap({ state: 'dragOver' }), 0, null)).toBe('Dépôt d’un fichier')
  })

  it('announces the notification content', () => {
    const notification: IslandNotification = {
      id: 'n1',
      kind: 'tickets',
      visual: { type: 'icon', icon: 'tickets' },
      tone: 'neutral',
      title: '6 tickets à valider',
      subtitle: 'Call Ibé, PDS OS',
      button: 'Valider',
      action: { type: 'dismiss' },
      durationMs: 7000,
      interrupt: false,
    }
    expect(islandLabel(snap({ state: 'notif', notification, withCall: true }), 0, null)).toBe(
      'Notification pendant un appel : 6 tickets à valider, Call Ibé, PDS OS',
    )
  })

  it('uses the progress label', () => {
    const primary = {
      id: 'prog:upload',
      order: 1,
      kind: 'progress' as const,
      stage: 'upload' as const,
      label: 'Import de l’audio',
      fraction: null,
      startedAt: 0,
      estimatedMs: 3200,
    }
    expect(islandLabel(snap({ state: 'progress', primary }), 0, null)).toBe('Import de l’audio')
  })
})
