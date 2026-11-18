import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import briefcaseIcon from '../assets/icons/briefcase.svg'
import sidebarIcon from '../assets/icons/sidebar.svg'
import { Avatar, Button } from '../components/ui'
import { useAuth } from '../features/auth/useAuth'
import { useCurrentMember } from '../features/auth/useCurrentMember'
import { DesktopRecordButton } from '../features/desktop/DesktopRecordButton'
import { useIsDesktop } from '../lib/desktop'
import styles from './AppLayout.module.css'

const NAV = [{ to: '/', label: 'Projets', icon: briefcaseIcon, end: false }] as const

/** Barre latérale d'icônes (Figma « Sidebar ») + contenu de la page. */
export function AppLayout() {
  const { signOut } = useAuth()
  const { member, organization } = useCurrentMember()
  const desktop = useIsDesktop()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Ferme le menu du compte au clic à l'extérieur ou avec Échap.
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.top}>
          <span className={styles.brand} title="Sordulo OS">
            <img src={sidebarIcon} alt="Sordulo OS" width={17} height={13} />
          </span>
          <nav aria-label="Navigation principale" className={styles.nav}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) => [styles.navItem, isActive ? styles.navActive : ''].filter(Boolean).join(' ')}
              >
                <img src={item.icon} alt="" width={20} height={20} />
              </NavLink>
            ))}
            {desktop ? <DesktopRecordButton variant="icon" /> : null}
          </nav>
        </div>
        <div className={styles.account} ref={menuRef}>
          <button
            type="button"
            className={styles.accountButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={member ? `Compte de ${member.name}` : 'Compte'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Avatar name={member?.name ?? '?'} />
          </button>
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              {member ? <p className={styles.menuName}>{member.name}</p> : null}
              {organization ? <p className={styles.menuOrg}>{organization.name}</p> : null}
              <Button variant="secondary" size="sm" role="menuitem" onClick={() => void signOut()}>
                Déconnexion
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  )
}
