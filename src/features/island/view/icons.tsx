/**
 * Icônes de l'île : tracés de l'objet I du prototype (24 × 24, en trait), icône d'appel, icône Claude pixel.
 */
import claudeCodeIcon from '../../../assets/island/claude-code.png'
import type { CallService } from '../../../shared/desktop-contract'
import { callBrand } from '../brands'
import type { IslandIconName } from '../types'
import styles from './Island.module.css'

function IconPaths({ name }: { name: IslandIconName }) {
  switch (name) {
    case 'check':
      return <path className={styles.check} d="M6 12.5l4 4 8-9" />
    case 'euro':
      return <path d="M16.5 7a5.5 5.5 0 1 0 0 10M5.5 10.5h8M5.5 13.5h8" />
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2" />
        </>
      )
    case 'cal':
      return (
        <>
          <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </>
      )
    case 'tickets':
      return (
        <>
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M7.5 5h9M8 12.5h8M8 15.5h5" />
        </>
      )
    case 'agent':
      return <path d="M6 8l4 4-4 4M12.5 16.5h5" />
    case 'upload':
      return <path d="M12 15V5M7.5 9.5L12 5l4.5 4.5M5 19h14" />
    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
        </>
      )
    case 'cloud':
      return <path d="M7.5 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A3.75 3.75 0 0 1 17.5 18M12 12v7M9.5 14.5L12 12l2.5 2.5" />
    case 'bell':
      return (
        <>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </>
      )
    case 'alert':
      return (
        <>
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4M12 17v.5" />
        </>
      )
    case 'folder':
      return <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  }
}

export function IslandIcon({ name, className }: { name: IslandIconName; className?: string }) {
  return (
    <svg className={[styles.ico, className].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true">
      <IconPaths name={name} />
    </svg>
  )
}

/**
 * Icône de l'app d'appel, remplie à la couleur d'appel (`--island-call-tone`) : logo de la marque quand il
 * existe, sinon la caméra du prototype (service inconnu, ou marque sans logo libre).
 */
export function CallIcon({ className, service = null }: { className?: string; service?: CallService | null }) {
  const brand = callBrand(service)
  const classes = [styles.meetIcon, className].filter(Boolean).join(' ')
  if (brand.iconPath) {
    return (
      <svg className={classes} viewBox={brand.iconViewBox} aria-hidden="true">
        <path d={brand.iconPath} />
      </svg>
    )
  }
  return (
    <svg className={classes} viewBox={brand.iconViewBox} aria-hidden="true">
      <rect x="0" y="3" width="10.5" height="10" rx="2.2" />
      <path d="M11.5 7.2L15.2 4.6c.4-.3.8 0 .8.4v6c0 .4-.4.7-.8.4L11.5 8.8z" />
    </svg>
  )
}

/** Flèche de dépôt (glisser-déposer). */
export function DropIcon() {
  return (
    <svg className={styles.ico} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10M7.5 9.5L12 14l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

/** Micro de la zone « Transcrire ». */
export function MicIcon() {
  return (
    <svg className={styles.ico} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  )
}

/** Document avec lignes de texte (zone « Analyser »). */
export function DocumentIcon() {
  return (
    <svg className={styles.ico} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5V8h4M8.5 12h7M8.5 15h7M8.5 18h4" />
    </svg>
  )
}

/** Icône pixel de Claude Code fournie par Sacha (rendu net, sans lissage). */
export function ClaudeIcon({ className }: { className?: string }) {
  return <img className={[styles.pixel, className].filter(Boolean).join(' ')} src={claudeCodeIcon} alt="" draggable={false} />
}
