/**
 * Markdown très simple du texte des contrats, rendu sans HTML brut : titres (#, ##, ###), listes
 * (- ou *), paragraphes ; les marques ** et __ sont retirées. Le reste est affiché tel quel.
 */
export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

function clean(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim()
}

export function markdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: string[] | null = null

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: clean(paragraph.join('\n')) })
    paragraph = []
    if (list) blocks.push({ type: 'list', items: list })
    list = null
  }

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (!line.trim()) {
      flush()
    } else if (heading?.[1] && heading[2] !== undefined) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: clean(heading[2]) })
    } else if (item?.[1] !== undefined) {
      if (paragraph.length > 0) {
        blocks.push({ type: 'paragraph', text: clean(paragraph.join('\n')) })
        paragraph = []
      }
      list ??= []
      list.push(clean(item[1]))
    } else {
      if (list) {
        blocks.push({ type: 'list', items: list })
        list = null
      }
      paragraph.push(line)
    }
  }
  flush()
  return blocks.filter((b) => (b.type === 'list' ? b.items.length > 0 : b.text.length > 0))
}
