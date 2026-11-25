/** Logique pure du formulaire de brief : contenu ⇄ texte saisi (une ligne par point). */
import { normalizeBrief } from '../../shared/ai/brief'
import type { BriefContent } from '../../shared/types'

export interface BriefForm {
  contexte: string
  objectifs: string
  livrables: string
  contraintes: string
  budget: string
  delais: string
  questions: string
}

const toLines = (items: readonly string[]): string => items.join('\n')
const fromLines = (text: string): string[] => text.split('\n')

export function briefToForm(content: BriefContent): BriefForm {
  return {
    contexte: content.contexte,
    objectifs: toLines(content.objectifs),
    livrables: toLines(content.livrables),
    contraintes: toLines(content.contraintes),
    budget: content.budget ?? '',
    delais: content.delais ?? '',
    questions: toLines(content.questions_ouvertes),
  }
}

export function formToBrief(form: BriefForm): BriefContent {
  return normalizeBrief({
    contexte: form.contexte,
    objectifs: fromLines(form.objectifs),
    livrables: fromLines(form.livrables),
    contraintes: fromLines(form.contraintes),
    budget: form.budget,
    delais: form.delais,
    questions_ouvertes: fromLines(form.questions),
  })
}

export function formChanged(form: BriefForm, content: BriefContent): boolean {
  return JSON.stringify(formToBrief(form)) !== JSON.stringify(normalizeBrief(content))
}

/** Rubriques en lecture : titre + points, sans les rubriques vides. */
export interface BriefSection {
  key: string
  title: string
  text?: string
  items?: string[]
}

export function briefSections(content: BriefContent): BriefSection[] {
  const sections: BriefSection[] = [
    { key: 'contexte', title: 'Contexte', text: content.contexte },
    { key: 'objectifs', title: 'Objectifs', items: content.objectifs },
    { key: 'livrables', title: 'Livrables', items: content.livrables },
    { key: 'contraintes', title: 'Contraintes', items: content.contraintes },
    { key: 'budget', title: 'Budget', text: content.budget ?? '' },
    { key: 'delais', title: 'Délais', text: content.delais ?? '' },
    { key: 'questions', title: 'Questions ouvertes', items: content.questions_ouvertes },
  ]
  return sections.filter((s) => (s.text ?? '').trim() !== '' || (s.items?.length ?? 0) > 0)
}
