import { supabase } from './supabase'
import type {
  ApiError,
  AudioUrlRequest,
  AudioUrlResponse,
  CreateInputRequest,
  CreateInputResponse,
  DeleteInputRequest,
  DeleteInputResponse,
  DesktopMinVersionResponse,
  InviteMemberRequest,
  InviteMemberResponse,
  MemberLinkRequest,
  MemberLinkResponse,
  ProcessInputRequest,
  ProcessInputResponse,
  ReviseTicketsRequest,
  ReviseTicketsResponse,
  TranscribeVoiceResponse,
} from '../shared/api-contract'

export class ApiRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Base de l'API : vide sur le web et en dev (chemins relatifs), l'URL de production dans l'app de bureau. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** Sends an authenticated POST and returns the JSON response; errors carry the server's French message. */
async function send<TRes>(path: string, contentType: string, body: BodyInit): Promise<TRes> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiRequestError('Session expirée, reconnecte-toi.', 401)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType, authorization: `Bearer ${token}` },
      body,
    })
  } catch {
    throw new ApiRequestError('Serveur injoignable. Vérifie ta connexion.', 0)
  }
  const payload = (await response.json().catch(() => null)) as TRes | ApiError | null
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : `Erreur ${response.status}`
    // Session révoquée ou expirée côté serveur : on l'oublie ici, l'app revient à l'écran de connexion.
    if (response.status === 401) void supabase.auth.signOut({ scope: 'local' })
    throw new ApiRequestError(message, response.status)
  }
  return payload as TRes
}

function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  return send<TRes>(path, 'application/json', JSON.stringify(body))
}

/** GET sans authentification : version minimale de l'app de bureau acceptée par l'API. */
async function getMinVersion(): Promise<DesktopMinVersionResponse> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/desktop/min-version`, { headers: { accept: 'application/json' } })
  } catch {
    throw new ApiRequestError('Serveur injoignable. Vérifie ta connexion.', 0)
  }
  const payload = (await response.json().catch(() => null)) as DesktopMinVersionResponse | ApiError | null
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload ? payload.error : `Erreur ${response.status}`
    throw new ApiRequestError(message, response.status)
  }
  return payload as DesktopMinVersionResponse
}

export const api = {
  /** Sans authentification. */
  desktopMinVersion: getMinVersion,
  createInput: (body: CreateInputRequest) => post<CreateInputRequest, CreateInputResponse>('/api/inputs/create', body),
  processInput: (body: ProcessInputRequest) =>
    post<ProcessInputRequest, ProcessInputResponse>('/api/inputs/process', body),
  deleteInput: (body: DeleteInputRequest) => post<DeleteInputRequest, DeleteInputResponse>('/api/inputs/delete', body),
  audioUrl: (body: AudioUrlRequest) => post<AudioUrlRequest, AudioUrlResponse>('/api/inputs/audio-url', body),
  /** Admins : ajoute un membre et renvoie son lien de connexion à usage unique (409 si l'email existe déjà). */
  inviteMember: (body: InviteMemberRequest) =>
    post<InviteMemberRequest, InviteMemberResponse>('/api/members/invite', body),
  /** Admins : nouveau lien de connexion pour un membre actif jamais connecté (409 sinon). */
  memberLink: (body: MemberLinkRequest) => post<MemberLinkRequest, MemberLinkResponse>('/api/members/link', body),
  /** « Note à l'IA » : réécrit les tickets proposés de l'entrée et met à jour la mémoire du projet. */
  reviseTickets: (body: ReviseTicketsRequest) =>
    post<ReviseTicketsRequest, ReviseTicketsResponse>('/api/review/revise', body),
  /** Transcrit une note vocale (audio brut, pas de stockage). */
  transcribeVoice: (projectId: string, audio: Blob) =>
    send<TranscribeVoiceResponse>(
      `/api/voice/transcribe?projectId=${encodeURIComponent(projectId)}`,
      audio.type || 'audio/webm',
      audio,
    ),
}
