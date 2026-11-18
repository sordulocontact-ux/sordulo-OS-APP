import type { InputHTMLAttributes } from 'react'
import { useFieldControlProps } from './fieldContext'
import styles from './formControl.module.css'

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

export function TextInput({ className, type = 'text', ...rest }: TextInputProps) {
  const fieldProps = useFieldControlProps()
  return <input {...fieldProps} {...rest} type={type} className={[styles.control, className].filter(Boolean).join(' ')} />
}
