import { describe, expect, it } from 'vitest'
import {
  canDeleteContract,
  canTransition,
  contractStoragePath,
  filterContracts,
  isContractLocked,
  isPdf,
  parseMarkdown,
  safeFileName,
  validateSignature,
  type ContractWithLinks,
} from './contractLogic'

const base = { id: '1', title: 'Contrat Refonte', status: 'draft', client: { id: 'c', name: 'Ibé' }, project: { id: 'p', name: 'App' }, created_at: '2026-01-01' }
const c = (over: Partial<ContractWithLinks>): ContractWithLinks => ({ ...base, ...over }) as ContractWithLinks

describe('statuts', () => {
  it('signé et annulé sont figés', () => {
    expect(isContractLocked('signed')).toBe(true)
    expect(isContractLocked('cancelled')).toBe(true)
    expect(isContractLocked('draft')).toBe(false)
  })
  it('transitions', () => {
    expect(canTransition('draft', 'send')).toBe(true)
    expect(canTransition('sent', 'send')).toBe(false)
    expect(canTransition('sent', 'sign')).toBe(true)
    expect(canTransition('signed', 'sign')).toBe(false)
    expect(canTransition('signed', 'cancel')).toBe(true)
    expect(canTransition('cancelled', 'cancel')).toBe(false)
  })
  it('seul un brouillon se supprime', () => {
    expect(canDeleteContract('draft')).toBe(true)
    expect(canDeleteContract('sent')).toBe(false)
  })
})

describe('validateSignature', () => {
  it('exige un nom et une date passée', () => {
    expect(validateSignature({ name: ' ', date: '2026-11-20' }, '2026-11-25').name).toBeDefined()
    expect(validateSignature({ name: 'Claire', date: '' }, '2026-11-25').date).toBeDefined()
    expect(validateSignature({ name: 'Claire', date: '2026-12-01' }, '2026-11-25').date).toContain('futur')
    expect(validateSignature({ name: 'Claire', date: '2026-11-25' }, '2026-11-25')).toEqual({})
  })
})

describe('filterContracts', () => {
  it('filtre par statut et par recherche sans accents', () => {
    const list = [c({ id: 'a' }), c({ id: 'b', status: 'signed', client: { id: 'x', name: 'Éclair' } })]
    expect(filterContracts(list, { query: '', status: 'signed' }).map((x) => x.id)).toEqual(['b'])
    expect(filterContracts(list, { query: 'eclair', status: '' }).map((x) => x.id)).toEqual(['b'])
    expect(filterContracts(list, { query: '', status: '' })).toHaveLength(2)
  })
})

describe('fichier signé', () => {
  it('chemin Storage et nom sûr', () => {
    expect(safeFileName('Contrat signé (v2).pdf')).toBe('Contrat-signe-v2-.pdf')
    expect(contractStoragePath('org', 'proj', 'uuid', 'a b.pdf')).toBe('org/proj/uuid-a-b.pdf')
    expect(safeFileName('///')).toBe('contrat.pdf')
  })
  it('reconnaît un PDF', () => {
    expect(isPdf({ name: 'x.PDF', type: '' })).toBe(true)
    expect(isPdf({ name: 'x.png', type: 'image/png' })).toBe(false)
  })
})

describe('parseMarkdown', () => {
  it('titres, listes, gras et paragraphes', () => {
    const blocks = parseMarkdown('# Titre\n\nUn **gras** ici\nsuite\n\n- a\n- b\n\n## Deux')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'heading'])
    expect(blocks[1]).toMatchObject({ inline: [{ text: 'Un ' }, { text: 'gras', bold: true }, { text: ' ici suite' }] })
    expect(blocks[2]).toMatchObject({ items: [[{ text: 'a' }], [{ text: 'b' }]] })
  })
  it('ne produit jamais de HTML : le texte reste du texte', () => {
    expect(parseMarkdown('<script>x</script>')[0]).toMatchObject({ inline: [{ text: '<script>x</script>' }] })
  })
})
