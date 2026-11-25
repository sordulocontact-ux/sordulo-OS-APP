/// <reference types="node" />
// Types Node limités à ce test : il lit les CSS bruts (Vitest ne passe pas les .css, même en ?raw).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tokens = read('../../../../styles/tokens.css')
const css = read('./ReviewLayer.module.css')
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpExecArray) => m[1]))

describe('ReviewLayer.module.css', () => {
  it('n’utilise que des tokens définis (et les couleurs posées par le rendu)', () => {
    const local = new Set(['--type-tone', '--island-tone'])
    const used = Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (m: RegExpExecArray) => m[1] ?? '')
    expect(used.filter((v) => !local.has(v) && !defined.has(v))).toEqual([])
  })

  it('aucune couleur ni longueur en dur, pas de letter-spacing', () => {
    expect(strip(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(strip(css)).not.toMatch(/rgba?\(/)
    expect(strip(css)).not.toMatch(/letter-spacing/)
    const lengths = strip(css).match(/-?\d+(\.\d+)?(px|rem)\b/g) ?? []
    expect(lengths.filter((v) => v !== '1px')).toEqual([])
  })
})
