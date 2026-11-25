import { describe, expect, it } from 'vitest'
import { cleanMarkers, markerAnchors } from './markers'

const utterances = [
  { start: 0, end: 10 },
  { start: 12, end: 40 },
  { start: 60, end: 75 },
]

describe('cleanMarkers', () => {
  it('trie, dédoublonne et ignore les valeurs inutilisables', () => {
    expect(cleanMarkers([50, 12.5, -1, Number.NaN, 12.5, 3])).toEqual([3, 12.5, 50])
    expect(cleanMarkers(undefined)).toEqual([])
    expect(cleanMarkers(null)).toEqual([])
    expect(cleanMarkers([])).toEqual([])
  })
})

describe('markerAnchors', () => {
  it('place un repère avant la première réplique qui le chevauche', () => {
    expect(markerAnchors(utterances, [5, 12, 40])).toEqual(
      new Map([
        [0, [5]],
        [1, [12, 40]],
      ]),
    )
  })

  it('dans un silence : avant la réplique suivante, sinon après la dernière', () => {
    expect(markerAnchors(utterances, [11, 50, 90])).toEqual(
      new Map([
        [1, [11]],
        [2, [50]],
        [3, [90]],
      ]),
    )
  })

  it('sans réplique : tout à la fin', () => {
    expect(markerAnchors([], [4])).toEqual(new Map([[0, [4]]]))
  })
})
