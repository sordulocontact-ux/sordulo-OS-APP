import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../../lib/api'
import { currentWindowLabel, getAppVersion, isDesktop } from '../../lib/desktop'
import { DESKTOP_WINDOWS } from '../../shared/desktop-contract'
import { CHECK_INTERVAL_MS, isTooOld } from './updateLogic'
import { UpdateRequiredScreen } from './UpdateRequiredScreen'

function isMainDesktopWindow(): boolean {
  try {
    return isDesktop() && currentWindowLabel() === DESKTOP_WINDOWS.main
  } catch {
    return false
  }
}

interface Outdated {
  current: string
  minVersion: string
}

function Gate({ children }: { children: ReactNode }) {
  const [outdated, setOutdated] = useState<Outdated | null>(null)

  useEffect(() => {
    if (outdated) return
    let active = true
    async function check() {
      try {
        const [current, { minVersion }] = await Promise.all([getAppVersion(), api.desktopMinVersion()])
        if (active && isTooOld(current, minVersion)) setOutdated({ current, minVersion })
      } catch {
        // Réseau ou serveur indisponible : on ne bloque jamais l'app sur un échec de vérification.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [outdated])

  if (outdated) return <UpdateRequiredScreen current={outdated.current} minVersion={outdated.minVersion} />
  return <>{children}</>
}

/**
 * App de bureau, fenêtre principale seulement (jamais l'île, jamais le web) : au démarrage puis toutes les heures,
 * compare la version de l'app au minimum exigé par l'API. Trop vieille : un écran plein remplace tout le contenu,
 * même hors connexion à un compte.
 */
export function DesktopUpdateGate({ children }: { children: ReactNode }) {
  const [enabled] = useState(isMainDesktopWindow)
  return enabled ? <Gate>{children}</Gate> : <>{children}</>
}
