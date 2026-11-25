import { describe, expect, it } from 'vitest'
import { caseStudyBlock, caseStudyToMarkdown, supportedResults, verifiedQuote } from '../../shared/ai/caseStudy'
import { caseStudyAvailability, caseStudyFromForm, formFromCaseStudy, hasCaseStudyChanges } from './showcaseLogic'

describe('caseStudyAvailability', () => {
  it('propose seulement si montrable et livré ou payé', () => {
    expect(caseStudyAvailability({ showcase: 'showable', status: 'delivered' }).kind).toBe('ready')
    expect(caseStudyAvailability({ showcase: 'showable', status: 'paid' }).kind).toBe('ready')
    expect(caseStudyAvailability({ showcase: 'showable', status: 'in_progress' }).kind).toBe('blocked')
    expect(caseStudyAvailability({ showcase: 'unknown', status: 'paid' }).kind).toBe('blocked')
  })
  it('sous NDA : refusé avec mention claire', () => {
    const a = caseStudyAvailability({ showcase: 'nda', status: 'paid' })
    expect(a).toMatchObject({ kind: 'blocked', nda: true })
    expect(a.kind === 'blocked' && a.reason).toContain('NDA')
    expect(caseStudyBlock({ showcase: 'nda', status: 'paid' })).toBe('nda')
  })
})

describe('formulaire', () => {
  it('aller-retour en gardant livrables et fichiers', () => {
    const cs = { title: 'T', summary: 'S', deliverables: ['A'], file_ids: ['f'], status: 'draft' as const, client_quote: { text: 'Bravo', author: 'C' } }
    const form = formFromCaseStudy(cs)
    expect(hasCaseStudyChanges(form, formFromCaseStudy(cs))).toBe(false)
    const saved = caseStudyFromForm({ ...form, ready: true, quoteText: ' ' }, cs)
    expect(saved).toMatchObject({ deliverables: ['A'], file_ids: ['f'], status: 'ready', client_quote: null })
  })
})

describe('contrôles de l’étude', () => {
  it('écarte un résultat avec un chiffre absent des données', () => {
    expect(supportedResults(['Conversion x3', 'Livré en 12 jours'], 'livraison en 12 jours')).toEqual(['Livré en 12 jours'])
    expect(supportedResults(['Site plus clair'], '')).toEqual(['Site plus clair'])
  })
  it('garde une citation seulement si elle est dans un commentaire', () => {
    const comments = [{ body: 'Super boulot, vraiment !', author: 'Claire' }]
    expect(verifiedQuote({ text: 'Super boulot', author: null }, comments)).toEqual({ text: 'Super boulot', author: 'Claire' })
    expect(verifiedQuote({ text: 'Génial', author: 'Claire' }, comments)).toBeNull()
    expect(verifiedQuote(null, comments)).toBeNull()
  })
  it('exporte en Markdown', () => {
    const md = caseStudyToMarkdown({ title: 'Titre', summary: 'Accroche', challenge: 'Défi', deliverables: ['Site'], client_quote: { text: 'Top', author: 'Claire' } })
    expect(md).toContain('# Titre')
    expect(md).toContain('## Défi')
    expect(md).toContain('- Site')
    expect(md).toContain('> Top')
    expect(md).not.toContain('## Contexte')
  })
})
