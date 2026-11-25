/** Appels des commandes vocales : transcription sans projet, action IA, création de la tâche confirmée. */
import { runAi } from '../../lib/ai'
import { ApiRequestError } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import type { VoiceCommandRequest, VoiceCommandResponse, VoiceTaskDraft } from '../../shared/ai/voiceCommand'
import type { ApiError, TranscribeVoiceResponse } from '../../shared/api-contract'
import { taskInsert } from './voiceCommandLogic'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/**
 * POST /api/voice/transcribe sans projectId (commande vocale : il suffit d'être membre actif).
 * `api.transcribeVoice` de src/lib/api.ts exige un projet : à unifier quand ce fichier accepte un projet facultatif.
 */
export async function transcribeCommand(audio: Blob): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiRequestError('Session expirée, reconnecte-toi.', 401)
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'content-type': audio.type || 'audio/webm', authorization: `Bearer ${token}` },
      body: audio,
    })
  } catch {
    throw new ApiRequestError('Serveur injoignable. Vérifie ta connexion.', 0)
  }
  const payload = (await response.json().catch(() => null)) as TranscribeVoiceResponse | ApiError | null
  if (!response.ok) {
    const message = payload && 'error' in payload ? payload.error : `Erreur ${response.status}`
    if (response.status === 401) void supabase.auth.signOut({ scope: 'local' })
    throw new ApiRequestError(message, response.status)
  }
  return (payload as TranscribeVoiceResponse).text
}

export function interpretCommand(body: VoiceCommandRequest): Promise<VoiceCommandResponse> {
  return runAi<VoiceCommandRequest, VoiceCommandResponse>('voiceCommand', body)
}

/** Crée la tâche confirmée, sous RLS (admin, membre), en fin de colonne « À faire ». Renvoie son id. */
export async function createVoiceTask(task: VoiceTaskDraft): Promise<string> {
  const last = await supabase
    .from('tasks')
    .select('position')
    .eq('project_id', task.projectId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (last.error) throw new Error(`Tâche non créée : ${last.error.message}`)
  const position = (last.data as { position: number } | null)?.position ?? null
  const { data, error } = await supabase.from('tasks').insert(taskInsert(task, position)).select('id').single()
  if (error) throw new Error(`Tâche non créée : ${error.message}`)
  return (data as { id: string }).id
}
