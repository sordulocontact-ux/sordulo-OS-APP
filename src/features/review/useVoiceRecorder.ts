import { useCallback, useEffect, useRef, useState } from 'react'
import { VOICE_NOTE_MAX_SECONDS } from '../../shared/api-contract'
import { checkRecording, pickMimeType, recorderErrorMessage, VOICE_ERRORS } from './voiceNote'

/** starting = on attend l'autorisation du micro. */
export type VoiceRecorderState = 'idle' | 'starting' | 'recording' | 'transcribing'

export interface UseVoiceRecorderOptions {
  /** Envoie l'audio enregistré et renvoie le texte transcrit. */
  transcribe: (audio: Blob) => Promise<string>
  /** Reçoit le texte transcrit. */
  onTranscript: (text: string) => void
}

export interface VoiceRecorder {
  state: VoiceRecorderState
  /** Secondes écoulées depuis le début de l'enregistrement. */
  elapsed: number
  error: string | null
  start: () => Promise<void>
  stop: () => void
  clearError: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : VOICE_ERRORS.failed
}

/**
 * Enregistre une courte note au micro (MediaRecorder) puis la fait transcrire. Le micro est libéré
 * dès l'arrêt et au démontage ; l'enregistrement s'arrête seul à VOICE_NOTE_MAX_SECONDS.
 */
export function useVoiceRecorder({ transcribe, onTranscript }: UseVoiceRecorderOptions): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const callbacksRef = useRef({ transcribe, onTranscript })

  useEffect(() => {
    callbacksRef.current = { transcribe, onTranscript }
  }, [transcribe, onTranscript])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releaseMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      releaseMicrophone()
    }
  }, [clearTimer, releaseMicrophone])

  const handleRecording = useCallback(
    async (audio: Blob) => {
      const problem = checkRecording(audio.size)
      if (problem) {
        setError(problem)
        setState('idle')
        busyRef.current = false
        return
      }
      setState('transcribing')
      try {
        const text = await callbacksRef.current.transcribe(audio)
        if (mountedRef.current) callbacksRef.current.onTranscript(text)
      } catch (e) {
        if (mountedRef.current) setError(errorText(e))
      } finally {
        busyRef.current = false
        if (mountedRef.current) setState('idle')
      }
    },
    [],
  )

  const start = useCallback(async () => {
    if (busyRef.current) return
    setError(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(VOICE_ERRORS.unsupported)
      return
    }
    busyRef.current = true
    setState('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      busyRef.current = false
      if (mountedRef.current) {
        setError(recorderErrorMessage(e))
        setState('idle')
      }
      return
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    streamRef.current = stream

    let recorder: MediaRecorder
    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type))
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch (e) {
      releaseMicrophone()
      busyRef.current = false
      setError(recorderErrorMessage(e))
      setState('idle')
      return
    }
    const chunks: Blob[] = []
    let failed = false
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      failed = true
    }
    recorder.onstop = () => {
      clearTimer()
      releaseMicrophone()
      // Démonté : rien à transcrire, personne pour lire le texte.
      if (recorderRef.current !== recorder) return
      recorderRef.current = null
      if (failed) {
        busyRef.current = false
        setError(VOICE_ERRORS.failed)
        setState('idle')
        return
      }
      const type = recorder.mimeType || mimeType || 'audio/webm'
      void handleRecording(new Blob(chunks, { type }))
    }

    recorderRef.current = recorder
    try {
      recorder.start(1000)
    } catch (e) {
      recorderRef.current = null
      releaseMicrophone()
      busyRef.current = false
      setError(recorderErrorMessage(e))
      setState('idle')
      return
    }
    const startedAt = Date.now()
    setElapsed(0)
    setState('recording')
    timerRef.current = window.setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000
      setElapsed(seconds)
      if (seconds >= VOICE_NOTE_MAX_SECONDS) stop()
    }, 250)
  }, [clearTimer, handleRecording, releaseMicrophone, stop])

  const clearError = useCallback(() => setError(null), [])

  return { state, elapsed, error, start, stop, clearError }
}
