import type { HTMLAttributes } from 'react'
import styles from './Badge.module.css'

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'bug'
  | 'modification'
  | 'new_request'
  | 'design'
  | 'dev'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={[styles.badge, styles[tone], className].filter(Boolean).join(' ')}>
      {children}
    </span>
  )
}
