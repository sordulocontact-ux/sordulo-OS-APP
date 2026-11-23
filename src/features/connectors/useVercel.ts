import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  VercelApiError,
  deleteVercelConnection,
  fetchVercelAccount,
  readVercelConnection,
  saveVercelConnection,
} from '../../lib/vercel'
import { VERCEL_TOKEN_EMPTY, VERCEL_TOKEN_REFUSED, describeVercel, type VercelView } from './vercelView'

// Clé locale : src/lib/queryKeys.ts n'est pas de ce lot.
const VERCEL_CONNECTION_KEY = ['vercel-connection'] as const

export interface VercelConnector {
  view: VercelView
  /** Erreur de la déconnexion (la lecture a sa propre vue « Erreur »). */
  error: string | null
  /** Erreur de la fenêtre de connexion : `field` sous le champ du jeton, `form` dans la fenêtre. */
  connectError: { field: string | null; form: string | null }
  connecting: boolean
  /** Vérifie le jeton auprès de Vercel puis l'enregistre ; true si la connexion est faite. */
  connect: (token: string) => Promise<boolean>
  disconnect: () => void
  retry: () => void
  resetConnectError: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'L’opération a échoué. Réessayez.'
}

/** Connexion Vercel du compte Sordulo OS (web et app de bureau). Le jeton ne sort jamais de ce hook. */
export function useVercel(): VercelConnector {
  const client = useQueryClient()
  const query = useQuery({ queryKey: VERCEL_CONNECTION_KEY, queryFn: readVercelConnection })
  const [connectError, setConnectError] = useState<{ field: string | null; form: string | null }>({ field: null, form: null })

  const save = useMutation({
    mutationFn: async (token: string) => {
      const account = await fetchVercelAccount(token)
      await saveVercelConnection(token, account.username)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: VERCEL_CONNECTION_KEY }),
  })
  const remove = useMutation({
    mutationFn: deleteVercelConnection,
    onSuccess: () => client.invalidateQueries({ queryKey: VERCEL_CONNECTION_KEY }),
  })

  const connect = useCallback(
    async (raw: string) => {
      const token = raw.trim()
      setConnectError({ field: null, form: null })
      if (!token) {
        setConnectError({ field: VERCEL_TOKEN_EMPTY, form: null })
        return false
      }
      try {
        await save.mutateAsync(token)
        return true
      } catch (e) {
        if (e instanceof VercelApiError && e.unauthorized) setConnectError({ field: VERCEL_TOKEN_REFUSED, form: null })
        else setConnectError({ field: null, form: messageOf(e) })
        return false
      }
    },
    [save],
  )

  const disconnect = useCallback(() => {
    remove.reset()
    remove.mutate()
  }, [remove])

  const data = query.data
  const view = describeVercel({
    loading: query.isPending,
    loadFailed: query.isError,
    connected: Boolean(data),
    account: data?.account ?? null,
    disconnecting: remove.isPending,
  })

  return {
    view,
    error: remove.isError ? `Vercel : ${messageOf(remove.error)}` : null,
    connectError,
    connecting: save.isPending,
    connect,
    disconnect,
    retry: () => void query.refetch(),
    resetConnectError: () => {
      setConnectError({ field: null, form: null })
      save.reset()
    },
  }
}
