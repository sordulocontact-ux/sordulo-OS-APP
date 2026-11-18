import { useState } from 'react'
import downloadIcon from '../../assets/icons/download.svg'
import { Button, useToast } from '../../components/ui'
import { api, ApiRequestError } from '../../lib/api'
import { formatTranscriptForPrompt } from '../../shared/transcript'
import type { Input } from '../../shared/types'
import { inputTitle } from './inputUtils'
import styles from './DownloadInputButtons.module.css'

function saveFile(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'entree'
}

/** Téléchargements : texte d'une entrée écrite, transcription (.txt) et audio d'une réunion. */
export function DownloadInputButtons({ input }: { input: Input }) {
  const toast = useToast()
  const [loadingAudio, setLoadingAudio] = useState(false)
  const hasText = input.kind === 'written' && Boolean(input.raw_text?.trim())
  const hasTranscript = Boolean(input.transcript && input.transcript.utterances.length > 0)
  const base = safeName(`${inputTitle(input)} ${input.created_at.slice(0, 10)}`)

  function downloadText() {
    const text = `${inputTitle(input)}\n\n${input.raw_text ?? ''}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    saveFile(url, `${base}.txt`)
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  function downloadTranscript() {
    if (!input.transcript) return
    const text = `${inputTitle(input)}\n\n${formatTranscriptForPrompt(input.transcript, input.speaker_names)}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    saveFile(url, `${base} - transcription.txt`)
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function downloadAudio() {
    setLoadingAudio(true)
    try {
      const { url } = await api.audioUrl({ inputId: input.id })
      saveFile(url, `${base}.mp3`)
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : "Impossible de télécharger l'audio.")
    } finally {
      setLoadingAudio(false)
    }
  }

  return (
    <>
      {hasText ? (
        <Button size="sm" onClick={downloadText} title="Télécharger le texte (.txt)">
          <img src={downloadIcon} alt="" width={16} height={16} className={styles.icon} />
          Texte
        </Button>
      ) : null}
      {hasTranscript ? (
        <Button size="sm" onClick={downloadTranscript} title="Télécharger la transcription (.txt)">
          <img src={downloadIcon} alt="" width={16} height={16} className={styles.icon} />
          Transcription
        </Button>
      ) : null}
      {input.audio_path ? (
        <Button size="sm" onClick={() => void downloadAudio()} loading={loadingAudio} title="Télécharger l'audio de l'appel">
          <img src={downloadIcon} alt="" width={16} height={16} className={styles.icon} />
          Audio
        </Button>
      ) : null}
    </>
  )
}
