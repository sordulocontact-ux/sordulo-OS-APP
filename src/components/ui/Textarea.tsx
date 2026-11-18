import type { TextareaHTMLAttributes } from 'react'
import { useFieldControlProps } from './fieldContext'
import styles from './formControl.module.css'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className, rows = 5, ...rest }: TextareaProps) {
  const fieldProps = useFieldControlProps()
  return (
    <textarea
      {...fieldProps}
      {...rest}
      rows={rows}
      className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
    />
  )
}
