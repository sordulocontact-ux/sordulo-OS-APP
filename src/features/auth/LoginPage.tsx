import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Card, Field, TextInput } from '../../components/ui'
import { isDesktop } from '../../lib/desktop'
import { supabase } from '../../lib/supabase'
import { DESKTOP_AUTH_REDIRECT } from '../../shared/desktop-contract'
import { useAuth } from './useAuth'
import { parseLoginCode } from './parseLoginCode'
import styles from './AuthScreen.module.css'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string }
type CodeStatus = 'idle' | 'verifying' | 'invalid'

const CODE_HINT = 'Si le lien ne rouvre pas l’app : clic droit sur "Sign in" dans l’email > Copier l’adresse du lien, puis colle-le ici.'

export function LoginPage() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle')
  const [resent, setResent] = useState(false)
  const [mode, setMode] = useState<'password' | 'link'>('password')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Une session valide (lien magique, code ou lien collé) ramène à l'accueil.
  if (!loading && session) return <Navigate to="/" replace />

  async function sendLink(target: string) {
    setStatus({ kind: 'sending' })
    setCode('')
    setCodeStatus('idle')
    const { error } = await supabase.auth.signInWithOtp({
      email: target,
      // App bureau : le lien rouvre l'app (sordulo://auth) au lieu d'une page du navigateur.
      options: { emailRedirectTo: isDesktop() ? DESKTOP_AUTH_REDIRECT : window.location.origin },
    })
    const message =
      error && (error.status === 429 || /rate limit/i.test(error.message))
        ? 'Trop d’emails envoyés : Supabase en limite le nombre par heure. Réessaie un peu plus tard.'
        : error?.message
    setStatus(message ? { kind: 'error', message } : { kind: 'sent', email: target })
    return !error
  }

  async function onPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !password) return
    setSigningIn(true)
    setPasswordError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password })
    setSigningIn(false)
    // En cas de succès, onAuthStateChange met la session à jour et le rendu redirige vers « / ».
    if (error) {
      setPasswordError(
        /invalid login credentials/i.test(error.message)
          ? 'Email ou mot de passe incorrect. Pas encore de mot de passe ? Connecte-toi une fois par lien email, puis définis-le dans le menu de ton compte.'
          : error.status === 429
            ? 'Trop de tentatives : réessaie dans quelques minutes.'
            : error.message,
      )
    }
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
  const desktop = isDesktop()

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
              {desktop ? (
                <p className={styles.text}>
                  Ton navigateur te demande alors d'ouvrir Sordulo OS : accepte, l'app se connecte toute seule.
                </p>
              ) : null}
              {resent ? <p className={styles.text}>Un nouvel email vient d'être envoyé.</p> : null}
            </div>
            {desktop ? (
              <p className={styles.text}>Sinon, colle le lien ici.</p>
            ) : (
              <p className={styles.text}>Ou saisis le code reçu par email, ou colle le lien.</p>
            )}
            <form className={styles.form} onSubmit={(e) => void onVerify(e, sent.email)}>
              <Field
                label="Code ou lien reçu par email"
                hint={desktop ? CODE_HINT : undefined}
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
        ) : mode === 'password' ? (
          <>
            <form className={styles.form} onSubmit={(e) => void onPasswordSubmit(e)}>
              <Field label="Email">
                <TextInput
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={signingIn}
                />
              </Field>
              <Field label="Mot de passe" error={passwordError}>
                <TextInput
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (passwordError) setPasswordError(null)
                  }}
                  disabled={signingIn}
                />
              </Field>
              <div className={styles.actions}>
                <Button type="submit" variant="primary" loading={signingIn}>
                  {signingIn ? 'Connexion…' : 'Se connecter'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode('link')
                    setPasswordError(null)
                  }}
                  disabled={signingIn}
                >
                  Recevoir un lien par email
                </Button>
              </div>
            </form>
            <p className={styles.text}>Première connexion ou mot de passe oublié : reçois un lien par email, puis définis ton mot de passe dans le menu de ton compte.</p>
          </>
        ) : (
          <>
            <p className={styles.text}>Connexion par lien : saisis ton email, tu recevras un lien de connexion.</p>
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
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode('password')
                    setStatus({ kind: 'idle' })
                  }}
                  disabled={status.kind === 'sending'}
                >
                  Utiliser mon mot de passe
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </main>
  )
}
