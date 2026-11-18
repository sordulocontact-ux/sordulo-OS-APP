import { Spinner } from './Spinner'
import styles from './LoadingState.module.css'

export interface LoadingStateProps {
  label?: string
}

export function LoadingState({ label = 'Chargement…' }: LoadingStateProps) {
  return (
    <div className={styles.root}>
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  )
}
