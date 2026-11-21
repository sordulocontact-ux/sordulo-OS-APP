/**
 * Fallback AI analysis with Mistral (free tier), used when Claude is unavailable.
 * Same input (system prompt + user message built by analysis.ts) and same output (post-processed tickets).
 * The prompt is passed in by the caller so it is built in one place only.
 */
import { Mistral } from '@mistralai/mistralai'
import { MistralError } from '@mistralai/mistralai/models/errors/mistralerror.js'
import { HTTPClientError } from '@mistralai/mistralai/models/errors/httpclienterrors.js'
import { z } from 'zod'
import { AnalysisSchema, type Analysis } from '../../src/shared/analysis-schema.js'
import { postProcessAnalysis, type ProcessedTicket } from './analysis-postprocess.js'
import { getEnv, getOptionalEnv } from './env.js'

const MAX_ATTEMPTS = 2
const MISTRAL_MAX_TOKENS = 16000
const DEFAULT_MODEL = 'mistral-small-latest'

export interface MistralAnalysisRequest {
  system: string
  content: string
  openTicketIds: readonly string[]
  /** Ids du bloc <equipe> : seules personnes que l'IA peut désigner. */
  teamMemberIds: readonly string[]
}

/** True when the Mistral fallback is configured. */
export function isMistralConfigured(): boolean {
  return getOptionalEnv('MISTRAL_API_KEY') !== undefined
}

/** Readable French message for a Mistral SDK error. */
export function describeMistralError(error: unknown, model: string): string {
  if (error instanceof MistralError) {
    const status = error.statusCode
    if (status === 401) return 'clé MISTRAL_API_KEY refusée par l’API Mistral.'
    if (status === 403) return 'cette clé n’a pas accès à l’API Mistral ou à ce modèle.'
    if (status === 404) return `modèle introuvable (MISTRAL_MODEL = ${model}).`
    if (status === 429) return 'limite de requêtes de l’API Mistral atteinte.'
    if (status >= 500) return `API Mistral momentanément indisponible (${status}).`
    return `erreur de l’API Mistral (${status}) : ${error.message.slice(0, 300)}`
  }
  if (error instanceof HTTPClientError) return 'API Mistral injoignable (erreur réseau).'
  return error instanceof Error ? error.message : String(error)
}

let client: Mistral | null = null
function getClient(): Mistral {
  if (!client) client = new Mistral({ apiKey: getEnv('MISTRAL_API_KEY'), timeoutMs: 150_000 })
  return client
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((chunk) => (chunk && typeof chunk === 'object' && 'text' in chunk && typeof chunk.text === 'string' ? chunk.text : '')).join('')
}

/**
 * Calls Mistral (JSON schema mode) and returns the validated, post-processed tickets.
 * Invalid or missing JSON: one new attempt, then an error. Truncation: error.
 * Error messages are in French.
 */
export async function analyzeWithMistral(request: MistralAnalysisRequest): Promise<ProcessedTicket[]> {
  const model = getOptionalEnv('MISTRAL_MODEL') ?? DEFAULT_MODEL
  const jsonSchema = z.toJSONSchema(AnalysisSchema) as Record<string, unknown>
  let lastProblem = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Awaited<ReturnType<Mistral['chat']['complete']>>
    try {
      response = await getClient().chat.complete({
        model,
        maxTokens: MISTRAL_MAX_TOKENS,
        temperature: 0.2,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.content },
        ],
        responseFormat: { type: 'json_schema', jsonSchema: { name: 'analysis', schemaDefinition: jsonSchema } },
      })
    } catch (error) {
      throw new Error(describeMistralError(error, model), { cause: error })
    }

    const choice = response.choices[0]
    console.log(
      `[analysis] mistral tentative ${attempt} : finish=${choice?.finishReason ?? 'aucun'} entrée=${response.usage?.promptTokens ?? 0} sortie=${response.usage?.completionTokens ?? 0}`,
    )
    if (!choice) {
      lastProblem = 'réponse vide'
      continue
    }
    if (choice.finishReason === 'length' || choice.finishReason === 'model_length') {
      throw new Error('la réponse de Mistral a été coupée (limite de longueur atteinte). Découpe l’entrée en plusieurs parties.')
    }
    const text = messageText(choice.message?.content).trim()
    if (text === '') {
      lastProblem = 'réponse vide'
      console.error(`[analysis] mistral tentative ${attempt} : réponse vide`)
      continue
    }

    let analysis: Analysis
    try {
      analysis = AnalysisSchema.parse(JSON.parse(text))
    } catch (error) {
      lastProblem = 'JSON non conforme au schéma'
      console.error(`[analysis] mistral tentative ${attempt} : ${error instanceof Error ? error.message.slice(0, 500) : 'JSON invalide'}`)
      continue
    }
    return postProcessAnalysis(analysis, request.openTicketIds, request.teamMemberIds)
  }
  throw new Error(`Mistral a renvoyé une réponse invalide deux fois de suite (${lastProblem}).`)
}
