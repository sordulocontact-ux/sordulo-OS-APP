// Construit l'app de bureau installable (Tauri) : relais Claude Code, puis `tauri build` avec
// src-tauri/tauri.release.conf.json fusionnée à la config de base.
//
// Usage : npm run desktop:build [-- [--target <triple>] [--out <dossier>] [--dry-run] [args de tauri build]]
//   --target universal-apple-darwin   app Mac universelle (Apple silicon + Intel)
//   --target x86_64-pc-windows-msvc   installeur Windows ; sans --target : la machine courante
//   --out <dossier>                   copie les installeurs aux noms de la release + fragment de latest.json (CI)
//   --dry-run                         affiche les commandes sans rien lancer
//
// Relais Claude Code `sordulo-hook` : un `[[bin]]` du même paquet, déclaré AUSSI en `externalBin` dans la
// config de release, car Tauri ne signe (codesign) que l'exécutable principal et les `externalBin`. Or
// tauri-build vérifie la présence de `binaries/sordulo-hook-<triple>` en compilant le paquet : on compile
// donc le relais d'abord. D'où aussi `externalBin` hors de la config de base (sinon `tauri dev` casserait).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TAURI_DIR = path.join(ROOT_DIR, 'src-tauri')
const RELEASE_CONFIG = path.join(TAURI_DIR, 'tauri.release.conf.json')
const TAURI_CLI = path.join(ROOT_DIR, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const UNIVERSAL = 'universal-apple-darwin'
const MAC_ARCHES = ['aarch64-apple-darwin', 'x86_64-apple-darwin']
// API appelée par le front embarqué quand VITE_API_BASE_URL n'est défini nulle part.
const DEFAULT_API_BASE_URL = 'https://sordulo-os-app.vercel.app'
// Nom de base des fichiers publiés (sans espace : GitHub remplace les espaces des noms d'assets).
const ASSET_BASE = 'Sordulo-OS'

const HELP = `Construit l'app de bureau installable.

Usage : npm run desktop:build -- [options] [arguments de tauri build]

  --target <triple>   universal-apple-darwin, aarch64-apple-darwin, x86_64-apple-darwin,
                      x86_64-pc-windows-msvc… (défaut : la machine courante, d'après rustc -vV)
  --out <dossier>     copie les installeurs aux noms publiés et écrit updater-<os>.json (CI)
  --dry-run           affiche les commandes sans les lancer
  -h, --help          cette aide

Variables lues :
  TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD)   signe les mises à jour ; absente : build local sans
                                            fichiers de mise à jour (obligatoire avec --out)
  APPLE_SIGNING_IDENTITY                    identité de signature Mac (absente : signature ad hoc)
  APPLE_CERTIFICATE (+ _PASSWORD)           certificat .p12 en base64, importé par Tauri dans un
                                            trousseau temporaire (CI)
  VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL   front embarqué (ou .env.local)`

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { target: null, out: null, dryRun: false, help: false, passthrough: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) fail(`${arg} attend une valeur.`)
      i += 1
      return next
    }
    if (arg === '--') {
      options.passthrough.push(...argv.slice(i + 1))
      break
    }
    if (arg === '--target' || arg === '-t') options.target = value()
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length)
    else if (arg === '--out') options.out = value()
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length)
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else options.passthrough.push(arg)
  }
  return options
}

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)

function run(command, args, { dryRun, env } = {}) {
  const shown = [command === process.execPath ? 'node' : command, ...args].map((arg) =>
    path.isAbsolute(arg) && arg.startsWith(ROOT_DIR) ? path.relative(ROOT_DIR, arg) : arg,
  )
  console.log(`\n$ ${shown.map(quote).join(' ')}`)
  if (dryRun) return
  const result = spawnSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit', env: env ?? process.env })
  if (result.error) fail(`${command} introuvable ou impossible à lancer : ${result.error.message}`)
  if (result.status !== 0) fail(`${command} a échoué (code ${result.status ?? result.signal}).`)
}

function hostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (result.status !== 0) fail('rustc introuvable : installer Rust (https://rustup.rs).')
  const host = /^host: (\S+)$/m.exec(result.stdout)?.[1]
  if (!host) fail('Cible de la machine illisible dans « rustc -vV ».')
  return host
}

