import { describe, expect, it } from 'vitest'
import { formatDraft, mailtoLink, parseDraft } from './followupDraft.js'

describe('brouillon de relance', () => {
  it('formate puis relit objet et corps', () => {
    const text = formatDraft({ subject: '  Devis   D-2026-001 ', body: 'Bonjour,\n\nMerci.\n' })
    expect(text).toBe('Objet : Devis D-2026-001\n\nBonjour,\n\nMerci.')
    expect(parseDraft(text)).toEqual({ subject: 'Devis D-2026-001', body: 'Bonjour,\n\nMerci.' })
  })
  it('traite un texte sans objet comme un corps', () => {
    expect(parseDraft('Bonjour tout le monde')).toEqual({ subject: '', body: 'Bonjour tout le monde' })
  })
  it('construit un mailto encodé', () => {
    const link = mailtoLink('camille@ibe.test', { subject: 'Devis & suite', body: 'Bonjour,\nMerci' })
    expect(link).toBe('mailto:camille@ibe.test?subject=Devis%20%26%20suite&body=Bonjour%2C%0AMerci')
  })
  it('laisse le destinataire vide sans email', () => {
    expect(mailtoLink(null, { subject: 'a', body: 'b' }).startsWith('mailto:?')).toBe(true)
  })
})
