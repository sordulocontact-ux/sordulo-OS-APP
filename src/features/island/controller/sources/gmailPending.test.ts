import { describe, expect, it } from 'vitest'
import { createNotification } from '../../catalog'
import { IslandCoordinator } from '../../coordinator'
import { FakeClock } from '../../coordinator/fakeClock'
import type { ClaudeSession } from '../../types'
import {
  REMINDER_DELAY_MS,
  isCalmHour,
  isCalmMoment,
  islandIsIdle,
  parsePending,
  pendingStorageKey,
  reminderCandidates,
  reminderParams,
  serializePending,
  type PendingMail,
} from './gmailPending'

function mail(id: string, fields: Partial<PendingMail> = {}): PendingMail {
  return {
    messageId: id,
    gmailId: `g-${id}`,
    clientId: 'c-1',
    clientName: 'Ibé',
    projectId: 'p-1',
    subject: `Objet ${id}`,
    receivedAt: 1000,
    proposedAt: 0,
    stage: 'proposed',
    ...fields,
  }
}

function session(status: ClaudeSession['status']): ClaudeSession {
  return {
    id: 's-1',
    projectName: 'Sordulo OS',
    projectId: null,
    cwd: '/x',
    branch: null,
    task: null,
    step: null,
    status,
    startedAt: 0,
    conflict: false,
    error: false,
    subagents: 0,
  }
}

describe('stockage des mails en attente', () => {
  it('clé par utilisateur', () => {
    expect(pendingStorageKey('u-1')).toBe('sordulo.island.gmail.pending.u-1')
  })

  it('aller-retour ; seuls les mails à relancer sont repris, sans doublon', () => {
    const raw = serializePending([mail('a'), mail('b', { stage: 'reminded' }), mail('c', { stage: 'replay' }), mail('a')])
    expect(parsePending(raw)).toEqual([mail('a')])
    expect(serializePending([])).toBeNull()
  })

  it('rien que des identifiants, le client, l’objet et des dates', () => {
    const raw = serializePending([{ ...mail('a'), body: 'contenu secret' } as PendingMail]) ?? ''
    expect(raw).not.toContain('contenu secret')
    expect(Object.keys((JSON.parse(raw) as { mails: object[] }).mails[0] ?? {}).sort()).toEqual(
      ['clientId', 'clientName', 'gmailId', 'messageId', 'projectId', 'proposedAt', 'receivedAt', 'stage', 'subject'].sort(),
    )
  })

  it('texte illisible ou lignes invalides : ignorés', () => {
    expect(parsePending(null)).toEqual([])
    expect(parsePending('{pas du json')).toEqual([])
    expect(parsePending(JSON.stringify({ mails: [{ messageId: 'x' }, mail('ok')] }))).toEqual([mail('ok')])
  })
})

describe('moment calme', () => {
  it('heures : de 9 h à 19 h', () => {
    expect(isCalmHour(8)).toBe(false)
    expect(isCalmHour(9)).toBe(true)
    expect(isCalmHour(18)).toBe(true)
    expect(isCalmHour(19)).toBe(false)
  })

  it('île au repos : ni notification, ni appel, ni état du contrôleur', () => {
    const coordinator = new IslandCoordinator({ clock: new FakeClock() })
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(true)
    coordinator.addActivity({ id: 'music', kind: 'music' })
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(true)
    coordinator.notify(createNotification('pathCopied', { fileName: 'a.txt' }))
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(false)
    coordinator.endNotification()
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(true)
    coordinator.showOverlay('review')
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(false)
    coordinator.hideOverlay('review')
    coordinator.addActivity({ id: 'meet', kind: 'meet', appName: 'Meet', service: null, projectId: null, projectName: null, startedAt: 0 })
    expect(islandIsIdle(coordinator.getSnapshot())).toBe(false)
  })

  it('demande Claude en attente (même mise de côté) : pas calme', () => {
    const snapshot = new IslandCoordinator({ clock: new FakeClock() }).getSnapshot()
    expect(isCalmMoment(snapshot, [session('working')], 10)).toBe(true)
    expect(isCalmMoment(snapshot, [session('waiting')], 10)).toBe(false)
    expect(isCalmMoment(snapshot, [], 20)).toBe(false)
  })
})

describe('relance', () => {
  it('au moins une heure après la première proposition, tous les mails proposés, du plus ancien au plus récent', () => {
    const mails = [mail('b', { proposedAt: 1000, receivedAt: 20 }), mail('a', { proposedAt: 0, receivedAt: 10 }), mail('c', { stage: 'reminded' })]
    expect(reminderCandidates(mails, REMINDER_DELAY_MS - 1)).toEqual([])
    expect(reminderCandidates(mails, REMINDER_DELAY_MS).map((m) => m.messageId)).toEqual(['a', 'b'])
    expect(reminderCandidates([], REMINDER_DELAY_MS)).toEqual([])
  })

  it('paramètres : nombre, clients sans doublon, le premier', () => {
    expect(reminderParams([mail('a'), mail('b', { clientName: 'Sordulo' }), mail('c')])).toEqual({
      count: 3,
      clientNames: ['Ibé', 'Sordulo'],
      first: { clientName: 'Ibé', subject: 'Objet a' },
    })
  })
})
