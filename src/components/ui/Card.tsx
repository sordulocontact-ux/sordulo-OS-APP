import type { HTMLAttributes } from 'react'
import styles from './Card.module.css'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hover style, for cards that contain a link. */
  interactive?: boolean
}

export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={[styles.card, interactive ? styles.interactive : '', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
