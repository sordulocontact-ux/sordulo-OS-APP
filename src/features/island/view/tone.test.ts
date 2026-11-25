/// <reference types="node" />
// Types Node limités à ce test : il lit les CSS bruts (Vitest ne passe pas les .css, même en ?raw).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { IslandTone } from '../types'
import { PROGRESS_VISUALS, TONE_TOKENS, toneColor, toneStyle } from './tone'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tokens = read('../../../styles/tokens.css')
const moduleCss = read('./Island.module.css')
const labCss = read('../lab/IslandLab.module.css')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const lengthsOf = (css: string) => strip(css).match(/-?\d+(\.\d+)?(px|rem)\b/g) ?? []

const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpExecArray) => m[1]))

describe('tone tokens', () => {
  it('maps every tone to an island token', () => {
    const tones: IslandTone[] = ['neutral', 'success', 'alert', 'danger', 'info', 'claude', 'analysis', 'call']
    for (const tone of tones) {
      expect(TONE_TOKENS[tone]).toMatch(/^--island-/)
      expect(defined.has(TONE_TOKENS[tone])).toBe(true)
    }
    expect(toneColor('call')).toBe('var(--island-call)')
    expect(toneStyle('success')).toEqual({ '--island-tone': 'var(--island-success)' })
  })

  it('colors the analysis ring with the analysis token', () => {
    expect(PROGRESS_VISUALS.analyse).toEqual({ icon: 'sun', tone: 'analysis' })
    expect(PROGRESS_VISUALS.upload.tone).toBe('neutral')
  })
})

describe('Island.module.css', () => {
  it('only uses defined tokens (besides the variables set by the component)', () => {
    // Posées par le rendu : couleur d'accent, durée de notification, couleurs de la pochette, rang d'une barre,
    // repère du bord de la zone de contenu (moteur, jardin tourné de la pilule verticale), décalage de la goutte
    // du glisser (moteur).
    const local = new Set([
      '--island-tone',
      '--nd',
      '--music-start',
      '--music-end',
      '--eq-t',
      '--eq-c',
      '--edge-along',
      '--edge-depth',
      '--drag-x',
      '--drag-y',
    ])
    const used = Array.from(moduleCss.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpExecArray) => m[1] ?? '')
    const missing = used.filter((v) => !local.has(v) && !defined.has(v))
    expect(missing).toEqual([])
  })

  it('has no hard-coded color', () => {
    const withoutComments = moduleCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutComments).not.toMatch(/rgba?\(/)
  })

  it('has no hard-coded px or rem value (besides 0 and 1px)', () => {
    const lengths = lengthsOf(moduleCss)
    expect(lengths.filter((v) => v !== '1px')).toEqual([])
  })
})

describe('IslandLab.module.css', () => {
  it('only uses defined tokens', () => {
    const used = Array.from(labCss.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpExecArray) => m[1] ?? '')
    expect(used.filter((v) => !defined.has(v))).toEqual([])
  })

  it('has no hard-coded px or rem value (besides 0 and 1px)', () => {
    const lengths = lengthsOf(labCss)
    expect(lengths.filter((v) => v !== '1px')).toEqual([])
  })
})