// Variables vides (secret GitHub non défini) retirées : Tauri traiterait "" comme une valeur.
function cleanEnv() {
  const env = { ...process.env }
  for (const name of [
    'TAURI_SIGNING_PRIVATE_KEY',
    'APPLE_CERTIFICATE',
    'APPLE_CERTIFICATE_PASSWORD',
    'APPLE_SIGNING_IDENTITY',
  ]) {
    if (env[name] === '') delete env[name]
  }
  // Front embarqué : sans base, il appellerait /api sur tauri://localhost. Vite donne la priorité à
  // l'environnement sur les fichiers .env : on ne complète que si aucun fichier ne la définit.
  const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local']
  const inFiles = envFiles.some((file) => {
    const full = path.join(ROOT_DIR, file)
    return existsSync(full) && /^[ \t]*VITE_API_BASE_URL[ \t]*=[ \t]*[^\s#]/m.test(readFileSync(full, 'utf8'))
  })
  if (!env.VITE_API_BASE_URL && !inFiles) {
    env.VITE_API_BASE_URL = DEFAULT_API_BASE_URL
    console.log(`VITE_API_BASE_URL absente : ${DEFAULT_API_BASE_URL}`)
  }
  return env
}

function findFile(dir, predicate, what) {
  const files = existsSync(dir) ? readdirSync(dir).filter(predicate) : []
  if (files.length !== 1) {
    fail(`${what} : ${files.length} fichier(s) trouvé(s) dans ${path.relative(ROOT_DIR, dir)} (1 attendu).`)
  }
  return path.join(dir, files[0])
}

/** Copie les installeurs aux noms publiés et écrit le fragment de latest.json de cette plateforme. */
function collect({ target, explicitTarget, version, outDir, dryRun }) {
  const bundleDir = path.join(TAURI_DIR, 'target', explicitTarget ? target : '', 'release', 'bundle')
  const out = path.resolve(ROOT_DIR, outDir)
  console.log(`\nCopie des fichiers publiés dans ${path.relative(ROOT_DIR, out) || '.'}`)
  if (dryRun) return
  mkdirSync(out, { recursive: true })
  const copies = []
  const platforms = {}

  if (target.endsWith('apple-darwin')) {
    const label = target === UNIVERSAL ? 'universal' : target.startsWith('aarch64') ? 'aarch64' : 'x64'
    const dmg = findFile(path.join(bundleDir, 'dmg'), (f) => f.endsWith('.dmg') && f.includes(`_${version}_`), 'DMG')
    const update = findFile(path.join(bundleDir, 'macos'), (f) => f.endsWith('.app.tar.gz'), 'Mise à jour Mac')
    const updateAsset = `${ASSET_BASE}_${version}_${label}.app.tar.gz`
    copies.push([dmg, `${ASSET_BASE}_${version}_${label}.dmg`], [dmg, `${ASSET_BASE}-macOS.dmg`], [update, updateAsset])
    const signature = readFileSync(`${update}.sig`, 'utf8').trim()
    const arches = target === UNIVERSAL ? MAC_ARCHES : [target]
    for (const arch of arches) {
      platforms[`darwin-${arch.split('-')[0]}`] = { signature, asset: updateAsset }
    }
  } else if (target.includes('windows')) {
    const arch = target.split('-')[0]
    const label = arch === 'x86_64' ? 'x64' : arch
    const setup = findFile(
      path.join(bundleDir, 'nsis'),
      (f) => f.endsWith('-setup.exe') && f.includes(`_${version}_`),
      'Installeur NSIS',
    )
    const setupAsset = `${ASSET_BASE}_${version}_${label}-setup.exe`
    copies.push([setup, setupAsset], [setup, `${ASSET_BASE}-Windows-setup.exe`])
    // Sous Windows, la mise à jour est l'installeur NSIS lui-même (lancé en mode silencieux).
    platforms[`windows-${arch}`] = { signature: readFileSync(`${setup}.sig`, 'utf8').trim(), asset: setupAsset }
  } else {
    fail(`Cible non gérée pour la publication : ${target}`)
  }

  for (const [from, name] of copies) {
    copyFileSync(from, path.join(out, name))
    console.log(`  ${name}`)
  }
  const os = target.includes('windows') ? 'windows' : 'macos'
  const fragment = path.join(out, `updater-${os}.json`)
  writeFileSync(fragment, `${JSON.stringify({ version, platforms }, null, 2)}\n`)
  console.log(`  ${path.basename(fragment)} (${Object.keys(platforms).join(', ')})`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  const { dryRun } = options
  const host = hostTriple()
  const target = options.target ?? host
  const explicitTarget = options.target !== null
  const isMac = target.endsWith('apple-darwin')
  const isWindows = target.includes('windows')
  if (!isMac && !isWindows) fail(`Cible non prise en charge : ${target} (Mac ou Windows seulement).`)
  if (isMac && !host.endsWith('apple-darwin')) fail('Une app Mac se compile sur un Mac.')
  if (isWindows && !host.includes('windows')) fail('Un installeur Windows se compile sous Windows.')

  const version = JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version
  const releaseConfig = JSON.parse(readFileSync(RELEASE_CONFIG, 'utf8'))
  const minMacos = releaseConfig.bundle?.macOS?.minimumSystemVersion
  const env = cleanEnv()
  console.log(`Sordulo OS ${version} pour ${target}${dryRun ? ' (simulation)' : ''}`)
  if (options.out && !env.TAURI_SIGNING_PRIVATE_KEY) {
    fail('TAURI_SIGNING_PRIVATE_KEY manquante : une release sans mise à jour signée est inutile.')
  }

  // 0. Front embarqué : `generate_context!` exige `dist/` dès la compilation du relais (même paquet), donc
  //    avant l'étape 1. `tauri build` ne le refait pas (beforeBuildCommand vidé plus bas).
  //    npm_execpath : le npm qui a lancé ce script (`npm run desktop:build`), sans passer par un shell
  //    (npm.cmd sous Windows).
  const npmCli = process.env.npm_execpath
  if (npmCli) run(process.execPath, [npmCli, 'run', 'build'], { dryRun, env })
  else if (!isWindows) run('npm', ['run', 'build'], { dryRun, env })
  else fail('Lancer ce script par npm run desktop:build.')

  // 1. Relais Claude Code, une copie par cible dans `src-tauri/binaries/` (externalBin). Pour l'app
  //    universelle : aussi la version assemblée (lipo) en `binaries/` et dans
  //    `target/universal-apple-darwin/release/`, où Tauri cherche chaque `[[bin]]` du paquet (il n'assemble
  //    lui-même que l'exécutable principal).
  //    Même fonctionnalité que `tauri build` (tauri/custom-protocol) : les dépendances déjà compilées
  //    pour le relais resservent à l'app au lieu d'être recompilées.
  const exe = isWindows ? '.exe' : ''
  const binariesDir = path.join(TAURI_DIR, 'binaries')
  if (!dryRun) mkdirSync(binariesDir, { recursive: true })
  const arches = target === UNIVERSAL ? MAC_ARCHES : [target]
  const hookEnv = isMac && minMacos ? { ...env, MACOSX_DEPLOYMENT_TARGET: minMacos } : env
  const archBinaries = []
  for (const arch of arches) {
    const cargoArgs = ['build', '--release', '--manifest-path', path.join('src-tauri', 'Cargo.toml')]
    cargoArgs.push('--bin', 'sordulo-hook', '--features', 'tauri/custom-protocol')
    if (explicitTarget) cargoArgs.push('--target', arch)
    run('cargo', cargoArgs, { dryRun, env: hookEnv })
    const built = path.join(TAURI_DIR, 'target', explicitTarget ? arch : '', 'release', `sordulo-hook${exe}`)
    const dest = path.join(binariesDir, `sordulo-hook-${arch}${exe}`)
    console.log(`  → ${path.relative(ROOT_DIR, dest)}`)
    if (!dryRun) copyFileSync(built, dest)
    archBinaries.push(dest)
  }
  if (target === UNIVERSAL) {
    const universalDir = path.join(TAURI_DIR, 'target', UNIVERSAL, 'release')
    if (!dryRun) mkdirSync(universalDir, { recursive: true })
    const universal = path.join(binariesDir, `sordulo-hook-${UNIVERSAL}`)
    const bundled = path.join(universalDir, 'sordulo-hook')
    console.log(`  → ${path.relative(ROOT_DIR, universal)}, ${path.relative(ROOT_DIR, bundled)}`)
    run('lipo', ['-create', '-output', universal, ...archBinaries], { dryRun })
    if (!dryRun) copyFileSync(universal, bundled)
  }

  // 2. App + installeurs.
  const tauriArgs = ['build', '--config', RELEASE_CONFIG]
  tauriArgs.push('--config', JSON.stringify({ build: { beforeBuildCommand: '' } }))
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    console.warn(
      '\n! TAURI_SIGNING_PRIVATE_KEY absente : build local sans fichiers de mise à jour (createUpdaterArtifacts désactivé).',
    )
    tauriArgs.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }))
  }
  if (isMac && !env.APPLE_SIGNING_IDENTITY) {
    console.warn('\n! APPLE_SIGNING_IDENTITY absente : app signée ad hoc (suffisant pour tester sur ce Mac).')
  }
  tauriArgs.push('--bundles', isMac ? 'app,dmg' : 'nsis')
  if (explicitTarget) tauriArgs.push('--target', target)
  tauriArgs.push(...options.passthrough)
  if (!existsSync(TAURI_CLI) && !dryRun) fail('CLI Tauri absente : lancer npm install.')
  run(process.execPath, [TAURI_CLI, ...tauriArgs], { dryRun, env })

  if (options.out) collect({ target, explicitTarget, version, outDir: options.out, dryRun })

  const bundleDir = path.join('src-tauri', 'target', explicitTarget ? target : '', 'release', 'bundle')
  console.log(`\n${dryRun ? 'Simulation terminée' : '✔ Terminé'} : installeurs dans ${path.normalize(bundleDir)}`)
}

main()
