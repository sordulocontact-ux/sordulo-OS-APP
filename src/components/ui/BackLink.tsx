import { Link } from 'react-router-dom'
import arrowIcon from '../../assets/icons/arrow-left.svg'
import styles from './BackLink.module.css'

export interface BackLinkProps {
  to: string
  label: string
}

/** Lien de retour vers la page parente : flèche (style des icônes de la barre latérale), texte gris, noir au survol. */
export function BackLink({ to, label }: BackLinkProps) {
  return (
    <Link to={to} className={styles.link}>
      <img src={arrowIcon} alt="" width={16} height={16} className={styles.icon} />
      {label}
    </Link>
  )
}
