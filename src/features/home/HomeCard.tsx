import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, Icon } from '../../components/ui'
import type { Sentence } from './homeLogic'
import styles from './home.module.css'

/** Phrase de carte : éléments importants en noir, le reste en gris. */
export function SentenceText({ sentence }: { sentence: Sentence }) {
  return (
    <p className={styles.sentence}>
      {sentence.map((part, index) =>
        part.strong ? (
          <span key={index} className={styles.strong}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </p>
  )
}

export interface HomeCardProps {
  icon: string
  label: string
  to: string
  linkLabel: string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  /** Contenu prêt (jamais rendu pendant le chargement ou l'erreur). */
  children: ReactNode
}

/** Carte de l'Accueil : chargement discret, erreur courte avec réessai, sinon le contenu. */
export function HomeCard({ icon, label, to, linkLabel, isLoading, isError, onRetry, children }: HomeCardProps) {
  return (
    <section className={styles.card} aria-label={label}>
      <h2 className={styles.label}>
        <Icon src={icon} size="sm" />
        {label}
      </h2>
      <div className={styles.body}>
        {isLoading ? (
          <p className={styles.status} role="status">
            Chargement…
          </p>
        ) : isError ? (
          <ErrorState message="Impossible de charger cette carte." onRetry={onRetry} />
        ) : (
          children
        )}
      </div>
      <Link to={to} className={styles.more}>
        {linkLabel}
      </Link>
    </section>
  )
}
