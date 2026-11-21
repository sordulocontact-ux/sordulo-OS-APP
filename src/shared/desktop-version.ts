/**
 * Compatibilité entre l'API (Vercel, toujours à jour) et le front embarqué dans l'app de bureau installée.
 *
 * `DESKTOP_MIN_VERSION` : plus petite version de l'app de bureau dont le front sait encore parler à l'API
 * déployée. À monter à la main, dans le même commit, quand un changement de l'API casse les anciens fronts
 * (route renommée, champ obligatoire ajouté…). L'API la renvoie (`GET /api/desktop/min-version`) ; une app
 * plus ancienne se met à jour tout de suite au lieu de tomber en erreur.
 */
export const DESKTOP_MIN_VERSION = '0.1.0'

/** Compare deux versions « X.Y.Z » (suffixes ignorés) : négatif si a < b, 0 si égales, positif si a > b. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      ?.split('.')
      .map((part) => Number.parseInt(part, 10) || 0) ?? []
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
