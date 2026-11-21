import { useCallback, useState } from 'react'
import { Button, Field, Icon, Modal, Spinner, Textarea } from '../../components/ui'
import micIcon from '../../assets/icons/mic.svg'
import { api } from '../../lib/api'
import { AI_NOTE_MAX_LENGTH } from '../../shared/api-contract'
import { useVoiceRecorder } from './useVoiceRecorder'
import { appendTranscript, formatDuration } from './voiceNote'
import styles from './AiNoteModal.module.css'

export interface AiNoteModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** Envoie la note à l'IA. Une erreur levée est affichée dans la fenêtre, la note est gardée. */
  onApply: (note: string) => Promise<void>
}

const TOO_LONG = `La note est limitée à ${AI_NOTE_MAX_LENGTH} caractères : la fin de la dictée a été coupée.`

/**
 * Fenêtre « Note à l'IA » : la note se tape ou se dicte (le texte dicté s'ajoute à la fin), puis
 * « Appliquer ». La note reste dans la fenêtre tant qu'elle n'a pas été appliquée.
 */
export function AiNoteModal({ open, onClose, projectId, onApply }: AiNoteModalProps) {
  const [note, setNote] = useState('')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const transcribe = useCallback(
    async (audio: Blob) => (await api.transcribeVoice(projectId, audio)).text,
    [projectId],
  )
  const onTranscript = useCallback((text: string) => {
    setNote((previous) => {
      const next = appendTranscript(previous, text)
      if (next.length <= AI_NOTE_MAX_LENGTH) return next
      setError(TOO_LONG)
      return next.slice(0, AI_NOTE_MAX_LENGTH)
    })
  }, [])
  const voice = useVoiceRecorder({ transcribe, onTranscript })

  const recording = voice.state === 'recording'
  const voiceBusy = voice.state !== 'idle'
  const locked = applying || voiceBusy
  const shownError = voice.error ?? error

  async function apply() {
    const text = note.trim()
    if (!text || locked) return
    setError(null)
    voice.clearError()
    setApplying(true)
    try {
      await onApply(text)
      setNote('')
    } catch (e) {
      setError(e instanceof Error && e.message ? `Note non appliquée : ${e.message}` : 'Note non appliquée. Réessaie.')
    } finally {
      setApplying(false)
    }
  }

  function close() {
    if (!locked) onClose()
  }

  function toggleVoice() {
    setError(null)
    if (recording) voice.stop()
    else void voice.start()
  }

  let voiceLabel = 'Dicter'
  if (voice.state === 'starting') voiceLabel = 'Ouverture du micro…'
  else if (recording) voiceLabel = `Arrêter (${formatDuration(voice.elapsed)})`
  else if (voice.state === 'transcribing') voiceLabel = 'Transcription…'

  let status = ''
  if (recording) status = 'Enregistrement en cours. Appuie sur Arrêter quand tu as fini.'
  else if (voice.state === 'transcribing') status = 'Transcription de ta note…'
  else if (applying) status = "L'IA réécrit les tickets, cela prend quelques secondes…"

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!locked}
      title="Note à l'IA"
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={locked}>
            Annuler
          </Button>
          <Button variant="primary" loading={applying} disabled={!note.trim() || voiceBusy} onClick={() => void apply()}>
            Appliquer
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.help}>
          Dis ou écris ce qu'il faut changer : contenu des tickets, regroupement, qui fait quoi. Ce qui vaut pour la
          suite du projet est retenu.
        </p>

        <Field label="Ta note">
          <Textarea
            rows={6}
            value={note}
            maxLength={AI_NOTE_MAX_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            disabled={applying}
            placeholder="Ex. : les pages de compte sont pour Sacha, regroupe les deux tickets du menu."
          />
        </Field>

        <div className={styles.voice}>
          <Button
            variant={recording ? 'danger' : 'secondary'}
            size="sm"
            onClick={toggleVoice}
            disabled={applying || voice.state === 'starting' || voice.state === 'transcribing'}
            loading={voice.state === 'transcribing'}
          >
            {voice.state === 'transcribing' ? null : <Icon src={micIcon} size="sm" />}
            {voiceLabel}
          </Button>
          <p className={styles.status} role="status" aria-live="polite">
            {recording ? <span className={styles.dot} aria-hidden="true" /> : null}
            {applying ? <Spinner label="" /> : null}
            {status}
          </p>
        </div>

        {shownError ? (
          <p className={styles.error} role="alert">
            {shownError}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
