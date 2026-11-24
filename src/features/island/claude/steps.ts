/**
 * Textes tirés des outils de Claude Code : étape en cours (« Lit CLAUDE.md », « Modifie src/… »,
 * « Lance npm run typecheck »), sous-titre d'une demande d'autorisation (« Lancer une commande dans PDS OS »),
 * refus (« Commande refusée »). Le relais (src-tauri/src/claude/event.rs) envoie déjà un résumé court de
 * l'entrée de l'outil (`toolSummary`), chemin relatif au dossier de la session ; on le remet en forme ici.
 * Pur : ni React ni Tauri.
 */
import type { ClaudeActivity } from '../types'

/** Au-delà de cette longueur, un chemin est raccourci au milieu (« src/…/view/Island.tsx »). */
export const STEP_PATH_MAX_CHARS = 44
/** Au-delà de cette longueur, une commande, un motif ou une description sont coupés (« … »). */
export const STEP_TEXT_MAX_CHARS = 60
/** Début du premier prompt gardé comme tâche de la session. */
export const TASK_MAX_CHARS = 60

const ELLIPSIS = '…'

/** Coupe un texte trop long et termine par « … ». */
export function truncate(text: string, max: number): string {
  const chars = [...text.trim()]
  if (chars.length <= max) return chars.join('')
  return `${chars
    .slice(0, Math.max(1, max - 1))
    .join('')
    .trimEnd()}${ELLIPSIS}`
}

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Chemin affichable : barres obliques, relatif au dossier de la session quand il est dedans (comparaison
 * sans casse, comme Windows), raccourci au milieu s'il est long (premier dossier, « … », deux derniers).
 */
export function displayPath(path: string, cwd: string | null): string {
  let shown = toSlashes(path.trim())
  if (cwd) {
    const base = toSlashes(cwd.trim()).replace(/\/+$/, '')
    if (base && shown.toLowerCase().startsWith(`${base.toLowerCase()}/`)) shown = shown.slice(base.length + 1)
  }
  return shortenPath(shown)
}

/** « src/features/island/view/layers/ClaudeLayers.tsx » → « src/…/layers/ClaudeLayers.tsx ». */
export function shortenPath(path: string, max: number = STEP_PATH_MAX_CHARS): string {
  if (path.length <= max) return path
  const parts = path.split('/').filter((part) => part.length > 0)
  if (parts.length < 3) return truncate(path, max)
  const first = parts[0] ?? ''
  const tail = parts.slice(-2).join('/')
  const short = `${first}/${ELLIPSIS}/${tail}`
  if (short.length <= max) return short
  const last = parts[parts.length - 1] ?? ''
  return truncate(`${ELLIPSIS}/${last}`, max)
}

/** Dernier élément d'un chemin (« Island.tsx »). */
export function fileName(path: string): string {
  const parts = toSlashes(path).split('/').filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}

/** Domaine d'une URL sans « www. » (« docs.anthropic.com »), ou le texte tel quel s'il n'est pas une URL. */
export function webDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

/** Nom lisible d'un serveur MCP (« mcp__claude_ai_Figma__get_screenshot » → « Figma »). */
export function mcpServerName(toolName: string): string | null {
  const match = /^mcp__(.+?)__/.exec(toolName)
  if (!match?.[1]) return null
  return match[1].replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim() || null
}

/**
 * Activité du Claude de l'île pendant un outil : lit, fouille, écrit, lance une commande, va sur le web, lance
 * un sous-agent. Les autres outils (tâches, skills, MCP…) : il réfléchit.
 */
export function toolActivity(toolName: string | null): ClaudeActivity {
  if (!toolName) return 'think'
  if (isShellTool(toolName)) return 'command'
  if (isSubagentTool(toolName)) return 'subagent'
  if (isWriteTool(toolName)) return 'write'
  switch (toolName) {
    case 'Read':
    case 'NotebookRead':
      return 'read'
    case 'Grep':
    case 'Glob':
    case 'LS':
    case 'ToolSearch':
      return 'search'
    case 'WebFetch':
    case 'WebSearch':
      return 'web'
    default:
      return 'think'
  }
}

/** Outils qui écrivent un fichier (comptés dans les fichiers modifiés et les conflits). */
export function isWriteTool(toolName: string | null): boolean {
  return toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit'
}

/** Outils qui lancent un sous-agent. */
export function isSubagentTool(toolName: string | null): boolean {
  return toolName === 'Task' || toolName === 'Agent'
}

export function isShellTool(toolName: string | null): boolean {
  return toolName === 'Bash' || toolName === 'PowerShell'
}

/** Outils qui arrêtent une tâche lancée en arrière-plan (shell ou sous-agent). */
export function isBackgroundStopTool(toolName: string | null): boolean {
  return toolName === 'KillShell' || toolName === 'KillBash' || toolName === 'TaskStop'
}

/** Étape d'un shell ou d'un sous-agent lancé en arrière-plan. */
export function describeBackgroundStep(toolName: string | null, summary: string | null): string {
  const short = summary?.trim() ? truncate(summary, STEP_TEXT_MAX_CHARS) : null
  if (isSubagentTool(toolName)) {
    return short ? `Lance un sous-agent en arrière-plan : ${short}` : 'Lance un sous-agent en arrière-plan'
  }
  return short ? `Lance en arrière-plan : ${short}` : 'Lance une commande en arrière-plan'
}

/**
 * Ce que Claude attend une fois son tour fini : « Patiente : npm run dev » (un seul shell dont on connaît la
 * commande), sinon « Patiente : 2 shells et un sous-agent en cours ».
 */
