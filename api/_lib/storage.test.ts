import { describe, expect, it } from 'vitest'
import { buildAudioPath, sanitizeFileName } from './storage.js'

describe('sanitizeFileName', () => {
  it('retire les accents, espaces et caractères spéciaux', () => {
    expect(sanitizeFileName('Réunion Ibé (18 nov).m4a')).toBe('Reunion-Ibe-18-nov-.m4a')
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Users\\x\\enregistrement.webm')).toBe('enregistrement.webm')
  })
  it('ne renvoie jamais un nom vide', () => {
    expect(sanitizeFileName('???')).toBe('audio')
    expect(sanitizeFileName('')).toBe('audio')
  })
  it('limite la longueur en gardant l’extension', () => {
    const name = sanitizeFileName(`${'a'.repeat(300)}.mp3`)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith('.mp3')).toBe(true)
  })
})

describe('buildAudioPath', () => {
  it('range le fichier par organisation, projet et entrée', () => {
    expect(buildAudioPath('org', 'proj', 'inp', 'Réunion.mp3')).toBe('org/proj/inp/Reunion.mp3')
  })
})
