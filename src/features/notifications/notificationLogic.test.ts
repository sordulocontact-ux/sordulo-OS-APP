import { describe, expect, it } from 'vitest'
import { NOTIFICATION_KINDS } from '../../shared/types'
import { bellLabel, notificationKindInfo, notificationMatches, safeLink, timeAgo, unreadBadgeText } from './notificationLogic'

describe('notificationKindInfo', () => {
  it('chaque type de la base a un libellé et une icône', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const info = notificationKindInfo(kind)
      expect(info.label).not.toBe('')
      expect(info.icon).not.toBe('default')
    }
    expect(notificationKindInfo('task.assigned')).toEqual({ label: 'Tâche attribuée', icon: 'task' })
  })

  it('type inconnu : famille du préfixe, sinon générique', () => {
    expect(notificationKindInfo('invoice.overdue')).toEqual({ label: 'Facture', icon: 'billing' })
    expect(notificationKindInfo('prospect.recap')).toEqual({ label: 'Prospection', icon: 'prospect' })
    expect(notificationKindInfo('weekly_recap')).toEqual({ label: 'Notification', icon: 'default' })
    expect(notificationKindInfo('toString')).toEqual({ label: 'Notification', icon: 'default' })
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-11-25T15:00:00Z') // 16 h à Paris

  it('minutes et heures du jour', () => {
    expect(timeAgo('2026-11-25T14:59:30Z', now)).toBe('à l’instant')
    expect(timeAgo('2026-11-25T14:55:00Z', now)).toBe('il y a 5 min')
    expect(timeAgo('2026-11-25T12:00:00Z', now)).toBe('il y a 3 h')
  })

  it('hier, puis jours, puis date', () => {
    expect(timeAgo('2026-11-24T20:00:00Z', now)).toBe('hier')
    expect(timeAgo('2026-11-22T10:00:00Z', now)).toBe('il y a 3 j')
    expect(timeAgo('2026-11-12T10:00:00Z', now)).toBe('12 nov.')
    expect(timeAgo('2025-11-12T10:00:00Z', now)).toBe('12 nov. 2025')
    expect(timeAgo('pas une date', now)).toBe('')
  })

  it('juste après minuit à Paris, la veille est « hier »', () => {
    const night = new Date('2026-11-25T00:30:00Z') // 1 h 30 à Paris
    expect(timeAgo('2026-11-24T21:00:00Z', night)).toBe('hier')
  })
})

describe('pastille et libellés', () => {
  it('pastille', () => {
    expect(unreadBadgeText(0)).toBeNull()
    expect(unreadBadgeText(3)).toBe('3')
    expect(unreadBadgeText(120)).toBe('99+')
  })

  it('nom accessible', () => {
    expect(bellLabel(0)).toBe('Notifications')
    expect(bellLabel(1)).toBe('Notifications, 1 non lue')
    expect(bellLabel(4)).toBe('Notifications, 4 non lues')
  })

  it('recherche sans accents ni casse', () => {
    const n = { title: 'Offre prête pour Ibé', body: null, kind: 'prospect.offer_ready' }
    expect(notificationMatches(n, 'ibe')).toBe(true)
    expect(notificationMatches(n, 'PRETE')).toBe(true)
    expect(notificationMatches(n, 'facture')).toBe(false)
    expect(notificationMatches(n, '  ')).toBe(true)
  })

  it('lien interne seulement', () => {
    expect(safeLink('/proposals')).toBe('/proposals')
    expect(safeLink('//evil.test')).toBeNull()
    expect(safeLink('https://evil.test')).toBeNull()
    expect(safeLink(null)).toBeNull()
  })
})