export function patienceLabel(shells: number, agents: number, lastShell: string | null): string {
  if (shells === 1 && agents === 0 && lastShell?.trim()) return `Patiente : ${truncate(lastShell, STEP_TEXT_MAX_CHARS)}`
  const parts: string[] = []
  if (shells > 0) parts.push(shells === 1 ? 'un shell' : `${shells} shells`)
  if (agents > 0) parts.push(agents === 1 ? 'un sous-agent' : `${agents} sous-agents`)
  return parts.length > 0 ? `Patiente : ${parts.join(' et ')} en cours` : 'Patiente'
}

/** Sépare « motif dans dossier » (résumé de Grep par le relais) ; le dernier « dans » sépare. */
function splitGrep(summary: string): { pattern: string; dir: string | null } {
  const at = summary.lastIndexOf(' dans ')
  if (at <= 0) return { pattern: summary, dir: null }
  return { pattern: summary.slice(0, at), dir: summary.slice(at + ' dans '.length) }
}

/**
 * Étape en cours, en français, à partir de l'outil et de son résumé.
 * Null quand il n'y a pas d'outil (le rendu affiche alors la tâche).
 */
export function describeStep(toolName: string | null, summary: string | null, cwd: string | null): string | null {
  if (!toolName) return null
  const text = summary?.trim() ? summary.trim() : null
  const path = text ? displayPath(text, cwd) : null
  const short = text ? truncate(text, STEP_TEXT_MAX_CHARS) : null
  if (isShellTool(toolName)) return short ? `Lance ${short}` : 'Lance une commande'
  if (isSubagentTool(toolName)) return short ? `Lance un sous-agent : ${short}` : 'Lance un sous-agent'
  switch (toolName) {
    case 'Read':
    case 'NotebookRead':
      return path ? `Lit ${path}` : 'Lit un fichier'
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return path ? `Modifie ${path}` : 'Modifie un fichier'
    case 'Write':
      return path ? `Écrit ${path}` : 'Écrit un fichier'
    case 'Grep': {
      if (!text) return 'Cherche dans le code'
      const { pattern, dir } = splitGrep(text)
      const quoted = `"${truncate(pattern, STEP_TEXT_MAX_CHARS)}"`
      return dir ? `Cherche ${quoted} dans ${displayPath(dir, cwd)}` : `Cherche ${quoted}`
    }
    case 'Glob':
      return short ? `Cherche les fichiers ${short}` : 'Cherche des fichiers'
    case 'LS':
      return path ? `Parcourt ${path}` : 'Parcourt un dossier'
    case 'WebFetch':
      return text ? `Consulte ${webDomain(text)}` : 'Consulte une page web'
    case 'WebSearch':
      return short ? `Cherche sur le web "${short}"` : 'Cherche sur le web'
    case 'TodoWrite':
      return 'Met à jour ses tâches'
    case 'Skill':
      return short ? `Utilise le skill ${short}` : 'Utilise un skill'
    case 'AskUserQuestion':
      return 'Te pose une question'
    case 'ExitPlanMode':
      return 'Propose un plan'
    default: {
      const server = mcpServerName(toolName)
      if (server) return `Utilise ${server}`
      return short ? `Utilise ${toolName} : ${short}` : `Utilise ${toolName}`
    }
  }
}

/**
 * Sous-titre d'une demande d'autorisation (prototype : « Lancer une commande dans PDS OS »).
 */
export function askTitle(toolName: string, projectName: string): string {
  const where = `dans ${projectName}`
  if (toolName === 'AskUserQuestion') return `Question de Claude ${where}`
  if (isShellTool(toolName)) return `Lancer une commande ${where}`
  if (isSubagentTool(toolName)) return `Lancer un sous-agent ${where}`
  switch (toolName) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Modifier un fichier ${where}`
    case 'Write':
      return `Écrire un fichier ${where}`
    case 'Read':
    case 'NotebookRead':
      return `Lire un fichier ${where}`
    case 'WebFetch':
      return `Consulter une page web ${where}`
    case 'WebSearch':
      return `Chercher sur le web ${where}`
    default: {
      const server = mcpServerName(toolName)
      return `Utiliser ${server ?? toolName} ${where}`
    }
  }
}

/** Ce qui est demandé, affiché dans le bloc de code de la demande. */
export function askSummary(toolName: string, summary: string | null, cwd: string | null): string {
  const text = summary?.trim()
  if (!text) return toolName
  if (isWriteTool(toolName) || toolName === 'Read' || toolName === 'NotebookRead') return displayPath(text, cwd)
  return text
}

/** Début du refus affiché dans « Claude attend tes consignes » (prototype : « Commande refusée : npm run build »). */
export function refusalLabel(toolName: string): string {
  if (isShellTool(toolName)) return 'Commande refusée'
  if (isWriteTool(toolName)) return 'Modification refusée'
  return 'Action refusée'
}

/** « 1 fichier modifié », « 4 fichiers modifiés ». */
export function filesModifiedLabel(count: number): string {
  return `${count} ${count > 1 ? 'fichiers modifiés' : 'fichier modifié'}`
}

/**
 * Notification de Claude Code qui dit qu'il attend une consigne (et pas une autorisation, déjà montrée par
 * PermissionRequest) : « Claude is waiting for your input », messages d'inactivité.
 */
export function isWaitingForInput(message: string | null): boolean {
  if (!message) return false
  if (/permission|autoris/i.test(message)) return false
  return /waiting for your input|waiting for input|idle|attend (ta|tes|votre|vos)/i.test(message)
}
