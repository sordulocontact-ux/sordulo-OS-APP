import { describe, expect, it } from 'vitest'
import { edgeFromSearch, placeFromPlacement, placeFromSearch } from './placement'

describe('place de l\'île', () => {
  it('lit le bord dans l\'URL, haut par défaut', () => {
    expect(edgeFromSearch('?platform=win&edge=left')).toBe('left')
    expect(edgeFromSearch('?edge=bottom')).toBe('bottom')
    expect(edgeFromSearch('')).toBe('top')
    expect(edgeFromSearch('?edge=diagonal')).toBe('top')
  })

  it('lit le bord et la plateforme de départ', () => {
    expect(placeFromSearch('?platform=mac&edge=top')).toEqual({ edge: 'top', platform: 'mac' })
    expect(placeFromSearch('?platform=win&edge=right').edge).toBe('right')
  })

  it('prend mac seulement avec l\'encoche', () => {
    expect(placeFromPlacement({ edge: 'top', notch: true })).toEqual({ edge: 'top', platform: 'mac' })
    expect(placeFromPlacement({ edge: 'bottom', notch: false })).toEqual({ edge: 'bottom', platform: 'win' })
  })
})
