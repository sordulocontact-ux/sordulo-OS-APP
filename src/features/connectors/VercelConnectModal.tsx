import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput } from '../../components/ui'
import { VERCEL_TOKENS_URL } from '../../lib/vercel'
import type { VercelConnector } from './useVercel'
import styles from './connectors.module.css'

const FORM_ID = 'vercel-connect-form'

export function VercelConnectModal({ open, onClose, vercel }: { open: boolean; onClose: () => void; vercel: VercelConnector }) {
  const [token, setToken] = useState('')
  const { connect, connecting, connectError, resetConnectError } = vercel

  // Le jeton ne reste pas en mémoire dans le champ une fois la fenêtre fermée.
  function close() {
    setToken('')
    resetConnectError()
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await connect(token)) close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connecter Vercel"
      dismissible={!connecting}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={connecting}>
            Annuler
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={connecting}>
            Connecter
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.intro}>
          Créez un jeton d’accès sur Vercel puis collez-le ici. Il est vérifié auprès de Vercel, puis gardé sur votre compte Sordulo
          OS.
        </p>
        <a className={styles.link} href={VERCEL_TOKENS_URL} target="_blank" rel="noreferrer noopener">
          Créer un jeton sur Vercel
          <span className="visually-hidden"> (s’ouvre dans un nouvel onglet)</span>
        </a>
        <Field label="Jeton d’accès Vercel" error={connectError.field}>
          <TextInput
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={connecting}
          />
        </Field>
        {connectError.form ? (
          <p className={styles.error} role="alert">
            {connectError.form}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
