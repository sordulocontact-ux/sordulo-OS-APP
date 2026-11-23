// Prépare une version de l'app de bureau : monte la version, commite et crée le tag. Ne pousse jamais.
// Le tag `vX.Y.Z` poussé déclenche .github/workflows/release.yml (build Mac + Windows, release GitHub).
//
// Usage : npm run release -- <X.Y.Z | patch | minor | major> [--dry-run]
//
// Utilisé aussi par la CI (.github/workflows/release.yml, push sur main) :
//   node scripts/release.mjs --next-auto              affiche la version suivante (patch + 1)
//   node scripts/release.mjs <X.Y.Z> --files-only     écrit la version dans les fichiers, sans git
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRANCH = 'main'
const CRATE = 'sordulo-os'
const FILES = {
  package: 'package.json',
  lock: 'package-lock.json',
  cargo: path.join('src-tauri', 'Cargo.toml'),
  cargoLock: path.join('src-tauri', 'Cargo.lock'),
}

const HELP = `Prépare une version de l'app de bureau (commit + tag, sans pousser).

Usage : npm run release -- <version> [--dry-run]

  <version>   X.Y.Z, ou patch / minor / major (à partir de la version de package.json)
  --dry-run   vérifie et affiche ce qui serait fait, sans rien écrire

Met à jour package.json, package-lock.json, src-tauri/Cargo.toml et src-tauri/Cargo.lock,
commite « chore(release): vX.Y.Z » et crée le tag annoté vX.Y.Z.`

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' })
  if (result.error) fail(`git introuvable : ${result.error.message}`)
  if (result.status !== 0 && !allowFailure) fail(`git ${args.join(' ')} : ${result.stderr.trim()}`)
  return { ok: result.status === 0, out: result.stdout.trimEnd() }
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function nextVersion(current, request) {
  const parts = SEMVER.exec(current)
  if (!parts) fail(`Version actuelle illisible dans package.json : ${current}`)
  const [major, minor, patch] = parts.slice(1).map(Number)
  if (request === 'major') return `${major + 1}.0.0`
  if (request === 'minor') return `${major}.${minor + 1}.0`
  if (request === 'patch') return `${major}.${minor}.${patch + 1}`
  const wanted = request.replace(/^v/, '')
  if (!SEMVER.test(wanted)) fail(`Version invalide : ${request} (attendu X.Y.Z, patch, minor ou major).`)
  return wanted
}

function isGreater(a, b) {
  const [x, y] = [a, b].map((v) => SEMVER.exec(v).slice(1).map(Number))
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/**
 * Version de départ : la plus haute entre package.json et les tags vX.Y.Z. Les releases faites à
 * chaque push sur main créent un tag sans toucher à package.json : sans ça, on repartirait en arrière.
 */
function baseVersion() {
  const fromPackage = JSON.parse(readFileSync(path.join(ROOT_DIR, FILES.package), 'utf8')).version
  const tags = git(['tag', '--list', 'v*'], { allowFailure: true }).out.split(/\r?\n/)
  return tags
    .map((tag) => tag.trim().replace(/^v/, ''))
    .filter((v) => SEMVER.test(v))
    .reduce((best, v) => (isGreater(v, best) ? v : best), fromPackage)
}

/** Remplace la première correspondance, et échoue si rien ne correspond (format inattendu). */
function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) fail(`${what} : version introuvable.`)
  return text.replace(pattern, replacement)
}

