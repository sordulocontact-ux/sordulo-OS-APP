import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { LoadingState } from '../../components/ui'
import { useAuth } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <LoadingState label="Connexion en cours…" />
  if (!session) return <Navigate to="/login" replace />
  return children
}
