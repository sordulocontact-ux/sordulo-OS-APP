import { describe, expect, it } from 'vitest'
import {
  activeNoteFilterCount,
  canChangeVisibility,
  canEditNote,
  canUseTeamNotes,
  draftFromNote,
  EMPTY_NOTE_FILTERS,
  filterNotes,
  formatModified,
  formatNoteDate,
  isEmptyPatch,
  noteDraftError,
  noteExcerpt,
  notePatch,
  noteTitle,
  saveStateLabel,
  sortNotes,
  stripMarkdown,
  type NoteWithLinks,
} from './noteLogic'

const note = (over: Partial<NoteWithLinks> = {}): NoteWithLinks => ({
  id: 'n1',
  organization_id: 'o',
  author_id: 'me',
  project_id: null,
  client_id: null,
  title: '',
  body: '',
  visibility: 'personal',
  pinned: false,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  author: null,
  project: null,
  client: null,
  ...over,
})

describe('titre et extrait', () => {
  it('retire le Markdown léger', () => {
    expect(stripMarkdown('# **Kick-off** Ibé')).toBe('Kick-off Ibé')
    expect(stripMarkdown('- point *important*')).toBe('point important')
  })

  it('titre : le titre, sinon la première ligne, sinon « Sans titre »', () => {
    expect(noteTitle({ title: '  Accès  ', body: 'x' })).toBe('Accès')
    expect(noteTitle({ title: '', body: '\n\n## Réunion du 3\nSuite' })).toBe('Réunion du 3')
    expect(noteTitle({ title: ' ', body: '  ' })).toBe('Sans titre')
    expect(noteTitle({ title: '', body: 'a'.repeat(100) })).toHaveLength(80)
  })

  it('extrait sans la ligne reprise comme titre', () => {
    expect(noteExcerpt({ title: '', body: '# Titre\n- un\n- deux' })).toBe('un deux')
    expect(noteExcerpt({ title: 'Titre', body: 'Ligne 1\nLigne 2' })).toBe('Ligne 1 Ligne 2')
    expect(noteExcerpt({ title: 'T', body: 'mot '.repeat(60) }, 20)).toHaveLength(20)
  })
})

describe('tri et filtres', () => {
  const list = [
    note({ id: 'a', updated_at: '2026-11-03T00:00:00Z', title: 'Accès serveur', visibility: 'team', project_id: 'p1', project: { id: 'p1', name: 'App Ibé' } }),
    note({ id: 'b', updated_at: '2026-11-01T00:00:00Z', pinned: true, body: 'Idées de logo' }),
    note({ id: 'c', updated_at: '2026-11-05T00:00:00Z', client_id: 'c1', client: { id: 'c1', name: 'Ibé' } }),
  ]

  it('épinglées en tête puis par dernière modification', () => {
    expect(sortNotes(list).map((n) => n.id)).toEqual(['b', 'c', 'a'])
  })

  it('filtre par projet, client, visibilité et recherche (contenu, projet, sans accents)', () => {
    expect(filterNotes(list, { ...EMPTY_NOTE_FILTERS, projectId: 'p1' }).map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(list, { ...EMPTY_NOTE_FILTERS, clientId: 'c1' }).map((n) => n.id)).toEqual(['c'])
    expect(filterNotes(list, { ...EMPTY_NOTE_FILTERS, visibility: 'personal' }).map((n) => n.id)).toEqual(['b', 'c'])
    expect(filterNotes(list, { ...EMPTY_NOTE_FILTERS, query: 'idees' }).map((n) => n.id)).toEqual(['b'])
    expect(filterNotes(list, { ...EMPTY_NOTE_FILTERS, query: 'ibe' }).map((n) => n.id)).toEqual(['c', 'a'])
  })

  it('compte les filtres actifs (la recherche n’en est pas un)', () => {
    expect(activeNoteFilterCount({ ...EMPTY_NOTE_FILTERS, query: 'x' })).toBe(0)
    expect(activeNoteFilterCount({ query: '', projectId: 'p', clientId: 'c', visibility: 'team' })).toBe(3)
  })
})

describe('droits (miroir de la RLS)', () => {
  const me = { memberId: 'me', role: 'membre' as const }
  const admin = { memberId: 'adm', role: 'admin' as const }
  const prosp = { memberId: 'me', role: 'prospection' as const }

  it('note perso : l’auteur seul, admins compris', () => {
    expect(canEditNote(note(), me)).toBe(true)
    expect(canEditNote(note(), admin)).toBe(false)
  })

  it('note d’équipe : l’auteur et les admins', () => {
    const team = note({ visibility: 'team', author_id: 'other' })
    expect(canEditNote(team, me)).toBe(false)
    expect(canEditNote(team, admin)).toBe(true)
    expect(canEditNote(note({ visibility: 'team' }), me)).toBe(true)
  })

  it('visibilité : l’auteur seulement, et pas l’apporteur', () => {
    expect(canChangeVisibility(note({ author_id: 'other' }), admin)).toBe(false)
    expect(canChangeVisibility(note(), me)).toBe(true)
    expect(canChangeVisibility(note(), prosp)).toBe(false)
    expect(canUseTeamNotes('prospection')).toBe(false)
    expect(canUseTeamNotes('finance')).toBe(true)
  })
})

describe('brouillon', () => {
  it('ne renvoie que les colonnes changées (vide → null pour les liens)', () => {
    const saved = draftFromNote(note({ project_id: 'p1' }))
    expect(isEmptyPatch(notePatch(saved, saved))).toBe(true)
    expect(notePatch({ ...saved, body: 'x', projectId: '' }, saved)).toEqual({ body: 'x', project_id: null })
    expect(notePatch({ ...saved, visibility: 'team', clientId: 'c1' }, saved)).toEqual({ visibility: 'team', client_id: 'c1' })
  })

  it('contrôle les longueurs', () => {
    const draft = draftFromNote(note())
    expect(noteDraftError(draft)).toBeNull()
    expect(noteDraftError({ ...draft, title: 'x'.repeat(201) })).toMatch(/200/)
  })

  it('libellés de l’enregistrement', () => {
    expect(saveStateLabel('saved')).toBe('Enregistré')
    expect(saveStateLabel('idle')).toBe('')
  })
})

describe('dates', () => {
  const now = new Date('2026-11-25T15:00:00')
  it('heure aujourd’hui, jour cette année, année sinon', () => {
    expect(formatNoteDate(new Date('2026-11-25T09:05:00').toISOString(), now)).toBe('09:05')
    expect(formatNoteDate(new Date('2026-11-03T09:05:00').toISOString(), now)).toBe('3 nov.')
    expect(formatNoteDate(new Date('2025-11-03T09:05:00').toISOString(), now)).toBe('3 nov. 2025')
    expect(formatNoteDate('pas une date', now)).toBe('')
    expect(formatModified(new Date('2026-11-25T09:05:00').toISOString(), now)).toBe('modifiée à 09:05')
    expect(formatModified(new Date('2026-11-03T09:05:00').toISOString(), now)).toBe('modifiée le 3 nov.')
  })
})
