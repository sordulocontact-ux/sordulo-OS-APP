// Shared helpers for the local database scripts (migrations, seed).
// Never logs the connection string or any secret.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'
import pg from 'pg'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Loads .env.local then .env (values already set win; .env.local wins over .env). */
export function loadEnv() {
  dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), quiet: true })
  dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true })
}

/** Prints a French error and exits with code 1. */
export function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

/** Reads a required environment variable, or exits with a clear message. */
export function requireEnv(name, hint) {
  const value = process.env[name]?.trim()
  if (!value) fail(`Variable d'environnement ${name} manquante (.env.local ou .env).${hint ? `\n  ${hint}` : ''}`)
  return value
}

/**
 * Connection config from SUPABASE_DB_URL.
 * SSL is on with rejectUnauthorized: false (Supabase uses its own CA).
 * `sslmode=disable` in the URL turns SSL off (local test database only).
 */
function connectionConfig(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    fail('SUPABASE_DB_URL n’est pas une URL valide (attendu : postgresql://user:password@host:5432/postgres).')
  }
  const sslMode = url.searchParams.get('sslmode')
  // pg lets the URL's sslmode override the `ssl` option: strip it and decide here.
  url.searchParams.delete('sslmode')
  return {
    connectionString: url.toString(),
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
    application_name: 'sordulo-os-scripts',
  }
}

/** Loads env, connects and returns a pg.Client. */
export async function connect() {
  loadEnv()
  const rawUrl = requireEnv(
    'SUPABASE_DB_URL',
    'Supabase > Project Settings > Database > Connection string (URI, mode « Session »), mot de passe inclus.',
  )
  const client = new pg.Client(connectionConfig(rawUrl))
  try {
    await client.connect()
  } catch (error) {
    fail(`Connexion à la base impossible : ${error.message}`)
  }
  return client
}
