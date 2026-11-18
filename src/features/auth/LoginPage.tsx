import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Card, Field, TextInput } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from './useAuth'
import { parseLoginCode } from './parseLoginCode'
import styles from './AuthScreen.module.css'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }
type CodeStatus = 'idle' | 'verifying' | 'invalid'

const CODE_HINT =
  'Dans l’app bureau : clic droit sur "Sign in" dans l’email > Copier l’adresse du lien, puis colle-le ici, sans ouvrir le lien.'

export function LoginPage() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle')
  const [resent, setResent] = useState(false)

  // Une session valide (lien magique, code ou lien collé) ramène à l'accueil.
  if (!loading && session) return <Navigate to="/" replace />

  async function sendLink(target: string) {
    setStatus({ kind: 'sending' })
    setCode('')
    setCodeStatus('idle')
    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      options: { emailRedirectTo: window.location.origin },
    })
    setStatus(error ? { kind: 'error', message: error.message } : { kind: 'sent', email: target })
    return !error
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setResent(false)
    await sendLink(trimmed)
  }

  async function onResend(target: string) {
    setResent(false)
    setResent(await sendLink(target))
  }

  async function onVerify(event: FormEvent<HTMLFormElement>, target: string) {
    event.preventDefault()
    const credential = parseLoginCode(code)
    if (!credential) return
    setCodeStatus('verifying')
    const { error } =
      credential.kind === 'code'
        ? await supabase.auth.verifyOtp({ email: target, token: credential.token, type: 'email' })
        : await supabase.auth.verifyOtp({ token_hash: credential.tokenHash, type: credential.type })
    // En cas de succès, onAuthStateChange met la session à jour et le rendu redirige vers « / ».
    setCodeStatus(error ? 'invalid' : 'idle')
  }

  function onChangeEmail() {
    setStatus({ kind: 'idle' })
    setCode('')
    setCodeStatus('idle')
    setResent(false)
  }

  const sent = status.kind === 'sent' ? status : null

  return (
    <main className={styles.screen}>
      <Card className={styles.card}>
        <h1 className={styles.title}>Sordulo OS</h1>
        {sent ? (
          <>
            <div aria-live="polite">
              <p className={styles.text}>
                Lien envoyé à <strong>{sent.email}</strong>. Ouvre l'email et clique sur le lien pour te connecter.
              </p>
              {resent ? <p className={styles.text}>Un nouvel email vient d'être envoyé.</p> : null}
            </div>
            <p className={styles.text}>Ou saisis le code reçu par email, ou colle le lien.</p>
            <form className={styles.form} onSubmit={(e) => void onVerify(e, sent.email)}>
              <Field
                label="Code ou lien reçu par email"
                hint={CODE_HINT}
                error={codeStatus === 'invalid' ? 'Lien ou code invalide, ou déjà utilisé : renvoie un nouveau lien.' : null}
              >
                <TextInput
                  type="text"
                  name="code"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    if (codeStatus === 'invalid') setCodeStatus('idle')
                  }}
                  disabled={codeStatus === 'verifying'}
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  variant="primary"
                  loading={codeStatus === 'verifying'}
                  disabled={!parseLoginCode(code)}
                >
                  {codeStatus === 'verifying' ? 'Vérification…' : 'Se connecter'}
                </Button>
                <Button variant="ghost" onClick={() => void onResend(sent.email)}>
                  Renvoyer le lien
                </Button>
                <Button variant="ghost" onClick={onChangeEmail}>
                  Changer d'email
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
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
          </>
        )}
      </Card>
    </main>
  )
}
