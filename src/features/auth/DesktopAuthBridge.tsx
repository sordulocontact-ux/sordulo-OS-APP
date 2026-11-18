import { useEffect } from 'react'
import { useToast } from '../../components/ui'
import { currentWindowLabel, isDesktop, onAuthCallback, takeAuthCallback } from '../../lib/desktop'
import { supabase } from '../../lib/supabase'
import { DESKTOP_WINDOWS } from '../../shared/desktop-contract'
import { parseAuthCallback } from './parseAuthCallback'

const EXPIRED = 'Lien de connexion expiré ou déjà utilisé : renvoie un nouveau lien.'

/**
 * App bureau, fenêtre principale : connecte la session quand le lien reçu par email rouvre l'app
 * (`sordulo://auth…`). Ne rend rien ; inactif sur le web.
 */
export function DesktopAuthBridge() {
  const toast = useToast()

  useEffect(() => {
    if (!isDesktop() || currentWindowLabel() !== DESKTOP_WINDOWS.main) return
    let active = true

    async function consume() {
      const url = await takeAuthCallback()
      if (!active || !url) return
      const callback = parseAuthCallback(url)
      if (!callback || callback.kind === 'error') {
        toast.error(EXPIRED)
        return
      }
      // En cas de succès, onAuthStateChange met la session à jour et l'écran de connexion redirige.
      const { error } =
        callback.kind === 'tokens'
          ? await supabase.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken })
          : await supabase.auth.exchangeCodeForSession(callback.code)
      if (error) toast.error(EXPIRED)
    }

    const unlisten = onAuthCallback(() => void consume())
    void consume() // App ouverte par le lien alors qu'elle était fermée.
    return () => {
      active = false
      void unlisten.then((stop) => stop())
    }
  }, [toast])

  return null
}
