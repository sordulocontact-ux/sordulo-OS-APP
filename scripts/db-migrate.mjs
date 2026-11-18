// Applies supabase/migrations/*.sql not applied yet, in name order, one transaction per file.
// Applied migrations are tracked in sordulo_meta.migrations (schema not exposed by the Supabase API).
// Usage: npm run db:migrate
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT_DIR, connect, fail } from './lib/db.mjs'

const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations')
// Arbitrary constant: serializes concurrent runs (transaction-scoped, works through the pooler).
const LOCK_KEY = 74_201_118

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

async function listMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'))
}

async function ensureMetaTable(client) {
  await client.query(`
    create schema if not exists sordulo_meta;
    revoke all on schema sordulo_meta from public;
    create table if not exists sordulo_meta.migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `)
}

async function main() {
  const files = await listMigrationFiles()
  if (files.length === 0) fail(`Aucun fichier .sql dans ${path.relative(ROOT_DIR, MIGRATIONS_DIR)}.`)

  const client = await connect()
  let applied = 0
  try {
    await ensureMetaTable(client)

    for (const name of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8')
      const checksum = sha256(sql)

      await client.query('begin')
      try {
        await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY])
        const { rows } = await client.query('select checksum from sordulo_meta.migrations where name = $1', [name])

        if (rows.length > 0) {
          await client.query('rollback')
          if (rows[0].checksum !== checksum) {
            console.warn(`⚠ ${name} déjà appliquée mais modifiée depuis : créer une nouvelle migration plutôt.`)
          } else {
            console.log(`· ${name} déjà appliquée`)
          }
          continue
        }

        await client.query(sql)
        await client.query('insert into sordulo_meta.migrations (name, checksum) values ($1, $2)', [name, checksum])
        await client.query('commit')
        applied += 1
        console.log(`✔ ${name} appliquée`)
      } catch (error) {
        await client.query('rollback').catch(() => {})
        const where = error.position ? ` (position ${error.position})` : ''
        throw new Error(`${name} : ${error.message}${where}`, { cause: error })
      }
    }
  } finally {
    await client.end()
  }

  console.log(applied === 0 ? '\nBase à jour, rien à appliquer.' : `\n${applied} migration(s) appliquée(s).`)
}

main().catch((error) => fail(`Migration échouée, transaction annulée. ${error.message}`))
