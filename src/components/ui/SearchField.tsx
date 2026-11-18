import type { InputHTMLAttributes } from 'react'
import searchIcon from '../../assets/icons/search.svg'
import styles from './SearchField.module.css'

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name (the placeholder is not a label). */
  label: string
}

/** Figma « Search » : champ pleine largeur, loupe à gauche, angles droits. */
export function SearchField({ label, className, placeholder = 'Rechercher', ...rest }: SearchFieldProps) {
  return (
    <label className={[styles.field, className].filter(Boolean).join(' ')}>
      <img src={searchIcon} alt="" width={20} height={20} className={styles.icon} />
      <span className={styles.srOnly}>{label}</span>
      <input {...rest} type="search" placeholder={placeholder} className={styles.input} />
    </label>
  )
}
