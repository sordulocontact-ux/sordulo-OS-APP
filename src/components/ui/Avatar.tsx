import styles from './Avatar.module.css'
import { initials } from './initials'

export interface AvatarProps {
  name: string
  className?: string
}


export function Avatar({ name, className }: AvatarProps) {
  return (
    <span className={[styles.avatar, className].filter(Boolean).join(' ')} role="img" aria-label={name} title={name}>
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
