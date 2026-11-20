/**
 * Nom de projet d'une session Claude Code : le projet Sordulo OS dont le nom correspond au dossier de la
 * session, sinon le nom du dossier. Pur : ni React ni Tauri.
 */

/** Projet Sordulo OS connu de l'île (même forme que IslandProjectOption). */
export interface ClaudeProjectRef {
  id: string
  name: string
}

/** Nombre de dossiers, en partant du plus profond, comparés aux projets (ex. session lancée dans `repo/src`). */
export const PROJECT_MATCH_DEPTH = 3

/** Nom affiché quand le dossier de la session est inconnu. */
export const UNKNOWN_PROJECT_NAME = 'Projet inconnu'

/**
 * Forme comparable d'un nom : minuscules, sans accents, sans tirets, espaces, points ni soulignés.
 * « Sordulo OS », « sordulo-OS » et « sordulo_os » donnent tous « sorduloos ».
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Dossiers d'un chemin Windows ou Unix, du plus haut au plus profond (sans lecteur ni séparateurs vides). */
export function pathSegments(path: string): string[] {
  return path
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && !/^[a-z]:$/i.test(segment))
}

/** Dernier dossier d'un chemin (« sordulo-OS » pour `C:\…\GitHub\sordulo-OS\`), chaîne vide sinon. */
export function folderName(path: string | null): string {
  if (!path) return ''
  const segments = pathSegments(path)
  return segments[segments.length - 1] ?? ''
}

/**
 * Projet d'une session à partir de son dossier : le premier projet dont le nom normalisé égale un des
 * PROJECT_MATCH_DEPTH derniers dossiers (le plus profond d'abord), sinon le nom du dossier.
 */
export function matchProject(
  cwd: string | null,
  projects: readonly ClaudeProjectRef[],
): { projectName: string; projectId: string | null } {
  const segments = cwd ? pathSegments(cwd) : []
  if (projects.length > 0) {
    const byName = new Map<string, ClaudeProjectRef>()
    for (const project of projects) {
      const key = normalizeName(project.name)
      if (key && !byName.has(key)) byName.set(key, project)
    }
    for (const segment of segments.slice(-PROJECT_MATCH_DEPTH).reverse()) {
      const project = byName.get(normalizeName(segment))
      if (project) return { projectName: project.name, projectId: project.id }
    }
  }
  return { projectName: segments[segments.length - 1] ?? UNKNOWN_PROJECT_NAME, projectId: null }
}
