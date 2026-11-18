import { Card } from '../../components/ui'
import styles from './AuthScreen.module.css'

export function ConfigMissing() {
  return (
    <main className={styles.screen}>
      <Card className={styles.card} role="alert">
        <h1 className={styles.title}>Configuration manquante</h1>
        <p className={styles.text}>
          Configuration manquante : <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>
        </p>
        <p className={styles.text}>Renseigne ces variables dans le fichier .env puis relance l'application.</p>
      </Card>
    </main>
  )
}
