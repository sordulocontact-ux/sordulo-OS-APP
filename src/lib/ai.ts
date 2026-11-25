/**
 * Appel d'une action IA (POST /api/ai/run). Les types de requête / réponse de chaque action sont dans
 * src/shared/ai/<action>.ts ; chaque fonctionnalité écrit son petit wrapper typé au-dessus de `runAi`.
 */
import type { AiActionName } from '../shared/ai-actions'
import { post } from './api'

export function runAi<TReq extends object, TRes>(action: AiActionName, body: TReq): Promise<TRes> {
  return post<TReq & { action: AiActionName }, TRes>('/api/ai/run', { ...body, action })
}
