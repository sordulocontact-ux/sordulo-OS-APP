import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Card, Field, TextInput } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from './useAuth'
import styles from './AuthScreen.module.css'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }

export function LoginPage() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (!loading && session) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setStatus({ kind: 'sending' })
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    })
    setStatus(error ? { kind: 'error', message: error.message } : { kind: 'sent', email: trimmed })
  }

  return (
    <main className={styles.screen}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Sordulo OS</h1>
        <p className={styles.text}>Connexion par lien magique : saisis ton email, tu recevras un lien de connexion.</p>
        <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
          <Field label="Email" error={status.kind === 'error' ? status.message : null}>
            <TextInput
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status.kind === 'sending'}
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={status.kind === 'sending'}>
              {status.kind === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
            </Button>
          </div>
        </form>
        <div aria-live="polite">
          {status.kind === 'sent' ? (
            <p className={styles.text}>
              Lien envoyé à <strong>{status.email}</strong>. Ouvre l'email et clique sur le lien pour te connecter.
            </p>
          ) : null}
        </div>
      </Card>
    </main>
  )
}
