/// <reference types="node" />
// Types Node limités à ce test : il lit les CSS bruts (Vitest ne passe pas les .css, même en ?raw).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GARDEN, GARDEN_ANGRY_TOKEN, GARDEN_BLUSH_TOKEN, GARDEN_COLOR_TOKENS } from './constants'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tokens = read('../../../styles/tokens.css')
const css = read('./Garden.module.css')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpExecArray) => m[1]))

describe('Garden.module.css', () => {
  it('only uses defined tokens (besides the variables set by the renderer)', () => {
    const local = new Set(['--garden-color', '--garden-dx', '--garden-dy'])
    const used = Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpExecArray) => m[1] ?? '')
    expect(used.filter((v) => !local.has(v) && !defined.has(v))).toEqual([])
  })

  it('has no hard-coded color', () => {
    expect(strip(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(strip(css)).not.toMatch(/rgba?\(/)
  })

  it('has no hard-coded px or rem value (besides 0 and 1px)', () => {
    const lengths = strip(css).match(/-?\d+(\.\d+)?(px|rem)\b/g) ?? []
    expect(lengths.filter((v) => v !== '1px')).toEqual([])
  })
})

describe('garden tokens', () => {
  it('gives every session color, angry and blush a token', () => {
    expect(GARDEN_COLOR_TOKENS).toHaveLength(GARDEN.maxSessions)
    for (const token of [...GARDEN_COLOR_TOKENS, GARDEN_ANGRY_TOKEN, GARDEN_BLUSH_TOKEN]) {
      expect(defined.has(token)).toBe(true)
    }
  })

  it('keeps effect lifetimes equal to the CSS animation durations', () => {
    const duration = (name: string) => {
      const m = tokens.match(new RegExp(`--island-garden-duration-${name}:\\s*(\\d+)ms`))
      return m ? Number(m[1]) / 1000 : NaN
    }
    expect(duration('say')).toBe(GARDEN.fxLife.say)
    expect(duration('heart')).toBe(GARDEN.fxLife.heart)
    expect(duration('steam')).toBe(GARDEN.fxLife.steam)
    expect(duration('star')).toBe(GARDEN.fxLife.star)
    expect(duration('z')).toBe(GARDEN.fxLife.z)
    expect(duration('note')).toBe(GARDEN.fxLife.note)
    expect(duration('spark')).toBe(GARDEN.fxLife.spark)
  })
})
