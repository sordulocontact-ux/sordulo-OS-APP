import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/** Clé de session de supabase-js dans le stockage local (sb-<projet>-auth-token) ; null : stockage vidé. */
function isAuthStorageKey(key: string | null): boolean {
  return key === null || (key.startsWith('sb-') && key.endsWith('-auth-token'))
}

let lastToken: string | null = null

/**
 * Relit la session partagée (stockage local commun aux fenêtres de l'app de bureau) et prévient
 * l'AuthProvider de cette fenêtre quand elle a été créée ou renouvelée ailleurs (fenêtre principale).
 * `followSignOut` : la session a disparu du stockage (déconnexion ailleurs) → on l'oublie ici aussi.
 */
export async function syncSession(options: { followSignOut?: boolean } = {}): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (session) {
    if (session.access_token === lastToken) return
    lastToken = session.access_token
    await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  } else if (options.followSignOut) {
    lastToken = null
    // Portée locale : seule cette fenêtre oublie la session (rien n'est révoqué côté serveur).
    await supabase.auth.signOut({ scope: 'local' })
  }
}

/**
 * Resynchronise la session quand la fenêtre redevient visible ou active, et quand une autre fenêtre change
 * la session dans le stockage local. L'île est toujours visible : l'événement `storage` est son signal principal.
 */
export function useSessionSync(): void {
  useEffect(() => {
    const run = (followSignOut: boolean) =>
      syncSession({ followSignOut }).catch((e: unknown) => console.warn('[île] session :', e))
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void run(false)
    }
    const onStorage = (event: StorageEvent) => {
      if (isAuthStorageKey(event.key)) void run(true)
    }
    window.addEventListener('focus', onVisible)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
