import type { MemberRole } from '../../shared/types'
import type { HighlightPart, QuickAction, SearchGroup, SearchResult, SearchSource } from './types'

/** Nombre maximal de résultats par groupe. */
export const GROUP_LIMIT = 5

/** Délai de frappe avant de lancer la recherche. */
export const DEBOUNCE_MS = 150

/** Retire les espaces en trop et passe en minuscules sans accents (comparaison tolérante). */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Sources visibles pour ce rôle, triées par `order` puis par ordre d'enregistrement. */
export function filterSourcesByRole<T extends { roles: readonly MemberRole[]; order?: number }>(
  sources: readonly T[],
  role: MemberRole | null,
): T[] {
  if (role === null) return []
  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.roles.includes(role))
    .sort((a, b) => (a.source.order ?? 1000) - (b.source.order ?? 1000) || a.index - b.index)
    .map(({ source }) => source)
}

export function filterActionsByRole(actions: readonly QuickAction[], role: MemberRole | null): QuickAction[] {
  return role === null ? [] : actions.filter((action) => action.roles.includes(role))
}

/** Échappe `%`, `_` et `\` pour un motif `ilike`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Motif `ilike` « contient », prêt pour `.ilike(colonne, motif)`.
 * Les `*` sont remplacés par des espaces : PostgREST les traite comme des jokers.
 */
export function containsPattern(query: string): string {
  return `%${escapeLike(query.trim().replace(/\*/g, ' '))}%`
}

/**
 * Valeur d'un filtre `.or()` : le motif est mis entre guillemets pour que virgules et parenthèses
 * de la saisie ne cassent pas la syntaxe PostgREST.
 */
export function orIlike(columns: readonly string[], query: string): string {
  const quoted = `"${containsPattern(query).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',')
}

/** Rang d'un texte pour une requête : 0 exact, 1 commence par, 2 un mot commence par, 3 contient, 4 absent. */
export function matchRank(text: string, query: string): number {
  const haystack = normalize(text)
  const needle = normalize(query)
  if (needle === '') return 4
  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1
  if (haystack.split(/[\s\-_/.·]+/).some((word) => word.startsWith(needle))) return 2
  return haystack.includes(needle) ? 3 : 4
}

/** Trie les résultats par pertinence (stable : à rang égal, l'ordre de la source est gardé) et coupe à `limit`. */
export function rankResults(results: readonly SearchResult[], query: string, limit = GROUP_LIMIT): SearchResult[] {
  return results
    .map((result, index) => ({
      result,
      index,
      rank: Math.min(matchRank(result.title, query), matchRank(result.subtitle ?? '', query) + 0.5),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ result }) => result)
}

/** Garde les groupes non vides, dans l'ordre reçu. */
export function buildGroups(entries: readonly { source: Pick<SearchSource, 'id' | 'label'>; items: readonly SearchResult[] }[]): SearchGroup[] {
  return entries
    .filter(({ items }) => items.length > 0)
    .map(({ source, items }) => ({ id: source.id, label: source.label, items: [...items] }))
}

/** Résultats à plat, dans l'ordre d'affichage : c'est l'ordre de la navigation au clavier. */
export function flattenGroups(groups: readonly SearchGroup[]): SearchResult[] {
  return groups.flatMap((group) => group.items)
}

/** Index suivant ou précédent, en bouclant. `-1` = rien de sélectionné. */
export function moveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return (current + delta + count) % count
}

/**
 * Découpe `text` en morceaux pour surligner la requête, sans tenir compte des accents ni de la casse.
 * Les index sont recalculés sur le texte d'origine : la normalisation se fait lettre à lettre.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = normalize(query)
  if (needle === '' || text === '') return [{ text, match: false }]

  const chars = Array.from(text)
  const folded = chars.map((char) => normalize(char) || char.toLowerCase())
  const flat = folded.join('')
  // owner[i] = index (dans chars) du caractère qui a produit la lettre i de `flat`.
  const owner: number[] = []
  folded.forEach((piece, charIndex) => {
    for (let k = 0; k < piece.length; k += 1) owner.push(charIndex)
  })

  const start = flat.indexOf(needle)
  if (start === -1) return [{ text, match: false }]
  const first = owner[start] as number
  const last = owner[start + needle.length - 1] as number

  const parts: HighlightPart[] = []
  if (first > 0) parts.push({ text: chars.slice(0, first).join(''), match: false })
  parts.push({ text: chars.slice(first, last + 1).join(''), match: true })
  if (last + 1 < chars.length) parts.push({ text: chars.slice(last + 1).join(''), match: false })
  return parts
}
