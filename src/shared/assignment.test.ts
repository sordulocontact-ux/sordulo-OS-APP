import { describe, expect, it } from 'vitest'
import {
  addToWorkload,
  areaKey,
  assignmentCandidates,
  canBeAutoAssigned,
  emptyWorkload,
  pickAssignee,
  parisWeekday,
  pickTicketAssignee,
  skillLevel,
  ticketHours,
} from './assignment.js'
import type { Weekday } from './types.js'

const mael = { id: 'm-1', name: 'Maël', skills: { dev: 5, design: 2 }, weekly_capacity_hours: 35, unavailable_weekdays: [] as Weekday[] }
const sacha = { id: 's-1', name: 'Sacha', skills: { design: 5, dev: 1 }, weekly_capacity_hours: 35, unavailable_weekdays: [] as Weekday[] }

describe('pickAssignee', () => {
  it('donne le design à Sacha et le dev à Maël', () => {
    expect(pickAssignee('design', [mael, sacha])?.id).toBe('s-1')
    expect(pickAssignee('dev', [mael, sacha])?.id).toBe('m-1')
    expect(pickAssignee('dev', [sacha, mael])?.id).toBe('m-1')
  })

  it("renvoie null s'il n'y a aucun membre", () => {
    expect(pickAssignee('dev', [])).toBeNull()
  })

  it('départage une égalité par le nom puis par l’id, quel que soit l’ordre', () => {
    const zoe = { id: 'z', name: 'Zoé', skills: { dev: 3 } }
    const anna = { id: 'b', name: 'Anna', skills: { dev: 3 } }
    const anna2 = { id: 'a', name: 'Anna', skills: { dev: 3 } }
    expect(pickAssignee('dev', [zoe, anna, anna2])?.id).toBe('a')
    expect(pickAssignee('dev', [anna2, zoe, anna])?.id).toBe('a')
    expect(pickAssignee('dev', [anna, anna2, zoe])?.id).toBe('a')
  })

  it('compte une compétence absente comme 0', () => {
    const noSkills = { id: 'x', name: 'Aline', skills: {} }
    const low = { id: 'y', name: 'Zed', skills: { design: 1 } }
    expect(pickAssignee('design', [noSkills, low])?.id).toBe('y')
    expect(skillLevel(noSkills, 'design')).toBe(0)
  })

  it('choisit quand même quelqu’un si personne n’a la compétence', () => {
    const a = { id: '2', name: 'Bob', skills: {} }
    const b = { id: '1', name: 'Alice', skills: {} }
    expect(pickAssignee('design', [a, b])?.id).toBe('1')
  })
})

describe('pickTicketAssignee', () => {
  it('donne le ticket à la personne la moins chargée, quelle que soit la compétence', () => {
    const load = emptyWorkload()
    addToWorkload(load, 'm-1', 10, null)
    addToWorkload(load, 's-1', 2, null)
    const picked = pickTicketAssignee([mael, sacha], { area: 'Finance' }, load)
    expect(picked?.member.id).toBe('s-1')
    expect(picked?.note).toContain('le moins de travail en cours (2 h)')
  })

  it("préfère qui connaît déjà la partie, dans la limite du bonus d'habitude", () => {
    const load = emptyWorkload()
    addToWorkload(load, 'm-1', 6, null)
    addToWorkload(load, 's-1', 2, null)
    // Maël a déjà fait 2 tickets « Finance » : 6 h - 2 × 3 h = 0 < 2 h.
    addToWorkload(load, 'm-1', 0, 'Finance')
    addToWorkload(load, 'm-1', 0, 'finance ')
    const picked = pickTicketAssignee([mael, sacha], { area: 'Finance' }, load)
    expect(picked?.member.id).toBe('m-1')
    expect(picked?.note).toContain('a déjà travaillé sur « Finance » (2 tickets)')
    // Beaucoup plus chargé : l'habitude ne suffit plus (bonus plafonné à 3 tickets).
    addToWorkload(load, 'm-1', 20, null)
    expect(pickTicketAssignee([mael, sacha], { area: 'Finance' }, load)?.member.id).toBe('s-1')
  })

  it('répartit les tickets d’une même analyse au fil de l’eau', () => {
    const load = emptyWorkload()
    const first = pickTicketAssignee([mael, sacha], { area: null }, load)
    expect(first?.member.id).toBe('m-1')
    addToWorkload(load, first!.member.id, 4, null)
    expect(pickTicketAssignee([mael, sacha], { area: null }, load)?.member.id).toBe('s-1')
  })

  it("renvoie null sans membre et compte 1 h pour une tâche sans estimation", () => {
    expect(pickTicketAssignee([], { area: null }, emptyWorkload())).toBeNull()
    expect(ticketHours([{ estimate_hours: 2 }, { estimate_hours: null }])).toBe(3)
    expect(areaKey('  Page  d’Accueil ')).toBe('page d’accueil')
    expect(areaKey('Équipe')).toBe('equipe')
    expect(areaKey('  ')).toBeNull()
  })
})

