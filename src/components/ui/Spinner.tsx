import styles from './Spinner.module.css'

export interface SpinnerProps {
  /** Accessible text. Pass an empty string when the parent already announces the state. */
  label?: string
  className?: string
}

export function Spinner({ label = 'Chargement…', className }: SpinnerProps) {
  return (
    <span className={[styles.root, className].filter(Boolean).join(' ')} role={label ? 'status' : undefined}>
      <span className={styles.ring} aria-hidden="true" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  )
}
