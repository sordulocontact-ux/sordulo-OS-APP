import { describe, expect, it } from 'vitest'
import { EMPTY_BRIEF } from '../../shared/ai/brief'
import { briefSections, briefToForm, formChanged, formToBrief } from './briefLogic'

const content = { ...EMPTY_BRIEF, contexte: 'Ctx', objectifs: ['a', 'b'], budget: '5 k€' }

describe('briefLogic', () => {
  it('fait l’aller-retour contenu / formulaire', () => {
    expect(formToBrief(briefToForm(content))).toEqual(content)
  })
  it('nettoie la saisie', () => {
    const form = { ...briefToForm(content), objectifs: ' a \n\n b ', budget: ' ' }
    expect(formToBrief(form)).toMatchObject({ objectifs: ['a', 'b'], budget: null })
  })
  it('détecte une modification', () => {
    expect(formChanged(briefToForm(content), content)).toBe(false)
    expect(formChanged({ ...briefToForm(content), contexte: 'Autre' }, content)).toBe(true)
  })
  it('omet les rubriques vides', () => {
    expect(briefSections(content).map((s) => s.key)).toEqual(['contexte', 'objectifs', 'budget'])
  })
})
