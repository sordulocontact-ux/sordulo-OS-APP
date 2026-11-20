import { describe, expect, it } from 'vitest'
import {
  callStats,
  callTitle,
  clientOptions,
  filterCalls,
  formatCallDate,
  formatCallDuration,
  participants,
  type CallRow,
  type CallsFilters,
} from './callsLogic'

const NOW = new Date(2026, 10, 20, 16, 0)

function call(over: Partial<CallRow> & { id: string }): CallRow {
  return {
    project_id: 'p1',
    title: null,
    status: 'ready',
    created_at: new Date(2026, 10, 20, 14, 42).toISOString(),
    speaker_names: {},
    duration: 600,
    project: { id: 'p1', name: 'App Ibé', client: { id: 'c1', name: 'Ibé' } },
    tickets: [{ count: 2 }],
    ...over,
  }
}

const NO_FILTERS: CallsFilters = { query: '', project: '', client: '', status: '', period: '' }

describe('callTitle', () => {
  it('garde le titre saisi', () => expect(callTitle(call({ id: 'a', title: ' Point hebdo ' }))).toBe('Point hebdo'))
  it('construit un titre par défaut', () => expect(callTitle(call({ id: 'a' }))).toBe('Appel du 20/11/2026 à 14:42'))
})

describe('formatCallDuration', () => {
  it('formate heures et minutes', () => {
    expect(formatCallDuration(85 * 60)).toBe('1 h 25')
    expect(formatCallDuration(3 * 3600 + 5 * 60)).toBe('3 h 05')
  })
  it('formate les minutes', () => expect(formatCallDuration(240)).toBe('4 min'))
  it('gère les durées inconnues ou très courtes', () => {
    expect(formatCallDuration(null)).toBe('—')
    expect(formatCallDuration(0)).toBe('—')
    expect(formatCallDuration(20)).toBe('< 1 min')
  })
})

describe('participants', () => {
  it('joint les noms dans l’ordre des voix', () => {
    expect(participants({ speaker_names: { '1': 'Ibé', '0': 'Maël', '2': ' ' } })).toBe('Maël, Ibé')
  })
  it('est vide sans noms', () => expect(participants({ speaker_names: null })).toBe(''))
})

describe('formatCallDate', () => {
  it('relative pour aujourd’hui et hier', () => {
    expect(formatCallDate(new Date(2026, 10, 20, 9, 5).toISOString(), NOW)).toBe('Aujourd’hui, 09:05')
    expect(formatCallDate(new Date(2026, 10, 19, 23, 50).toISOString(), NOW)).toBe('Hier, 23:50')
  })
  it('date complète sinon', () => expect(formatCallDate(new Date(2026, 10, 3, 9, 0).toISOString(), NOW)).toBe('03/11/2026'))
})

describe('callStats', () => {
  it('ne compte que le mois en cours', () => {
    const stats = callStats(
      [
        call({ id: 'a', duration: 3600, tickets: [{ count: 3 }] }),
        call({ id: 'b', duration: null, tickets: [] }),
        call({ id: 'c', created_at: new Date(2026, 9, 28).toISOString(), duration: 9999, tickets: [{ count: 9 }] }),
      ],
      NOW,
    )
    expect(stats).toEqual({ count: 2, seconds: 3600, tickets: 3 })
  })
})

describe('filterCalls', () => {
  const calls = [
    call({ id: 'old', created_at: new Date(2026, 9, 1).toISOString(), status: 'error' }),
    call({ id: 'new', speaker_names: { '0': 'Maël' } }),
    call({
      id: 'other',
      project_id: 'p2',
      created_at: new Date(2026, 10, 15).toISOString(),
      status: 'transcribing',
      project: { id: 'p2', name: 'Site Zed', client: { id: 'c2', name: 'Zed' } },
    }),
  ]
  const ids = (f: Partial<CallsFilters>) => filterCalls(calls, { ...NO_FILTERS, ...f }, NOW).map((c) => c.id)

  it('trie du plus récent au plus ancien', () => expect(ids({})).toEqual(['new', 'other', 'old']))
  it('filtre par projet et client', () => {
    expect(ids({ project: 'p2' })).toEqual(['other'])
    expect(ids({ client: 'c1' })).toEqual(['new', 'old'])
  })
  it('filtre par statut', () => {
    expect(ids({ status: 'processing' })).toEqual(['other'])
    expect(ids({ status: 'error' })).toEqual(['old'])
    expect(ids({ status: 'ready' })).toEqual(['new'])
  })
  it('filtre par période', () => {
    expect(ids({ period: '7d' })).toEqual(['new', 'other'])
    expect(ids({ period: '30d' })).toEqual(['new', 'other'])
  })
  it('cherche sans accent dans titre, projet, client et voix', () => {
    expect(ids({ query: 'ibe' })).toEqual(['new', 'old'])
    expect(ids({ query: 'zed' })).toEqual(['other'])
    expect(ids({ query: 'mael' })).toEqual(['new'])
  })
})

describe('clientOptions', () => {
  it('dédoublonne et trie', () => {
    expect(clientOptions([call({ id: 'a' }), call({ id: 'b' }), call({ id: 'c', project: null })])).toEqual([{ id: 'c1', name: 'Ibé' }])
  })
})
