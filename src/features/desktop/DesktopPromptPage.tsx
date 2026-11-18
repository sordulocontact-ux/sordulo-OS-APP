import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, Spinner } from '../../components/ui'
import {
  deleteRecording,
  dismissPrompt,
  getStatus,
  hideCurrentWindow,
  onPrompt,
  onRecordingState,
  readRecording,
  showMainWindow,
  startRecording,
  stopRecording,
} from '../../lib/desktop'
import type { MicApp, PromptPayload, RecordingResult, RecordingState } from '../../shared/desktop-contract'
import { EMPTY_RESUME, MeetingUploadError, UPLOAD_STEP_LABELS, uploadMeetingRecording, type UploadResume, type UploadStep } from '../inputs/uploadMeeting'
import { useProjects } from '../projects/useProjects'
import { formatElapsed } from './useRecordingState'
import { readLastProjectId, readPendingRecording, writeLastProjectId, writePendingRecording } from './storage'
import styles from './DesktopPromptPage.module.css'

type View = 'loading' | 'propose' | 'recording' | 'ended' | 'sending' | 'done'
type SendStep = 'stopping' | 'reading' | UploadStep

const SEND_STEP_LABELS: Record<SendStep, string> = {
  stopping: "Arrêt de l'enregistrement…",
  reading: 'Lecture du fichier…',
  ...UPLOAD_STEP_LABELS,
}

const HIDE_AFTER_START_MS = 1500
const HIDE_AFTER_DONE_MS = 8000

function extensionOf(mimeType: string): string {
  if (mimeType === 'audio/mpeg') return 'mp3'
  return mimeType.split('/')[1]?.split(';')[0] || 'mp3'
}

function recordingFileName(result: RecordingResult): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  return `appel-${stamp}.${extensionOf(result.mimeType)}`
}

