/** Action IA « brief » : entrée (réunion ou retour) → brief structuré (POST /api/ai/run, action brief). */
import { z } from 'zod'
import type { Brief, BriefContent } from '../types.js'

export interface BriefRequest {
  inputId: string
}

export interface BriefResponse {
  brief: Brief
}

/** Sortie structurée de Claude (contraintes compatibles avec l'API : types seulement). */
export const BriefOutputSchema = z.object({
  contexte: z.string(),
  objectifs: z.array(z.string()),
  livrables: z.array(z.string()),
  contraintes: z.array(z.string()),
  budget: z.string().nullable(),
  delais: z.string().nullable(),
  questions_ouvertes: z.array(z.string()),
})

export const EMPTY_BRIEF: BriefContent = {
  contexte: '',
  objectifs: [],
  livrables: [],
  contraintes: [],
  budget: null,
  delais: null,
  questions_ouvertes: [],
}

const cleanList = (items: readonly string[]): string[] => items.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s !== '')
const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}

/** Nettoie un contenu de brief : textes rognés, lignes vides retirées, champ absent = vide ou null. */
export function normalizeBrief(content: Partial<BriefContent>): BriefContent {
  return {
    contexte: content.contexte?.trim() ?? '',
    objectifs: cleanList(content.objectifs ?? []),
    livrables: cleanList(content.livrables ?? []),
    contraintes: cleanList(content.contraintes ?? []),
    budget: cleanText(content.budget),
    delais: cleanText(content.delais),
    questions_ouvertes: cleanList(content.questions_ouvertes ?? []),
  }
}

/** Vrai si le brief ne contient rien. */
export function isBriefEmpty(content: BriefContent): boolean {
  return (
    content.contexte.trim() === '' &&
    content.objectifs.length === 0 &&
    content.livrables.length === 0 &&
    content.contraintes.length === 0 &&
    !content.budget &&
    !content.delais &&
    content.questions_ouvertes.length === 0
  )
}
