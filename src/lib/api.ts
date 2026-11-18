import { supabase } from './supabase'
import type {
  ApiError,
  CreateInputRequest,
  CreateInputResponse,
  ProcessInputRequest,
  ProcessInputResponse,
} from '../shared/api-contract'

export class ApiRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiRequestError('Session expirée, reconnecte-toi.', 401)
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
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

export const api = {
  createInput: (body: CreateInputRequest) => post<CreateInputRequest, CreateInputResponse>('/api/inputs/create', body),
  processInput: (body: ProcessInputRequest) =>
    post<ProcessInputRequest, ProcessInputResponse>('/api/inputs/process', body),
}
