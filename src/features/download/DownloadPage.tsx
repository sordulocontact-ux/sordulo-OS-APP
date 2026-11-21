import { useMemo } from 'react'
import { Card } from '../../components/ui'
import { detectPlatform, DOWNLOAD_URLS, otherPlatform, PLATFORM_LABELS, type DesktopPlatform } from './downloadLogic'
import styles from './DownloadPage.module.css'

const INSTALL_STEPS: Record<DesktopPlatform, readonly string[]> = {
  mac: [
    'Ouvre le fichier .dmg téléchargé, puis glisse Sordulo OS dans le dossier Applications.',
    'Au premier lancement, macOS bloque l’app (elle n’est pas notarisée). Ouvre Réglages Système > Confidentialité et sécurité, puis clique sur « Ouvrir quand même ».',
  ],
  windows: [
    'Lance le fichier .exe téléchargé. Aucun droit administrateur n’est nécessaire.',
    'Si Windows SmartScreen affiche un avertissement, clique sur « Informations complémentaires », puis sur « Exécuter quand même ».',
  ],
}

function Steps({ platform }: { platform: DesktopPlatform }) {
  return (
    <ol className={styles.steps}>
      {INSTALL_STEPS[platform].map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  )
}

/** Installer l'app de bureau : bouton pour le système détecté, lien vers l'autre, consignes du premier lancement. */
export function DownloadPage() {
  const detected = useMemo(() => detectPlatform(typeof navigator === 'undefined' ? undefined : navigator), [])

  return (
    <section className={styles.page} aria-labelledby="download-title">
      <h1 id="download-title">Installer l’app de bureau</h1>
      <p className={styles.intro}>
        La même interface, avec l’icône dans la zone de notification et la transcription des appels.
      </p>

      {detected ? (
        <Card role="group" aria-labelledby="download-main" className={styles.section}>
          <h2 id="download-main">Pour {PLATFORM_LABELS[detected]}</h2>
          <div className={styles.actions}>
            <a className={styles.download} href={DOWNLOAD_URLS[detected]}>
              Télécharger pour {PLATFORM_LABELS[detected]}
            </a>
            <a className={styles.secondaryLink} href={DOWNLOAD_URLS[otherPlatform(detected)]}>
              Télécharger pour {PLATFORM_LABELS[otherPlatform(detected)]}
            </a>
          </div>
          <Steps platform={detected} />
        </Card>
      ) : (
        <Card role="group" aria-labelledby="download-both" className={styles.section}>
          <h2 id="download-both">Choisis ton système</h2>
          {(['mac', 'windows'] as const).map((platform) => (
            <div key={platform} className={styles.platformBlock}>
              <h3>{PLATFORM_LABELS[platform]}</h3>
              <div className={styles.actions}>
                <a className={styles.download} href={DOWNLOAD_URLS[platform]}>
                  Télécharger pour {PLATFORM_LABELS[platform]}
                </a>
              </div>
              <Steps platform={platform} />
            </div>
          ))}
        </Card>
      )}

      <p className={styles.note}>Ensuite, l’app se lance à l’ouverture de session et se met à jour toute seule.</p>
    </section>
  )
}
