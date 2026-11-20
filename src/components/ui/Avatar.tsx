import styles from './Avatar.module.css'
import { initials } from './initials'

export interface AvatarProps {
  name: string
  /** `sm` pour une cellule de tableau (à côté d'un nom). */
  size?: 'sm' | 'md'
  className?: string
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      className={[styles.avatar, size === 'sm' ? styles.sm : '', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={name}
      title={name}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
