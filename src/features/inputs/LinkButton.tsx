import { Link, type LinkProps } from 'react-router-dom'
import styles from './LinkButton.module.css'

export interface LinkButtonProps extends LinkProps {
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
}

/** A link that looks like the kit's Button (navigation, so it must stay an <a>). */
export function LinkButton({ variant = 'secondary', size = 'md', className, ...rest }: LinkButtonProps) {
  return <Link {...rest} className={[styles.link, styles[variant], styles[size], className].filter(Boolean).join(' ')} />
}
