import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Modal, Spinner, Textarea, TextInput, useToast } from '../../components/ui'
import { api, ApiRequestError } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import { AUDIO_MAX_BYTES, type CreateInputResponse } from '../../shared/api-contract'
import { formatFileSize } from './inputUtils'
import { MeetingUploadError, UPLOAD_STEP_LABELS, uploadMeetingRecording, type UploadStep } from './uploadMeeting'
import styles from './NewInputModal.module.css'

type Mode = 'written' | 'meeting'
type Step = 'idle' | UploadStep

const EXTENSION_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'video/webm',
  mp4: 'video/mp4',
}

/** Content type of an accepted file, or null when the file is not audio (or mp4/webm video). */
function acceptedContentType(file: File): string | null {
  const type = file.type.toLowerCase()
  if (type.startsWith('audio/') || type === 'video/mp4' || type === 'video/webm') return type
  if (type === '') {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    return EXTENSION_TYPES[ext] ?? null
  }
  return null
}

function validateFile(file: File): string | null {
  if (!acceptedContentType(file)) return 'Ce fichier n\'est pas un audio. Choisis un fichier audio (mp3, m4a, wav…) ou une vidéo mp4 / webm.'
  if (file.size <= 0) return 'Ce fichier est vide.'
  if (file.size > AUDIO_MAX_BYTES) {
    return `Ce fichier est trop volumineux (${formatFileSize(file.size)}). Maximum : ${formatFileSize(AUDIO_MAX_BYTES)}.`
  }
  return null
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  return 'Une erreur est survenue. Réessaie.'
}

export interface NewInputModalProps {
  projectId: string
  open: boolean
  onClose: () => void
}

export function NewInputModal({ projectId, open, onClose }: NewInputModalProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const modeName = useId()

  const [mode, setMode] = useState<Mode>('written')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  // Kept between attempts so a retry never creates a second input.
  const [created, setCreated] = useState<CreateInputResponse | null>(null)
  const [uploaded, setUploaded] = useState(false)

  const busy = step !== 'idle'

  function reset() {
    setMode('written')
    setTitle('')
    setText('')
    setFile(null)
    setFileError(null)
    setStep('idle')
    setError(null)
    setCreated(null)
    setUploaded(false)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function finish(inputId: string) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.input(inputId) })
    reset()
    onClose()
    void navigate(`/projects/${projectId}/inputs/${inputId}`)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null
    setError(null)
    if (!picked) {
      setFile(null)
      setFileError(null)
      return
    }
    const problem = validateFile(picked)
    setFileError(problem)
    setFile(problem ? null : picked)
    if (problem) event.target.value = ''
  }

  async function submitWritten() {
    setStep('creating')
    try {
      const { input } = await api.createInput({
        projectId,
        kind: 'written',
        title: title.trim() || undefined,
        rawText: text.trim(),
      })
      toast.success('Entrée créée, analyse en cours.')
      finish(input.id)
    } catch (e) {
      setError(errorMessage(e))
      setStep('idle')
    }
  }

  async function submitMeeting(chosen: File) {
    const contentType = acceptedContentType(chosen)
    if (!contentType) return
    try {
      const { input } = await uploadMeetingRecording({
        projectId,
        title,
        file: chosen,
        fileName: chosen.name,
        contentType,
        resume: { created, uploaded },
        onStep: setStep,
        onCreated: (done) => {
          setCreated(done)
          void queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) })
        },
      })
      toast.success('Fichier envoyé, transcription en cours.')
      finish(input.id)
    } catch (e) {
      if (e instanceof MeetingUploadError) {
        setCreated(e.resume.created)
        setUploaded(e.resume.uploaded)
      }
      setError(errorMessage(e))
      setStep('idle')
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (mode === 'written') {
      if (!text.trim()) {
        setError('Colle le retour du client avant de lancer l\'analyse.')
        return
      }
      void submitWritten()
    } else {
      const chosen = file
      if (!chosen) {
        setFileError('Choisis un fichier audio.')
        return
      }
      void submitMeeting(chosen)
    }
  }

  const submitLabel = mode === 'written' ? 'Analyser' : created ? 'Réessayer l\'envoi' : 'Envoyer et transcrire'
  const canSubmit = mode === 'written' ? text.trim() !== '' : file !== null

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title="Nouvelle entrée"
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="new-input-form" loading={busy} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="new-input-form" className={styles.form} onSubmit={onSubmit} noValidate>
        <fieldset className={styles.modes} disabled={busy || created !== null}>
          <legend className="visually-hidden">Type d'entrée</legend>
          {(['written', 'meeting'] as const).map((value) => (
            <label key={value} className={styles.mode}>
              <input
                type="radio"
                name={modeName}
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value)
                  setError(null)
                }}
                className={styles.radio}
              />
              <span className={styles.modeLabel}>{value === 'written' ? 'Retour écrit' : 'Réunion (audio)'}</span>
            </label>
          ))}
        </fieldset>

        <Field label="Titre (optionnel)">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy || created !== null} />
        </Field>

        {mode === 'written' ? (
          <Field label="Retour du client" hint={`${text.length} caractère${text.length > 1 ? 's' : ''}`}>
            <Textarea
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              required
              placeholder="Colle ici l'email, le message ou les notes du client."
            />
          </Field>
        ) : (
          <Field
            label="Fichier audio"
            hint={`Audio (mp3, m4a, wav…) ou vidéo mp4 / webm, ${formatFileSize(AUDIO_MAX_BYTES)} maximum.`}
            error={fileError}
          >
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm"
              onChange={onFileChange}
              disabled={busy || created !== null}
              className={styles.file}
            />
          </Field>
        )}
        {mode === 'meeting' && file ? (
          <p className={styles.fileInfo}>
            {file.name} ({formatFileSize(file.size)})
          </p>
        ) : null}

        <div className={styles.status} aria-live="polite">
          {step !== 'idle' ? (
            <p className={styles.step}>
              <Spinner label="" />
              {UPLOAD_STEP_LABELS[step]}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
            {created ? ' L\'entrée est déjà créée : le nouvel essai la réutilise.' : ''}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
