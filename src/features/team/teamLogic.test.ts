import { describe, expect, it } from 'vitest'
import {
  buildSkills, formatCapacity, formatHours, teamStats, levelFromSelect, levelToSelect, memberStatus, parseCapacity, removalBlock,
  skillsSummary, translateMemberError, unavailableText,
} from './teamLogic'

describe('memberStatus', () => {
  it('distingue actif, invité et retiré', () => {
    expect(memberStatus({ removed_at: null, invited_at: null, user_id: 'u' })).toBe('active')
    expect(memberStatus({ removed_at: null, invited_at: '2026-01-01', user_id: null })).toBe('invited')
    expect(memberStatus({ removed_at: null, invited_at: '2026-01-01', user_id: 'u' })).toBe('active')
    expect(memberStatus({ removed_at: '2026-01-02', invited_at: '2026-01-01', user_id: null })).toBe('removed')
  })
})

describe('removalBlock', () => {
  const a = { id: 'a', role: 'admin' as const, removed_at: null }
  const b = { id: 'b', role: 'admin' as const, removed_at: null }
  const m = { id: 'm', role: 'membre' as const, removed_at: null }
  it('refuse soi-même', () => expect(removalBlock(a, 'a', [a, b])).toBe('self'))
  it('refuse le dernier admin actif', () => expect(removalBlock(a, 'm', [a, m])).toBe('last-admin'))
  it('compte seulement les admins actifs', () => expect(removalBlock(a, 'm', [a, { ...b, removed_at: 'x' }])).toBe('last-admin'))
  it('autorise sinon', () => {
    expect(removalBlock(b, 'a', [a, b])).toBeNull()
    expect(removalBlock(m, 'a', [a, m])).toBeNull()
  })
})

describe('niveaux', () => {
  it('convertit le Select', () => {
    expect(levelFromSelect('0')).toBeUndefined()
    expect(levelFromSelect('3')).toBe(3)
    expect(levelFromSelect('6')).toBeUndefined()
    expect(levelToSelect(undefined)).toBe('0')
    expect(levelToSelect(0)).toBe('0')
    expect(levelToSelect(5)).toBe('5')
  })
  it('construit les compétences sans les clés non pratiquées', () => {
    expect(buildSkills({ design: '4', dev: '0' })).toEqual({ design: 4 })
    expect(buildSkills({ design: '0', dev: '0' })).toEqual({})
  })
  it('résume', () => {
    expect(skillsSummary({ design: 4, dev: 0 }).map((s) => s.text)).toEqual(['Design 4/5'])
    expect(skillsSummary({})).toEqual([])
  })
})

describe('capacité et jours', () => {
  it('formate', () => {
    expect(formatCapacity(35)).toBe('35 h / semaine')
    expect(formatCapacity(17.5)).toBe('17,5 h / semaine')
    expect(unavailableText([])).toBeNull()
    expect(unavailableText([3])).toBe('Indisponible le mercredi')
    expect(unavailableText([5, 1])).toBe('Indisponible : lundi, vendredi')
  })
  it('valide la saisie', () => {
    expect(parseCapacity('35')).toEqual({ value: 35 })
    expect(parseCapacity('17,5')).toEqual({ value: 17.5 })
    expect(parseCapacity('')).toHaveProperty('error')
    expect(parseCapacity('81')).toHaveProperty('error')
    expect(parseCapacity('-1')).toHaveProperty('error')
    expect(parseCapacity('10.3')).toHaveProperty('error')
  })
})

describe('translateMemberError', () => {
  it('traduit le dernier admin et les droits', () => {
    expect(translateMemberError(new Error('Cannot demote the last active admin'))).toMatch(/au moins un admin/)
    expect(translateMemberError({ message: 'new row violates row-level security policy' })).toMatch(/Seuls les admins/)
    expect(translateMemberError(new Error('boom'))).toBe('Une erreur est survenue. Réessaie.')
  })
  it('reconnaît les messages de la migration 0003', () => {
    expect(translateMemberError({ message: "L'organisation doit garder au moins un admin actif" })).toMatch(/au moins un admin/)
    expect(translateMemberError({ message: "Tu ne peux pas te retirer toi-même de l'organisation" })).toMatch(/toi-même/)
    expect(translateMemberError({ message: "Réservé aux admins de l'organisation" })).toMatch(/Seuls les admins/)
  })
})

describe('teamStats', () => {
  it('compte actifs, invités et la capacité des actifs seulement', () => {
    const base = { removed_at: null, invited_at: null, user_id: 'u' as string | null }
    expect(
      teamStats([
        { ...base, weekly_capacity_hours: 35 },
        { ...base, weekly_capacity_hours: 17.5 },
        { ...base, invited_at: '2026-01-01', user_id: null, weekly_capacity_hours: 35 },
        { ...base, removed_at: '2026-01-02', weekly_capacity_hours: 35 },
      ]),
    ).toEqual({ active: 2, invited: 1, weeklyHours: 52.5 })
  })
  it('formate les heures', () => {
    expect(formatHours(70)).toBe('70 h')
    expect(formatHours(52.5)).toBe('52,5 h')
  })
})
