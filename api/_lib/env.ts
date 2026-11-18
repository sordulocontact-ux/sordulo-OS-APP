/** Server environment variables. A missing variable gives a clear error (never the value). */

export const SERVER_ENV_NAMES = [
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'TRANSCRIPTION_API_KEY',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
] as const
export type ServerEnvName = (typeof SERVER_ENV_NAMES)[number]

export class MissingEnvError extends Error {
  readonly variable: ServerEnvName
  constructor(variable: ServerEnvName) {
    super(
      `Configuration serveur incomplète : la variable ${variable} est absente. ` +
        `Ajoute-la dans .env.local (dev) ou dans les variables du projet Vercel.`,
    )
    this.name = 'MissingEnvError'
    this.variable = variable
  }
}

export function getEnv(name: ServerEnvName): string {
  const value = process.env[name]?.trim()
  if (!value) throw new MissingEnvError(name)
  return value
}

/** Optional variable: the trimmed value, or undefined when absent or empty. */
export function getOptionalEnv(name: ServerEnvName): string | undefined {
  return process.env[name]?.trim() || undefined
}
