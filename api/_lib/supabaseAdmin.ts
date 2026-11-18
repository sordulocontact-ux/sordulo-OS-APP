/**
 * Supabase client with the service_role key. SERVER ONLY: it bypasses RLS,
 * so every route must check the user's membership itself (see auth.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from './env.js'

let client: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(getEnv('VITE_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }
  return client
}
