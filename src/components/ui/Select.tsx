import type { SelectHTMLAttributes } from 'react'
import { useFieldControlProps } from './fieldContext'
import styles from './formControl.module.css'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>

/** Native select: pass <option> elements as children. */
export function Select({ className, children, ...rest }: SelectProps) {
  const fieldProps = useFieldControlProps()
  return (
    <select {...fieldProps} {...rest} className={[styles.control, className].filter(Boolean).join(' ')}>
      {children}
    </select>
  )
}
