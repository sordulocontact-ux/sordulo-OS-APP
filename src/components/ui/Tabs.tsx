import { Link, useMatch, useResolvedPath } from 'react-router-dom'
import styles from './Tabs.module.css'

export interface TabItem {
  /** Route path, relative to the current route (e.g. "tickets") or absolute. */
  to: string
  label: string
}

export interface TabsProps {
  items: TabItem[]
  /** Accessible name of the tab list. */
  label: string
}

function TabLink({ to, label }: TabItem) {
  const resolved = useResolvedPath(to)
  const isActive = useMatch({ path: resolved.pathname, end: false }) !== null
  return (
    <Link
      to={to}
      role="tab"
      aria-selected={isActive}
      aria-current={isActive ? 'page' : undefined}
      className={[styles.tab, isActive ? styles.active : ''].filter(Boolean).join(' ')}
    >
      {label}
    </Link>
  )
}

/** Route-based tabs: the active tab is the one matching the URL. */
export function Tabs({ items, label }: TabsProps) {
  return (
    <div role="tablist" aria-label={label} className={styles.list}>
      {items.map((item) => (
        <TabLink key={item.to} {...item} />
      ))}
    </div>
  )
}