describe('assignmentCandidates', () => {
  const base = { removed_at: null }
  const admin = { ...base, id: 'a', role: 'admin' as const }
  const membre = { ...base, id: 'b', role: 'membre' as const }
  const prospection = { ...base, id: 'c', role: 'prospection' as const }
  const finance = { ...base, id: 'f', role: 'finance' }
  const retire = { id: 'd', role: 'membre' as const, removed_at: '2026-11-20T10:00:00Z' }
  const team = [admin, membre, prospection, retire]

  it('garde les membres actifs hors prospection quand le projet n’a pas de membres affectés', () => {
    expect(assignmentCandidates(team, []).map((m) => m.id)).toEqual(['a', 'b'])
    expect(canBeAutoAssigned(prospection)).toBe(false)
    expect(canBeAutoAssigned(retire)).toBe(false)
    expect(canBeAutoAssigned(admin)).toBe(true)
    expect(canBeAutoAssigned(finance)).toBe(false)
  })

  it('se limite aux membres du projet, toujours actifs et hors prospection', () => {
    expect(assignmentCandidates(team, ['b', 'c', 'd']).map((m) => m.id)).toEqual(['b'])
    expect(assignmentCandidates(team, ['a', 'b']).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('retombe sur toute l’équipe attribuable si aucun membre du projet ne l’est', () => {
    expect(assignmentCandidates(team, ['c', 'd']).map((m) => m.id)).toEqual(['a', 'b'])
    expect(assignmentCandidates(team, ['inconnu']).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('renvoie une liste vide sans membre attribuable : le ticket reste sans personne', () => {
    const candidates = assignmentCandidates([prospection, retire], ['c'])
    expect(candidates).toEqual([])
    const named = candidates.map((m) => ({ ...m, name: m.id, skills: {}, weekly_capacity_hours: 35 }))
    expect(pickTicketAssignee(named, { area: null }, emptyWorkload())).toBeNull()
  })
})

describe('pickTicketAssignee : charge relative, capacité et disponibilité', () => {
  const MONDAY = 1 as Weekday
  const half = { id: 'h', name: 'Hugo', skills: {}, weekly_capacity_hours: 17.5, unavailable_weekdays: [] as Weekday[] }
  const full = { id: 'f', name: 'Zoé', skills: {}, weekly_capacity_hours: 35, unavailable_weekdays: [] as Weekday[] }

  it('compare la charge rapportée à la capacité, pas les heures brutes', () => {
    const load = emptyWorkload()
    addToWorkload(load, 'f', 20, null) // 20 / 35 = 0,57
    addToWorkload(load, 'h', 8, null) // 8 / 17,5 = 0,46 : moins d'heures ET moins chargé
    expect(pickTicketAssignee([full, half], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('h')
    // 12 h sur 17,5 h = 0,69 > 0,57 : Hugo a moins d'heures mais est plus chargé en relatif.
    addToWorkload(load, 'h', 4, null)
    expect(pickTicketAssignee([full, half], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('f')
  })

  it('compte les heures du ticket dans la charge relative', () => {
    const load = emptyWorkload()
    addToWorkload(load, 'f', 10, null) // (10 + 10) / 35 = 0,57
    addToWorkload(load, 'h', 4, null) // (4 + 10) / 17,5 = 0,8
    expect(pickTicketAssignee([full, half], { area: null, hours: 10 }, load, { weekday: MONDAY })?.member.id).toBe('f')
  })

  it('garde le bonus d’habitude (en heures, plafonné) dans la charge relative', () => {
    const load = emptyWorkload()
    addToWorkload(load, 'f', 10, null)
    addToWorkload(load, 'h', 4, null)
    for (let i = 0; i < 5; i += 1) addToWorkload(load, 'f', 0, 'Finance')
    // Sans habitude Hugo gagne (0,23 < 0,29) ; avec 3 tickets Finance, Zoé passe à (10 - 9) / 35 = 0,03.
    expect(pickTicketAssignee([full, half], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('h')
    const picked = pickTicketAssignee([full, half], { area: 'Finance' }, load, { weekday: MONDAY })
    expect(picked?.member.id).toBe('f')
    expect(picked?.note).toContain('a déjà travaillé sur « Finance » (5 tickets)')
  })

  it('départage une égalité exacte par le nom puis l’id', () => {
    const load = emptyWorkload()
    addToWorkload(load, 'f', 20, null)
    addToWorkload(load, 'h', 10, null) // 20/35 = 10/17,5
    expect(pickTicketAssignee([full, half], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('h')
    expect(pickTicketAssignee([half, full], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('h')
  })

  it('n’attribue jamais à une capacité 0, absente ou non finie', () => {
    const zero = { ...half, id: 'z0', name: 'Aaron', weekly_capacity_hours: 0 }
    const none = { id: 'n', name: 'Abel', skills: {} }
    const nan = { ...half, id: 'nan', name: 'Alice', weekly_capacity_hours: Number.NaN }
    expect(pickTicketAssignee([zero, none, nan, full], { area: null }, emptyWorkload(), { weekday: MONDAY })?.member.id).toBe('f')
    expect(pickTicketAssignee([zero, none, nan], { area: null }, emptyWorkload(), { weekday: MONDAY })).toBeNull()
  })

  it('relègue un membre indisponible aujourd’hui, même s’il est le moins chargé', () => {
    const away = { ...half, id: 'a', name: 'Aline', unavailable_weekdays: [MONDAY] }
    const load = emptyWorkload()
    addToWorkload(load, 'f', 30, null)
    expect(pickTicketAssignee([away, full], { area: null }, load, { weekday: MONDAY })?.member.id).toBe('f')
    // Un autre jour, elle est disponible et gagne.
    expect(pickTicketAssignee([away, full], { area: null }, load, { weekday: 2 })?.member.id).toBe('a')
  })

  it('choisit le moins chargé quand tous les candidats sont indisponibles aujourd’hui', () => {
    const a = { ...half, id: 'a', name: 'Aline', unavailable_weekdays: [MONDAY] }
    const b = { ...full, unavailable_weekdays: [MONDAY, 2 as Weekday] }
    const load = emptyWorkload()
    addToWorkload(load, 'f', 5, null)
    addToWorkload(load, 'a', 10, null)
    const picked = pickTicketAssignee([a, b], { area: null }, load, { weekday: MONDAY })
    expect(picked?.member.id).toBe('f')
    expect(picked?.note).toContain('tout le monde')
  })

  it('lit le jour dans la date injectée, à l’heure de Paris', () => {
    const away = { ...half, id: 'a', name: 'Aline', unavailable_weekdays: [1 as Weekday] }
    // Dimanche 22/11/2026 23:30 UTC = lundi 23/11 00:30 à Paris.
    const monday = new Date('2026-11-22T23:30:00Z')
    expect(pickTicketAssignee([away, full], { area: null }, emptyWorkload(), { today: monday })?.member.id).toBe('f')
  })
})

describe('parisWeekday', () => {
  it('donne 1 = lundi … 7 = dimanche', () => {
    expect(parisWeekday(new Date('2026-11-20T12:00:00Z'))).toBe(5) // vendredi
    expect(parisWeekday(new Date('2026-11-22T12:00:00Z'))).toBe(7) // dimanche
    expect(parisWeekday(new Date('2026-11-23T12:00:00Z'))).toBe(1) // lundi
  })

  it('bascule à minuit heure de Paris, pas à minuit UTC', () => {
    expect(parisWeekday(new Date('2026-11-22T22:59:59Z'))).toBe(7) // 23:59:59 à Paris (UTC+1)
    expect(parisWeekday(new Date('2026-11-22T23:00:00Z'))).toBe(1) // 00:00 lundi à Paris
    expect(parisWeekday(new Date('2026-07-12T21:59:59Z'))).toBe(7) // été (UTC+2) : 23:59:59
    expect(parisWeekday(new Date('2026-07-12T22:00:00Z'))).toBe(1)
  })
})
