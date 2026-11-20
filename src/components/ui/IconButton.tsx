import type { ButtonHTMLAttributes, Ref } from 'react'
import { Icon } from './Icon'
import styles from './IconButton.module.css'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  /** URL du SVG importé. */
  icon: string
  /** Nom accessible, repris en infobulle. */
  label: string
  ref?: Ref<HTMLButtonElement>
}

/** Bouton carré bordé à icône seule (Figma : filtre et « + » des pages de liste). */
export function IconButton({ icon, label, className, type = 'button', ref, ...rest }: IconButtonProps) {
  return (
    <button ref={ref} type={type} title={label} aria-label={label} className={[styles.button, className].filter(Boolean).join(' ')} {...rest}>
      <Icon src={icon} />
    </button>
  )
}
