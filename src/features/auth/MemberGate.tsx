import type { ReactNode } from 'react'
import { Button, Card, ErrorState, LoadingState } from '../../components/ui'
import { useAuth } from './useAuth'
import { useCurrentMember } from './useCurrentMember'
import styles from './AuthScreen.module.css'

export function MemberGate({ children }: { children: ReactNode }) {
  const { signOut } = useAuth()
  const { member, isLoading, isError, refetch } = useCurrentMember()

  if (isLoading) return <LoadingState label="Chargement de ton profil…" />
  if (isError) {
    return (
      <main className={styles.screen}>
        <ErrorState message="Impossible de charger ton profil." onRetry={refetch} />
      </main>
    )
  }
  if (!member) {
    return (
      <main className={styles.screen}>
        <Card className={styles.card} role="alert">
          <h1 className={styles.title}>Accès non autorisé</h1>
          <p className={styles.text}>Accès non autorisé : ton email n'est rattaché à aucune organisation.</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => void signOut()}>
              Déconnexion
            </Button>
          </div>
        </Card>
      </main>
    )
  }
  return children
}
