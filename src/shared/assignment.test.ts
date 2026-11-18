import { describe, expect, it } from 'vitest'
import {
  addToWorkload,
  areaKey,
  emptyWorkload,
  pickAssignee,
  pickTicketAssignee,
  skillLevel,
  ticketHours,
} from './assignment.js'

const mael = { id: 'm-1', name: 'Maël', skills: { dev: 5, design: 2 } }
const sacha = { id: 's-1', name: 'Sacha', skills: { design: 5, dev: 1 } }

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
