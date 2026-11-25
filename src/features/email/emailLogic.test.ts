import { describe, expect, it } from 'vitest'
import { EMAIL_PROMISES, projectChoices } from './emailLogic'

const base = { id: '', name: '', status: 'in_progress' as const }

describe('projectChoices', () => {
  it('préfixe le client et trie par libellé', () => {
    const result = projectChoices([
      { ...base, id: '2', name: 'Site', client: { name: 'Zed' } },
      { ...base, id: '1', name: 'App', client: { name: 'Ibé' } },
    ])
    expect(result).toEqual([
      { id: '1', label: 'Ibé · App' },
      { id: '2', label: 'Zed · Site' },
    ])
  })
  it('met les projets terminés en dernier', () => {
    const result = projectChoices([
      { ...base, id: 'a', name: 'A', status: 'paid', client: null },
      { ...base, id: 'b', name: 'B', client: null },
    ])
    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
  })
  it('garde le nom seul sans client', () => {
    expect(projectChoices([{ ...base, id: 'x', name: 'Solo', client: null }])[0]?.label).toBe('Solo')
  })
  it('liste trois promesses sans tiret cadratin', () => {
    expect(EMAIL_PROMISES).toHaveLength(3)
    expect(JSON.stringify(EMAIL_PROMISES)).not.toContain('—')
  })
})
