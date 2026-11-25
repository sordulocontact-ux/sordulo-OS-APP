import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/queryKeys'
import type { VoiceCommandResponse } from '../../shared/ai/voiceCommand'
import { useVoiceRecorder } from '../review/useVoiceRecorder'
import { createVoiceTask, interpretCommand, transcribeCommand } from './voiceApi'
import { commandErrorMessage } from './voiceCommandLogic'

/**
 * closed : rien d'ouvert. voice : micro (ouverture, écoute, transcription). thinking : l'IA lit la commande.
 * result : réponse ou tâche à confirmer. saving / saved : création de la tâche confirmée. error : échec.
 */
export type VoiceStage = 'closed' | 'voice' | 'thinking' | 'result' | 'saving' | 'saved' | 'error'

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

export interface UseVoiceCommandOptions {
  /** Page affichée, envoyée à l'IA pour comprendre « ce projet ». */
  path: string
  /** Navigation proposée par l'IA (aucune écriture : faite tout de suite). */
  onNavigate: (path: string) => void
}

export function useVoiceCommand({ path, onNavigate }: UseVoiceCommandOptions) {
  const client = useQueryClient()
  const [stage, setStage] = useState<VoiceStage>('closed')
  const [result, setResult] = useState<VoiceCommandResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Numéro de la commande en cours ; null = fermée. Fermée pendant l'écoute ou la réflexion : la suite est
  // ignorée (jamais d'action après coup).
  const counterRef = useRef(0)
  const activeRef = useRef<number | null>(null)
  const optionsRef = useRef({ path, onNavigate })
  useEffect(() => {
    optionsRef.current = { path, onNavigate }
  }, [path, onNavigate])

  const onTranscript = useCallback(async (text: string) => {
    const run = activeRef.current
    if (run === null) return
    if (!text.trim()) {
      setError('Je n’ai rien entendu. Réessaie en parlant près du micro.')
      setStage('error')
      return
    }
    setStage('thinking')
    try {
      const response = await interpretCommand({ text: text.trim(), path: optionsRef.current.path })
      if (run !== activeRef.current) return
      if (response.intent === 'navigate') {
        activeRef.current = null
        setStage('closed')
        optionsRef.current.onNavigate(response.path)
        return
      }
      setResult(response)
      setStage('result')
    } catch (e) {
      if (run !== activeRef.current) return
      setError(messageOf(e, 'La commande n’a pas pu être traitée. Réessaie.'))
      setStage('error')
    }
  }, [])

  const voice = useVoiceRecorder({ transcribe: transcribeCommand, onTranscript: (text) => void onTranscript(text) })

  const begin = useCallback(() => {
    counterRef.current += 1
    activeRef.current = counterRef.current
    setResult(null)
    setError(null)
    voice.clearError()
    setStage('voice')
    void voice.start()
  }, [voice])

  const close = useCallback(() => {
    activeRef.current = null
    if (voice.state === 'recording') voice.stop()
    setStage('closed')
    setResult(null)
    setError(null)
  }, [voice])

  const confirm = useCallback(async () => {
    if (result?.intent !== 'create_task') return
    setStage('saving')
    try {
      await createVoiceTask(result.task)
      void client.invalidateQueries({ queryKey: queryKeys.tasks(result.task.projectId) })
      setStage('saved')
    } catch (e) {
      setError(messageOf(e, 'La tâche n’a pas pu être créée. Réessaie.'))
      setStage('result')
    }
  }, [client, result])

  // Erreur du micro ou de la transcription : affichée comme un échec de la commande.
  const voiceError = stage === 'voice' && voice.state === 'idle' && voice.error ? commandErrorMessage(voice.error) : null

  return {
    stage: voiceError ? ('error' as const) : stage,
    voiceState: voice.state,
    elapsed: voice.elapsed,
    result,
    error: voiceError ?? error,
    begin,
    stop: voice.stop,
    close,
    confirm,
  }
}
