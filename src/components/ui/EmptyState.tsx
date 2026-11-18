import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: string
  text?: string
  action?: ReactNode
}

export function EmptyState({ title, text, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      <h3 className={styles.title}>{title}</h3>
      {text ? <p className={styles.text}>{text}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
