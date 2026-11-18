import { useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, LoadingState } from '../../components/ui'
import { isDesktop, showMainWindow } from '../../lib/desktop'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { MemberGate } from '../auth/MemberGate'
import { DesktopPromptPage } from './DesktopPromptPage'
import styles from './DesktopPromptPage.module.css'

/** Re-reads the shared session when the window becomes visible or focused (login done in the main window). */
function useSessionSync(): void {
  useEffect(() => {
    function sync() {
      if (document.visibilityState === 'hidden') return
      void supabase.auth.getSession().then(({ data }) => {
        const session = data.session
        if (session) {
          // Notifies the AuthProvider of this window when the session was created elsewhere.
          void supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
        }
      })
    }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
}

function DesktopAuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  useSessionSync()
  if (loading) return <LoadingState label="Connexion en cours…" />
  if (!session) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Connexion requise</h1>
        <p className={styles.text} role="status">
          Connecte-toi dans la fenêtre principale de Sordulo OS.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void showMainWindow()}>
            Ouvrir Sordulo OS
          </Button>
        </div>
      </main>
    )
  }
  return children
}

/** /desktop/prompt: only inside Tauri, behind the session (no redirect to /login in the small window). */
export function DesktopPromptRoute() {
  if (!isDesktop()) return <Navigate to="/" replace />
  return (
    <DesktopAuthGate>
      <MemberGate>
        <DesktopPromptPage />
      </MemberGate>
    </DesktopAuthGate>
  )
}
