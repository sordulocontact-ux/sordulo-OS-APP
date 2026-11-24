import { useRef, useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput } from '../../components/ui'
import { SPOTIFY_DASHBOARD_URL, SPOTIFY_REDIRECT_URI } from '../../lib/spotify'
import type { SpotifyConnector } from './useSpotify'
import styles from './connectors.module.css'

const FORM_ID = 'spotify-connect-form'

/**
 * Fenêtre du connecteur Spotify : chacun crée son app sur developer.spotify.com et colle son Client ID, qui
 * est enregistré sur son compte Sordulo OS. Dans l'app de bureau, le bouton lance ensuite l'autorisation dans
 * le navigateur ; sur le web, il enregistre seulement le Client ID.
 */
export function SpotifyConnectModal({ spotify }: { spotify: SpotifyConnector }) {
  if (!spotify.connectOpen) return null
  return <SpotifyConnectDialog spotify={spotify} />
}

function SpotifyConnectDialog({ spotify }: { spotify: SpotifyConnector }) {
  const { desktop, connect, connecting, waitingForBrowser, connectError, resetConnectError, cancelConnect, closeConnect } =
    spotify
  // Pré-rempli à l'ouverture (la fenêtre est montée à chaque ouverture).
  const [clientId, setClientId] = useState(spotify.savedClientId)
  const [copied, setCopied] = useState<string | null>(null)
  const redirectRef = useRef<HTMLDivElement>(null)

  function close() {
    // Fermer pendant l'attente du navigateur arrête l'autorisation.
    if (waitingForBrowser) cancelConnect()
    resetConnectError()
    closeConnect()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await connect(clientId)) {
      resetConnectError()
      closeConnect()
    }
  }

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI)
      setCopied('Adresse copiée.')
    } catch {
      // Presse-papiers indisponible : l'adresse est sélectionnée pour être copiée au clavier.
      const input = redirectRef.current?.querySelector('input')
      input?.focus()
      input?.select()
      setCopied('Copie impossible ici : l’adresse est sélectionnée, copiez-la avec Ctrl+C (ou Cmd+C).')
    }
  }

  const submitLabel = desktop ? 'Enregistrer et connecter' : 'Enregistrer le Client ID'

  return (
    <Modal
      open
      onClose={close}
      title="Connecter Spotify"
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={connecting}>
            {waitingForBrowser ? 'Connexion dans le navigateur…' : submitLabel}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.intro}>
          Chaque compte utilise sa propre app Spotify. Créez-la une fois, puis collez son Client ID ici : il est gardé sur
          votre compte Sordulo OS.
        </p>
        <a className={styles.link} href={SPOTIFY_DASHBOARD_URL} target="_blank" rel="noreferrer noopener">
          Ouvrir le tableau de bord Spotify
          <span className="visually-hidden"> (s’ouvre dans un nouvel onglet)</span>
        </a>
        <ol className={styles.intro}>
          <li>Créez une app (« Create app »), avec le nom de votre choix.</li>
          <li>Cochez « Web API » parmi les API utilisées.</li>
          <li>Ajoutez l’adresse de redirection ci-dessous dans « Redirect URIs », puis enregistrez.</li>
          <li>Copiez le Client ID de l’app (page « Settings ») et collez-le ci-dessous.</li>
        </ol>
        <div ref={redirectRef}>
          <Field label="Adresse de redirection" hint={copied ?? undefined}>
            <TextInput readOnly value={SPOTIFY_REDIRECT_URI} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </div>
        <div>
          <Button variant="secondary" size="sm" onClick={() => void copyRedirect()}>
            Copier l’adresse
          </Button>
        </div>
        <Field label="Client ID" error={connectError.field}>
          <TextInput
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={connecting}
          />
        </Field>
        <p className={styles.muted}>
          {desktop
            ? waitingForBrowser
              ? 'Autorisez l’accès dans la page Spotify ouverte dans votre navigateur. Si Spotify affiche « Invalid redirect URI », vérifiez l’adresse de redirection de l’app.'
              : 'Le navigateur s’ouvre pour autoriser l’accès. La connexion suit ensuite votre compte Sordulo OS sur tous vos ordinateurs.'
            : 'Sur le web, le Client ID est enregistré sur votre compte. L’autorisation du compte Spotify se fait depuis l’app de bureau.'}
        </p>
        {connectError.form ? (
          <p className={styles.error} role="alert">
            {connectError.form}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
