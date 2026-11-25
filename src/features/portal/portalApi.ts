/** Appels du portail client public (sans session). */
import type { PortalActionRequest, PortalActionResponse, PortalResponse } from './portalContract'

/** Vide sur le web (même origine), l'URL de production dans l'app de bureau. */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '')

export class PortalApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function read<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Erreur ${response.status}`
    throw new PortalApiError(message, response.status)
  }
  return payload as T
}

async function send(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' })
  } catch {
    throw new PortalApiError('Serveur injoignable. Vérifiez votre connexion.', 0)
  }
}

export async function fetchPortal(token: string): Promise<PortalResponse> {
  const response = await send(`${API_BASE}/api/portal?token=${encodeURIComponent(token)}`, {
    headers: { accept: 'application/json' },
  })
  return read<PortalResponse>(response)
}

export async function postPortalAction(body: PortalActionRequest): Promise<PortalActionResponse> {
  const response = await send(`${API_BASE}/api/portal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return read<PortalActionResponse>(response)
}
