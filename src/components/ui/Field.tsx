import { useId, type ReactNode } from 'react'
import { FieldContext } from './fieldContext'
import styles from './Field.module.css'

export interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}

/** Label + hint + error message wired to the control (TextInput, Textarea, Select) it wraps. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={styles.field}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {children}
        {hint ? (
          <p id={hintId} className={styles.hint}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}
