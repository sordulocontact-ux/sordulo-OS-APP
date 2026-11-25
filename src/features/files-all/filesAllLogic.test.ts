import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  countLabel,
  folderOptions,
  groupByProject,
  hasAnyFilter,
  mergePages,
  pendingLabel,
  projectIdsFilter,
  projectOptions,
  sortRows,
  type FileRow,
} from './filesAllLogic'

function row(id: string, over: Partial<FileRow> = {}): FileRow {
  return {
    id,
    organization_id: 'o',
    project_id: 'p1',
    folder: 'Devis',
    name: `fichier-${id}.pdf`,
    storage_path: `o/p1/${id}`,
    mime_type: 'application/pdf',
    size_bytes: 100,
    sha256: null,
    kind: 'quote',
    summary: null,
    version_group_id: id,
    version: 1,
    change_summary: null,
    quote_id: null,
    invoice_id: null,
    uploaded_by: null,
    deleted_at: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    project: { name: 'Alpha', client_id: 'c1', client: { id: 'c1', name: 'Ibé' } },
    ...over,
  }
}

const projects = [
  { id: 'p1', name: 'Alpha', client_id: 'c1' },
  { id: 'p2', name: 'Beta', client_id: 'c1' },
  { id: 'p3', name: 'Gamma', client_id: 'c2' },
]

describe('filtres', () => {
  it('compte les filtres actifs sans la recherche', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, query: 'x', kind: 'quote', folder: 'Devis' })).toBe(2)
  })
  it('détecte un filtre ou une recherche', () => {
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false)
    expect(hasAnyFilter({ ...EMPTY_FILTERS, query: '  ' })).toBe(false)
    expect(hasAnyFilter({ ...EMPTY_FILTERS, query: 'a' })).toBe(true)
  })
  it('limite les projets au client choisi', () => {
    expect(projectOptions(projects, 'c1').map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(projectOptions(projects, '')).toHaveLength(3)
  })
  it('donne les projets à filtrer côté serveur', () => {
    expect(projectIdsFilter(projects, { clientId: '', projectId: '' })).toBeNull()
    expect(projectIdsFilter(projects, { clientId: 'c1', projectId: '' })).toEqual(['p1', 'p2'])
    expect(projectIdsFilter(projects, { clientId: 'c1', projectId: 'p2' })).toEqual(['p2'])
    expect(projectIdsFilter(projects, { clientId: 'inconnu', projectId: '' })).toEqual([])
  })
  it('liste les dossiers types puis les dossiers libres', () => {
    const options = folderOptions([{ folder: 'Zèbre' }, { folder: 'Devis' }, { folder: 'Archives' }, { folder: 'Archives' }])
    expect(options.slice(-2)).toEqual(['Archives', 'Zèbre'])
    expect(options.filter((o) => o === 'Devis')).toHaveLength(1)
  })
})

describe('tri', () => {
  it('trie par nom en ordre naturel', () => {
    const rows = [row('a', { name: 'f10' }), row('b', { name: 'f2' })]
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['f2', 'f10'])
    expect(sortRows(rows, 'name', 'desc').map((r) => r.name)).toEqual(['f10', 'f2'])
  })
  it('trie par taille et par date, sans modifier la liste', () => {
    const rows = [row('a', { size_bytes: 5, created_at: '2026-01-01T00:00:00Z' }), row('b', { size_bytes: 9, created_at: '2026-02-01T00:00:00Z' })]
    expect(sortRows(rows, 'size', 'desc').map((r) => r.id)).toEqual(['b', 'a'])
    expect(sortRows(rows, 'date', 'desc').map((r) => r.id)).toEqual(['b', 'a'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('à égalité, le plus récent passe devant', () => {
    const rows = [row('a', { created_at: '2026-01-01T00:00:00Z' }), row('b', { created_at: '2026-03-01T00:00:00Z' })]
    expect(sortRows(rows, 'kind', 'asc').map((r) => r.id)).toEqual(['b', 'a'])
  })
  it('trie par client même sans projet lisible', () => {
    const rows = [row('a', { project: null }), row('b')]
    expect(sortRows(rows, 'client', 'asc').map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('regroupement et pages', () => {
  it('regroupe par projet', () => {
    const groups = groupByProject([row('a'), row('b', { project_id: 'p0', project: { name: 'Zéro', client_id: 'c1', client: null } }), row('c')])
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([
      ['Alpha', 2],
      ['Zéro', 1],
    ])
  })
  it('fusionne les pages sans doublon', () => {
    expect(mergePages([[row('a'), row('b')], [row('b'), row('c')]]).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('libellés', () => {
  it('accorde le nombre de fichiers', () => {
    expect(countLabel(1, 1)).toBe('1 fichier')
    expect(countLabel(3, null)).toBe('3 fichiers')
    expect(countLabel(100, 230)).toBe('100 fichiers sur 230')
  })
  it('accorde les dépôts', () => {
    expect(pendingLabel(1)).toBe('1 dépôt en attente')
    expect(pendingLabel(4)).toBe('4 dépôts en attente')
  })
})
