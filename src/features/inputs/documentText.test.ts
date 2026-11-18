import { describe, expect, it } from 'vitest'
import { documentKind, normalizeText, titleFromFileName } from './documentText'

describe('documentKind', () => {
  it('reconnaît PDF, Word et texte', () => {
    expect(documentKind('Ticket Ibé.PDF')).toBe('pdf')
    expect(documentKind('sans-extension', 'application/pdf')).toBe('pdf')
    expect(documentKind('retours.docx')).toBe('docx')
    expect(documentKind('mail.eml')).toBe('text')
    expect(documentKind('notes', 'text/plain')).toBe('text')
  })
  it('refuse le reste', () => {
    expect(documentKind('ancien.doc')).toBeNull()
    expect(documentKind('capture.png', 'image/png')).toBeNull()
  })
})

describe('titleFromFileName', () => {
  it('retire l’extension', () => {
    expect(titleFromFileName('Retours Ibé v2.pdf')).toBe('Retours Ibé v2')
    expect(titleFromFileName('ticket_paiement_mars.docx')).toBe('ticket paiement mars')
  })
})

describe('normalizeText', () => {
  it('nettoie les espaces et les lignes vides', () => {
    expect(normalizeText('  Bonjour \r\n\r\n\r\n\tle  bouton   plante \n')).toBe('Bonjour\n\nle bouton plante')
  })
  it('retire le HTML', () => {
    expect(normalizeText('<p>Bonjour&nbsp;!</p><script>x()</script><p>Le <b>panier</b> plante</p>', 'html')).toBe(
      'Bonjour !\nLe panier plante',
    )
  })
})
