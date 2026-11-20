// Applique des fichiers SQL donnés, chacun dans sa propre transaction, sur la base de SUPABASE_DB_URL.
// Pour une production où des migrations ont été collées à la main (pas de sordulo_meta) : enregistre
// ensuite les migrations du dossier passées en argument comme appliquées, pour que db:migrate les saute.
// Usage : node scripts/db-apply-files.mjs <fichier.sql> [autres.sql…] [--mark <migration déjà appliquée.sql>…]
// Les fichiers après --mark ne sont PAS exécutés : seulement notés comme appliqués.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT_DIR, connect, fail } from './lib/db.mjs'

const args = process.argv.slice(2)
const markAt = args.indexOf('--mark')
const files = markAt >= 0 ? args.slice(0, markAt) : args
const markOnly = markAt >= 0 ? args.slice(markAt + 1) : []
if (files.length === 0 && markOnly.length === 0) fail('Donne au moins un fichier .sql.')

const client = await connect()
try {
  for (const file of files) {
    const sql = await readFile(path.resolve(file), 'utf8')
    await client.query('begin')
    try {
      await client.query(sql.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, ''))
      await client.query('commit')
      console.log(`✔ ${path.basename(file)} appliqué`)
    } catch (error) {
      await client.query('rollback')
      fail(`${path.basename(file)} : ${error.message}\n  Rien n'a été modifié pour ce fichier.`)
    }
  }
  // Migrations du dépôt passées en argument : notées comme appliquées (même table que db:migrate).
  await client.query(`create schema if not exists sordulo_meta; revoke all on schema sordulo_meta from public;
    create table if not exists sordulo_meta.migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`)
  for (const file of [...markOnly, ...files].filter((f) => path.resolve(f).startsWith(path.join(ROOT_DIR, 'supabase', 'migrations')))) {
    const sql = await readFile(path.resolve(file), 'utf8')
    await client.query('insert into sordulo_meta.migrations (name, checksum) values ($1, $2) on conflict (name) do nothing', [
      path.basename(file), createHash('sha256').update(sql).digest('hex'),
    ])
  }
  console.log('Migrations notées comme appliquées :', (await client.query('select name from sordulo_meta.migrations order by name')).rows.map((r) => r.name).join(', '))
} finally {
  await client.end()
}
