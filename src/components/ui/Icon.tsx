import type { CSSProperties, HTMLAttributes } from 'react'
import styles from './Icon.module.css'

export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  /** URL du SVG importé (`import plusIcon from '…/plus.svg'`). */
  src: string
  /** md = 20 px (dans un bouton), sm = 16 px. */
  size?: 'sm' | 'md'
}

/**
 * Icône SVG peinte dans la couleur du texte (`currentColor`) : elle suit le bouton ou le lien qui la
 * contient (blanc sur un bouton primaire, gris sur un bouton fantôme). Décorative : masquée aux
 * lecteurs d'écran, le libellé du parent suffit.
 */
export function Icon({ src, size = 'md', className, style, ...rest }: IconProps) {
  const mask: CSSProperties = { maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }
  return (
    <span
      aria-hidden="true"
      className={[styles.icon, styles[size], className].filter(Boolean).join(' ')}
      style={{ ...mask, ...style }}
      {...rest}
    />
  )
}
