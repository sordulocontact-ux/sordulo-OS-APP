import { describe, expect, it } from 'vitest'
import { VOICE_NOTE_MAX_BYTES } from '../../shared/api-contract'
import {
  appendTranscript,
  checkRecording,
  formatDuration,
  pickMimeType,
  recorderErrorMessage,
  VOICE_ERRORS,
} from './voiceNote'

describe('pickMimeType', () => {
  it('prend le premier format pris en charge', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickMimeType((type) => type === 'audio/mp4' || type === 'audio/ogg')).toBe('audio/mp4')
  })
  it('laisse le navigateur choisir si aucun format connu', () => {
    expect(pickMimeType(() => false)).toBe('')
  })
})

describe('formatDuration', () => {
  it('formate en m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(42.9)).toBe('0:42')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(600)).toBe('10:00')
    expect(formatDuration(-3)).toBe('0:00')
  })
})

describe('appendTranscript', () => {
  it('ajoute à la fin sans écraser', () => {
    expect(appendTranscript('', ' Bonjour ')).toBe('Bonjour')
    expect(appendTranscript('Déjà tapé  \n', 'Suite')).toBe('Déjà tapé\nSuite')
    expect(appendTranscript('Garde ça', '  ')).toBe('Garde ça')
  })
})

describe('recorderErrorMessage', () => {
  it('traduit les erreurs du micro', () => {
    expect(recorderErrorMessage(new DOMException('x', 'NotAllowedError'))).toBe(VOICE_ERRORS.denied)
    expect(recorderErrorMessage({ name: 'NotFoundError' })).toBe(VOICE_ERRORS.noMicrophone)
    expect(recorderErrorMessage({ name: 'NotReadableError' })).toBe(VOICE_ERRORS.busy)
    expect(recorderErrorMessage('bizarre')).toBe(VOICE_ERRORS.failed)
  })
})

describe('checkRecording', () => {
  it('refuse un enregistrement vide ou trop lourd', () => {
    expect(checkRecording(0)).toBe(VOICE_ERRORS.empty)
    expect(checkRecording(VOICE_NOTE_MAX_BYTES + 1)).toBe(VOICE_ERRORS.tooLarge)
    expect(checkRecording(1000)).toBeNull()
  })
})
