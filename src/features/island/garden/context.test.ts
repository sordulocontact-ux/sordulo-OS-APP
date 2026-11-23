import { describe, expect, it } from 'vitest'
import type { MusicLevels, MusicLevelsReader } from '../types'
import { gardenBeat } from './context'

const loud = (fields: Partial<MusicLevels> = {}): MusicLevels => ({
  bands: [0.9, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
  beatPeriodMs: 500,
  lastBeatAt: 1_000,
  at: 1_100,
  ...fields,
})

const reader = (levels: MusicLevels | null, tempoPhase: number | null): MusicLevelsReader => ({
  get: () => levels,
  tempoPhase: () => tempoPhase,
})

describe('gardenBeat', () => {
  it('vrai temps d’abord, puis tempo du morceau, sinon tempo fixe', () => {
    // Vrai temps : 1 125 ms = un quart de temps après le dernier (période 500 ms).
    expect(gardenBeat({ musicLevels: reader(loud(), 0.9) }, true, 1_125).beatPhase).toBeCloseTo(0.25)
    // Vrai son sans tempo stable : tempo du morceau.
    expect(gardenBeat({ musicLevels: reader(loud({ beatPeriodMs: null }), 0.3) }, true, 1_125)).toEqual({
      beatPhase: 0.3,
    })
    // Pas de vrai son (téléphone, Mac) : tempo du morceau.
    expect(gardenBeat({ musicLevels: reader(null, 0.6) }, true, 1_125)).toEqual({ beatPhase: 0.6 })
    // Ni l'un ni l'autre : tempo fixe.
    expect(gardenBeat({ musicLevels: reader(null, null) }, true, 1_125)).toEqual({})
    expect(gardenBeat({ musicLevels: null }, true, 1_125)).toEqual({})
  })

  it('silence analysé : pas de hochement, même avec un tempo ; sans musique : rien', () => {
    const silent = loud({ bands: [0, 0, 0, 0, 0, 0, 0, 0] })
    expect(gardenBeat({ musicLevels: reader(silent, 0.3) }, true, 1_125)).toEqual({ musicSilent: true })
    expect(gardenBeat({ musicLevels: reader(loud(), 0.3) }, false, 1_125)).toEqual({})
  })
})
