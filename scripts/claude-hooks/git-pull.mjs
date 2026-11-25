#!/usr/bin/env node
// Hook Claude Code (SessionStart et UserPromptSubmit, déclaré dans .claude/settings.json) :
// récupère le travail de l'autre (Maël / Sacha) AVANT de créer ou coder quoi que ce soit.
//
// - git fetch, puis seulement un pull en avance rapide (`git merge --ff-only @{u}`) : jamais de commit de
//   fusion ni de conflit créés par le hook. Les modifications locales non commitées sont gardées (git refuse
//   l'avance rapide si elles touchent les mêmes fichiers : le hook le signale au lieu de forcer).
// - Branche divergée (commits locaux ET distants) : rien n'est fait, Claude est prévenu qu'il faut un
//   `git pull` (fusion) avant de coder.
// - Rien pendant une fusion ou un rebase en cours, ni plus d'une fois par minute, ni sans réseau (silencieux).
// Ce qui est écrit sur la sortie standard arrive dans le contexte de Claude. Node seul : marche sous Windows et macOS.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const THROTTLE_MS = 60_000

function git(args, timeout = 15_000) {
  return execFileSync('git', args, { cwd, timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function main() {
  let gitDir
  try {
    gitDir = path.resolve(cwd, git(['rev-parse', '--git-dir']))
  } catch {
    return // pas un dépôt git
  }
  if (['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some((f) => existsSync(path.join(gitDir, f)))) {
    console.log('[pull auto] Fusion ou rebase en cours : pas de pull. Termine-la avant de coder.')
    return
  }

  const stamp = path.join(gitDir, 'claude-last-pull')
  try {
    if (Date.now() - Number(readFileSync(stamp, 'utf8')) < THROTTLE_MS) return
  } catch {
    // premier passage
  }
  try {
    writeFileSync(stamp, String(Date.now()))
  } catch {
    // dossier .git en lecture seule : on continue sans limite
  }

  let upstream
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  } catch {
    return // branche sans suivi distant
  }
  const remote = upstream.split('/')[0]
  try {
    git(['fetch', '--quiet', remote], 20_000)
  } catch {
    return // hors ligne ou identifiants absents : on ne bloque pas le travail
  }

  const [ahead, behind] = git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).split(/\s+/).map(Number)
  if (!behind) return

  const incoming = git(['log', '--oneline', '--no-decorate', `HEAD..${upstream}`])
  if (ahead > 0) {
    console.log(
      `[pull auto] ${upstream} a ${behind} commit(s) que tu n'as pas, et tu as ${ahead} commit(s) locaux : ` +
        `fais un \`git pull\` (fusion) AVANT de coder.\nCommits à récupérer :\n${incoming}`,
    )
    return
  }
  try {
    git(['merge', '--ff-only', '--quiet', upstream], 30_000)
    console.log(`[pull auto] ${behind} commit(s) de ${upstream} récupérés avant de commencer :\n${incoming}`)
  } catch (error) {
    const reason = String(error.stderr || error.message).split('\n').filter(Boolean).slice(0, 3).join(' ')
    console.log(
      `[pull auto] ${upstream} a ${behind} commit(s) nouveaux mais le pull automatique a échoué ` +
        `(modifications locales sur les mêmes fichiers ?) : ${reason}\nFais le pull à la main avant de coder.\n${incoming}`,
    )
  }
}

try {
  main()
} catch (error) {
  // Un hook ne doit jamais bloquer la session.
  console.error(`[pull auto] ${error instanceof Error ? error.message : String(error)}`)
}