function bumpFiles(version) {
  const read = (file) => readFileSync(path.join(ROOT_DIR, file), 'utf8')
  const changes = {}

  changes[FILES.package] = replaceOnce(
    read(FILES.package),
    /^(\s*"version":\s*")[^"]+(")/m,
    `$1${version}$2`,
    FILES.package,
  )

  // package-lock.json : version en tête et celle du paquet racine (packages[""]).
  const lock = JSON.parse(read(FILES.lock))
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  changes[FILES.lock] = `${JSON.stringify(lock, null, 2)}\n`

  // Cargo.toml : la ligne `version` de la section [package] (avant toute autre section).
  changes[FILES.cargo] = replaceOnce(
    read(FILES.cargo),
    /^(\[package\][^[]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
    FILES.cargo,
  )

  // Cargo.lock : l'entrée du paquet de l'app, modifiée à la main (même résultat que
  // `cargo update -p sordulo-os`, sans réseau ni risque de toucher aux autres dépendances).
  changes[FILES.cargoLock] = replaceOnce(
    read(FILES.cargoLock),
    new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${CRATE}"\\r?\\nversion = ")[^"]+(")`),
    `$1${version}$2`,
    FILES.cargoLock,
  )
  return changes
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    console.log(HELP)
    if (args.length === 0) process.exit(1)
    return
  }
  if (args.includes('--next-auto')) {
    console.log(nextVersion(baseVersion(), 'patch'))
    return
  }
  const dryRun = args.includes('--dry-run')
  const positional = args.filter((arg) => !arg.startsWith('--'))
  if (positional.length !== 1) fail('Une seule version attendue (ex. npm run release -- 0.3.0).')

  if (args.includes('--files-only')) {
    const wanted = positional[0].replace(/^v/, '')
    if (!SEMVER.test(wanted)) fail(`Version invalide : ${positional[0]} (attendu X.Y.Z).`)
    for (const [file, content] of Object.entries(bumpFiles(wanted))) writeFileSync(path.join(ROOT_DIR, file), content)
    console.log(`Version ${wanted} écrite (sans commit).`)
    return
  }

  // Vérifications : en simulation, signalées sans arrêter, pour voir le reste.
  const problems = []
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out
  if (branch !== BRANCH) problems.push(`branche courante « ${branch} », la release se fait depuis ${BRANCH}.`)
  const dirty = git(['status', '--porcelain']).out
  if (dirty) problems.push(`l'arbre git n'est pas propre :\n${dirty.replace(/^/gm, '    ')}`)

  const current = baseVersion()
  const version = nextVersion(current, positional[0])
  const tag = `v${version}`
  if (!isGreater(version, current)) problems.push(`${version} n'est pas supérieure à la version actuelle ${current}.`)
  if (git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFailure: true }).ok) {
    problems.push(`le tag ${tag} existe déjà.`)
  }
  for (const problem of problems) console.error(`${dryRun ? '!' : '✖'} ${problem}`)
  if (problems.length > 0 && !dryRun) process.exit(1)

  const changes = bumpFiles(version)
  console.log(`\nVersion ${current} → ${version}${dryRun ? ' (simulation, rien n\'est écrit)' : ''}`)
  for (const file of Object.keys(changes)) console.log(`  ${file}`)
  const message = `chore(release): ${tag}`
  console.log(`  git commit -m "${message}"`)
  console.log(`  git tag -a ${tag} -m "Sordulo OS ${tag}"`)
  if (dryRun) return

  for (const [file, content] of Object.entries(changes)) writeFileSync(path.join(ROOT_DIR, file), content)
  git(['add', '--', ...Object.keys(changes)])
  git(['commit', '-m', message])
  git(['tag', '-a', tag, '-m', `Sordulo OS ${tag}`])

  console.log(`\n✔ Commit et tag ${tag} créés (rien n'est poussé).

Ensuite :
  1. Prévenir l'autre avant de pousser (on travaille tous les deux sur ${BRANCH}).
  2. Pousser la branche ET le tag :
       - GitHub Desktop : « Push origin » pousse aussi les tags ;
       - en ligne de commande : git push --follow-tags
  3. Suivre la compilation : onglet Actions du dépôt (workflow « Release app de bureau »).
     La release ${tag} est publiée quand Mac et Windows ont réussi ; les apps installées
     se mettent à jour seules ensuite.

Annuler avant de pousser : git tag -d ${tag} && git reset --keep HEAD~1`)
}

main()
