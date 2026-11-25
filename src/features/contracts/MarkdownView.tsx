import type { ReactNode } from 'react'
import { parseMarkdown, type MdInline } from './contractLogic'
import styles from './contracts.module.css'

function inline(parts: MdInline[]): ReactNode[] {
  return parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : p.italic ? <em key={i}>{p.text}</em> : <span key={i}>{p.text}</span>))
}

/** Rendu d'un Markdown simple (titres, listes, gras, italique). Le texte est toujours échappé par React. */
export function MarkdownView({ source, empty = 'Le contrat est vide.' }: { source: string; empty?: string }) {
  const blocks = parseMarkdown(source)
  if (blocks.length === 0) return <p className={styles.previewEmpty}>{empty}</p>
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4'
          return <Tag key={i}>{inline(b.inline)}</Tag>
        }
        if (b.type === 'list') {
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{inline(b.inline)}</p>
      })}
    </>
  )
}