function silently(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

export function DesktopPromptPage() {
  const projects = useProjects()
  const [view, setView] = useState<View>('loading')
  const [reason, setReason] = useState<'mic-active' | 'manual-start'>('mic-active')
  const [apps, setApps] = useState<MicApp[]>([])
  const [recording, setRecording] = useState<RecordingState | null>(null)
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [pending, setPending] = useState<RecordingResult | null>(() => readPendingRecording())
  const [step, setStep] = useState<SendStep | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sentProjectId, setSentProjectId] = useState<string | null>(null)
  const resumeRef = useRef<UploadResume>(EMPTY_RESUME)
  const sendingRef = useRef(false)
  const gotPromptRef = useRef(false)
  const runStopRef = useRef<() => void>(() => undefined)

  const projectList = projects.data
  const projectId = useMemo(() => {
    if (chosenProjectId) return chosenProjectId
    if (!projectList || projectList.length === 0) return ''
    const last = readLastProjectId()
    return projectList.find((p) => p.id === last)?.id ?? projectList[0]?.id ?? ''
  }, [chosenProjectId, projectList])

  function projectName(id: string | null | undefined): string {
    return projectList?.find((p) => p.id === id)?.name ?? 'le projet'
  }

  async function send(): Promise<void> {
    if (sendingRef.current) return
    sendingRef.current = true
    setView('sending')
    setSendError(null)
    try {
      let result = pending
      if (!result) {
        setStep('stopping')
        result = await stopRecording()
        writePendingRecording(result)
        setPending(result)
      }
      setStep('reading')
      const bytes = await readRecording(result.path)
      const blob = new Blob([bytes], { type: result.mimeType })
      const { input } = await uploadMeetingRecording({
        projectId: result.projectId,
        title: result.title ?? undefined,
        file: blob,
        fileName: recordingFileName(result),
        contentType: result.mimeType,
        resume: resumeRef.current,
        onStep: setStep,
        onCreated: (created) => {
          resumeRef.current = { ...resumeRef.current, created }
        },
      })
      // The local file goes away only after a successful send.
      silently(deleteRecording(result.path))
      writePendingRecording(null)
      setPending(null)
      resumeRef.current = EMPTY_RESUME
      setSentProjectId(input.project_id)
      setStep(null)
      setView('done')
    } catch (e) {
      if (e instanceof MeetingUploadError) resumeRef.current = e.resume
      setSendError(e instanceof Error && e.message ? e.message : 'Une erreur est survenue. Réessaie.')
      setStep(null)
    } finally {
      sendingRef.current = false
    }
  }

  useEffect(() => {
    runStopRef.current = () => void send()
  })

  // Initial state, then live events from the Rust shell.
  useEffect(() => {
    let active = true
    const unlisten: Array<() => void> = []
    const track = (promise: Promise<() => void>) =>
      void promise.then((off) => (active ? unlisten.push(off) : off())).catch(() => undefined)

    function applyPayload(payload: PromptPayload) {
      gotPromptRef.current = true
      setApps(payload.mic.apps)
      setRecording(payload.recording)
      if (sendingRef.current) return
      if (payload.reason === 'manual-stop') {
        runStopRef.current()
      } else if (payload.reason === 'mic-inactive') {
        setView('ended')
      } else if (payload.recording.status === 'recording') {
        setView('recording')
      } else if (readPendingRecording()) {
        // Un envoi a échoué : proposer de le relancer avant tout nouvel enregistrement.
        setSendError("Un enregistrement n'a pas encore été envoyé.")
        setView('sending')
      } else {
        setReason(payload.reason)
        setStartError(null)
        setView('propose')
      }
    }

    track(onPrompt(applyPayload))
    track(onRecordingState((state) => active && setRecording(state)))
    getStatus()
      .then((status) => {
        if (!active || gotPromptRef.current) return
        setApps(status.mic.apps)
        setRecording(status.recording)
        if (readPendingRecording()) {
          setSendError("Un enregistrement n'a pas encore été envoyé.")
          setView('sending')
        } else {
          setView(status.recording.status === 'recording' ? 'recording' : 'propose')
        }
      })
      .catch(() => {
        if (active) setView('propose')
      })
    return () => {
      active = false
      unlisten.forEach((off) => off())
    }
  }, [])

  // Hide the window by itself after a short confirmation.
  useEffect(() => {
    if (view !== 'done') return
    const timer = window.setTimeout(() => silently(hideCurrentWindow()), HIDE_AFTER_DONE_MS)
    return () => window.clearTimeout(timer)
  }, [view])

  async function onStart() {
    if (!projectId || starting) return
    setStarting(true)
    setStartError(null)
    try {
      const state = await startRecording({ projectId, title: null })
      writeLastProjectId(projectId)
      setRecording(state)
      setView('recording')
      window.setTimeout(() => silently(hideCurrentWindow()), HIDE_AFTER_START_MS)
    } catch (e) {
      setStartError(typeof e === 'string' && e ? e : "Impossible de démarrer l'enregistrement.")
    } finally {
      setStarting(false)
    }
  }

  const recordingProjectId = recording?.projectId ?? projectId
  const elapsed = recording?.elapsedSecs ?? 0
  const stopButton = (
    <Button variant="danger" onClick={() => void send()}>
      Arrêter et envoyer
    </Button>
  )

  if (view === 'loading' || (view === 'propose' && projects.isLoading)) {
    return (
      <main className={styles.bar} aria-label="Sordulo OS">
        <Spinner label="Chargement…" />
      </main>
    )
  }

  if (view === 'sending') {
    const problem = sendError ? `${sendError}${pending ? ' Le fichier est conservé sur cet ordinateur.' : ''}` : null
    return (
      <main className={styles.bar} aria-label="Envoi de l'enregistrement">
        {problem ? (
          <p className={[styles.message, styles.error].join(' ')} role="alert" title={problem}>
            {problem}
          </p>
        ) : (
          <p className={[styles.message, styles.step].join(' ')} aria-live="polite">
            <Spinner label="" />
            {step ? SEND_STEP_LABELS[step] : "Envoi de l'enregistrement…"}
          </p>
        )}
        {problem ? (
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => void send()}>
              Réessayer l'envoi
            </Button>
            <Button variant="secondary" onClick={() => silently(hideCurrentWindow())}>
              Fermer
            </Button>
          </div>
        ) : null}
      </main>
    )
  }

  if (view === 'done') {
    return (
      <main className={styles.bar} aria-label="Appel envoyé">
        <p className={[styles.message, styles.success].join(' ')} role="status">
          Appel envoyé dans {projectName(sentProjectId)} : la transcription démarre.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void showMainWindow()}>
            Ouvrir Sordulo OS
          </Button>
        </div>
      </main>
    )
  }

  if (view === 'recording' || view === 'ended') {
    return (
      <main className={styles.bar} aria-label={view === 'ended' ? 'Appel terminé ?' : 'Enregistrement en cours'}>
        <span className={styles.recDot} aria-hidden="true" />
        <p className={styles.timer} role="timer" aria-live="off" aria-label="Durée de l'enregistrement">
          {formatElapsed(elapsed)}
        </p>
        <p className={styles.message} title={projectName(recordingProjectId)}>
          {view === 'ended' ? "L'appel semble terminé" : projectName(recordingProjectId)}
        </p>
        <div className={styles.actions}>
          {stopButton}
          <Button variant="secondary" onClick={() => silently(hideCurrentWindow())}>
            {view === 'ended' ? 'Continuer' : 'Masquer'}
          </Button>
        </div>
      </main>
    )
  }

  // Proposition : choix du projet, puis Transcrire et Pas maintenant.
  const heading = reason === 'manual-start' ? 'Enregistrer un appel' : 'Transcrire cet appel ?'
  const appNames = apps.map((app) => app.displayName).join(', ')
  return (
    <main className={styles.bar} aria-label={appNames ? `${heading} (${appNames})` : heading}>
      {projects.isError ? (
        <p className={[styles.message, styles.error].join(' ')} role="alert">
          Impossible de charger les projets.{' '}
          <button type="button" className={styles.link} onClick={() => void projects.refetch()}>
            Réessayer
          </button>
        </p>
      ) : (
        <label className={styles.project}>
          <span className={styles.srOnly}>Projet</span>
          <Select value={projectId} onChange={(e) => setChosenProjectId(e.target.value)} disabled={starting}>
            {(projectList ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {startError ? (
        <p className={[styles.message, styles.error].join(' ')} role="alert" title={startError}>
          {startError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void onStart()} loading={starting} disabled={!projectId}>
          Transcrire
        </Button>
        <Button variant="secondary" onClick={() => silently(dismissPrompt())} disabled={starting}>
          Pas maintenant
        </Button>
      </div>
    </main>
  )
}
