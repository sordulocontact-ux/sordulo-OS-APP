/// <reference types="node" />
// Types Node limités à ce test : il lit les CSS bruts (Vitest ne passe pas les .css, même en ?raw).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tokens = read('../../../styles/tokens.css')
const css = read('./ClaudeMascot.module.css')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, 'url()')
const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpExecArray) => m[1]))

describe('ClaudeMascot.module.css', () => {
  it('n’utilise que des tokens définis (et la teinte du jardin)', () => {
    const local = new Set(['--garden-color', '--garden-tint'])
    const used = Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpExecArray) => m[1] ?? '')
    expect(used.filter((v) => !local.has(v) && !defined.has(v))).toEqual([])
  })

  it('aucune couleur ni longueur en dur', () => {
    expect(strip(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(strip(css)).not.toMatch(/rgba?\(/)
    const lengths = strip(css).match(/-?\d+(\.\d+)?(px|rem)\b/g) ?? []
    expect(lengths.filter((v) => v !== '1px')).toEqual([])
  })
})
