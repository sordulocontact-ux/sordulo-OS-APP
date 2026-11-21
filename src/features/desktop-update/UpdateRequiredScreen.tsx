import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorState, LoadingState } from '../../components/ui'
import { getUpdateStatus, installUpdateNow, onUpdateStatus } from '../../lib/desktop'
import type { UpdateStatus } from '../../shared/desktop-contract'
import { errorMessage, viewForStatus } from './updateLogic'
import styles from './UpdateRequiredScreen.module.css'

interface Props {
  current: string
  minVersion: string
}

/** Plein écran : l'app est trop vieille pour l'API. Lance l'installation tout de suite, l'app redémarre seule. */
export function UpdateRequiredScreen({ current, minVersion }: Props) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const running = useRef(false)

  const install = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      setStatus(await installUpdateNow())
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      running.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    let off: (() => void) | null = null
    onUpdateStatus((next) => {
      if (active) setStatus(next)
    })
      .then((unlisten) => {
        if (active) off = unlisten
        else unlisten()
      })
      .catch(() => undefined)
    getUpdateStatus()
      .then((initial) => {
        if (active) setStatus((known) => known ?? initial)
      })
      .catch(() => undefined)
    if (!running.current) {
      running.current = true
      installUpdateNow()
        .then((next) => {
          if (active) setStatus(next)
        })
        .catch((error: unknown) => {
          if (active) setCommandError(errorMessage(error))
        })
        .finally(() => {
          running.current = false
        })
    }
    return () => {
      active = false
      off?.()
    }
  }, [])

  function retry() {
    setCommandError(null)
    setStatus(null)
    void install()
  }

  const view = viewForStatus(status, commandError)

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="update-required-title">
        <h1 id="update-required-title">Mise à jour nécessaire</h1>
        <p className={styles.text}>
          Cette version de Sordulo OS n’est plus compatible avec le serveur. Elle se met à jour et redémarre toute
          seule.
        </p>
        <div className={styles.status} aria-live="polite">
          {view.kind === 'working' ? (
            <LoadingState label={view.label} />
          ) : (
            <ErrorState message={view.message} onRetry={retry} />
          )}
        </div>
        <p className={styles.versions}>
          Version installée {current}, version minimale {minVersion}
        </p>
      </section>
    </main>
  )
}
