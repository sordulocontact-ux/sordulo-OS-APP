import { describe, expect, it } from 'vitest'
import { pickAssignee, skillLevel } from './assignment.js'

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
