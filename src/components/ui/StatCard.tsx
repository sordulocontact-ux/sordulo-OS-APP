import { Link } from 'react-router-dom'
import styles from './StatCard.module.css'

export interface StatCardProps {
  /** Chiffre déjà formaté (« 12 », « 70 h »). */
  value: string | number
  label: string
  /** Sous-texte en gris (« 2 en retard »). */
  hint?: string
  /** Si fourni, toute la carte est un lien (par exemple vers la liste filtrée). */
  to?: string
}

/** Carte de chiffre d'une page de liste (Midday « Invoices », Figma « Contrats »). */
export function StatCard({ value, label, hint, to }: StatCardProps) {
  const content = (
    <>
      <span className={styles.value}>{value}</span>
      <span className={styles.label}>{label}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </>
  )
  return to ? (
    <Link to={to} className={[styles.card, styles.link].join(' ')}>
      {content}
    </Link>
  ) : (
    <div className={styles.card}>{content}</div>
  )
}
