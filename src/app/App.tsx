import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../components/ui'
import { AuthProvider } from '../features/auth/AuthProvider'
import { ConfigMissing } from '../features/auth/ConfigMissing'
import { isSupabaseConfigured } from '../lib/supabase'
import { AppRoutes } from './routes'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
