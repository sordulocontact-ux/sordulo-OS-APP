import { useEffect, useRef, useState } from 'react'
import { Button, Card } from '../../components/ui'
import { checkUpdate, getUpdateStatus, installUpdateNow, onUpdateStatus } from '../../lib/desktop'
import type { UpdateStatus } from '../../shared/desktop-contract'
import { errorMessage } from '../desktop-update/updateLogic'
import { desktopAppView } from './desktopAppLogic'
import styles from './DesktopAppCard.module.css'

/**
 * Carte « Application de bureau » des paramètres (app de bureau seulement) : version installée, état de la
 * mise à jour en direct (desktop://update-status) et action : rechercher, puis installer et redémarrer.
 */
export function DesktopAppCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    let off: (() => void) | null = null
    onUpdateStatus((next) => {
      if (active.current) setStatus(next)
    })
      .then((unlisten) => {
        if (active.current) off = unlisten
        else unlisten()
      })
      .catch(() => undefined)
    getUpdateStatus()
      .then((initial) => {
        if (active.current) setStatus((known) => known ?? initial)
      })
      .catch(() => undefined)
    return () => {
      active.current = false
      off?.()
    }
  }, [])

  async function run(kind: 'check' | 'install') {
    if (running) return
    setRunning(true)
    setCommandError(null)
    try {
      const next = kind === 'install' ? await installUpdateNow() : await checkUpdate()
      if (active.current) setStatus(next)
    } catch (error) {
      if (active.current) setCommandError(errorMessage(error))
    } finally {
      if (active.current) setRunning(false)
    }
  }

  const view = desktopAppView(status, commandError)
  const action = view.action

  return (
    <Card role="group" aria-labelledby="desktop-app-title" className={styles.card}>
      <div>
        <h2 id="desktop-app-title">Application de bureau</h2>
        <p className={styles.help}>Sordulo OS se met à jour tout seul. Tu peux aussi vérifier maintenant.</p>
      </div>
      <div className={styles.row}>
        <div className={styles.info}>
          <span className={styles.version}>{view.version}</span>
          <span className={`${styles.status} ${styles[view.tone]}`} aria-live="polite">
            {view.status}
          </span>
        </div>
        {action && (
          <Button
            variant={action.kind === 'install' ? 'primary' : 'secondary'}
            loading={action.busy || running}
            onClick={() => void run(action.kind)}
          >
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  )
}
