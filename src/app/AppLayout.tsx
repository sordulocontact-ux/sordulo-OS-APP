import { Outlet } from 'react-router-dom'
import { Avatar, Button } from '../components/ui'
import { useAuth } from '../features/auth/useAuth'
import { useCurrentMember } from '../features/auth/useCurrentMember'
import { DesktopRecordButton } from '../features/desktop/DesktopRecordButton'
import { useIsDesktop } from '../lib/desktop'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const { signOut } = useAuth()
  const { member, organization } = useCurrentMember()
  const desktop = useIsDesktop()

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <span className={styles.brand}>Sordulo OS</span>
          {organization ? <span className={styles.org}>{organization.name}</span> : null}
          {desktop ? (
            <div className={styles.desktopActions}>
              <DesktopRecordButton />
            </div>
          ) : null}
          <div className={desktop ? styles.userDesktop : styles.user}>
            {member ? (
              <>
                <Avatar name={member.name} />
                <span className={styles.userName}>{member.name}</span>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Déconnexion
            </Button>
          </div>
        </div>
      </header>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  )
}
