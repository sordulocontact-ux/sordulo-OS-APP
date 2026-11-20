import { useLayoutEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { isDesktop } from '../../lib/desktop'
import { IslandController } from '../island/controller'
import { useSessionSync } from './useSessionSync'
import './IslandWindow.module.css'

const WINDOW_CLASS = 'islandWindow'

/** Rend le document transparent tant que la route est affichée (la fenêtre est une île sans fond). */
function useTransparentWindow(): void {
  useLayoutEffect(() => {
    const html = document.documentElement
    html.classList.add(WINDOW_CLASS)
    return () => html.classList.remove(WINDOW_CLASS)
  }, [])
}

function IslandWindow() {
  useTransparentWindow()
  useSessionSync()
  return <IslandController />
}

/**
 * /desktop/prompt : l'île de l'app de bureau, seulement dans Tauri. Pas d'écran de connexion ici : sans
 * session (ou sans membre), l'île reste au repos et un appel détecté propose d'ouvrir Sordulo OS.
 */
export function DesktopPromptRoute() {
  if (!isDesktop()) return <Navigate to="/" replace />
  return <IslandWindow />
}
