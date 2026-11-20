/**
 * Textes des regroupements (prototype : setDigest).
 * « 4 nouveautés » ou « Pendant l'appel : 3 notifications », sous-titre « titre 1, titre 2 et N autres ».
 */

export function digestTexts(titles: readonly string[], duringCall = false): { title: string; subtitle: string } {
  const count = titles.length
  const title = duringCall
    ? `Pendant l'appel : ${count} ${count > 1 ? 'notifications' : 'notification'}`
    : `${count} nouveautés`
  const others = count - 2
  const rest = others > 0 ? ` et ${others} ${others > 1 ? 'autres' : 'autre'}` : ''
  return { title, subtitle: titles.slice(0, 2).join(', ') + rest }
}
