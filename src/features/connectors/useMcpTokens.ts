import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useCurrentMember } from '../auth/useCurrentMember'
import { activeTokens, generateMcpToken, type McpTokenRow } from './mcpTokens'

// Clé locale : src/lib/queryKeys.ts n'est pas de ce lot.
const mcpTokensKey = (memberId: string) => ['mcp-tokens', memberId] as const

export interface CreatedMcpToken {
  /** Montré une seule fois, jamais enregistré. */
  token: string
  name: string
}

/** Jetons MCP du membre connecté (un admin lit aussi ceux de l'organisation : on ne garde que les siens). */
export function useMcpTokens() {
  const client = useQueryClient()
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''

  const query = useQuery({
    queryKey: mcpTokensKey(memberId),
    enabled: memberId !== '',
    queryFn: async (): Promise<McpTokenRow[]> => {
      const { data, error } = await supabase
        .from('api_tokens')
        .select('id, name, prefix, last_used_at, created_at, revoked_at')
        .eq('member_id', memberId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return activeTokens(data as McpTokenRow[])
    },
  })

  const invalidate = () => client.invalidateQueries({ queryKey: mcpTokensKey(memberId) })

  const create = useMutation({
    mutationFn: async (name: string): Promise<CreatedMcpToken> => {
      if (!member) throw new Error('Profil introuvable : recharge la page.')
      const generated = await generateMcpToken()
      // Seuls l'empreinte et le préfixe partent en base ; member_id est posé par la base.
      const { error } = await supabase
        .from('api_tokens')
        .insert({ organization_id: member.organization_id, name: name.trim(), token_hash: generated.hash, prefix: generated.prefix })
      if (error) throw new Error(`Jeton non créé : ${error.message}`)
      return { token: generated.token, name: name.trim() }
    },
    onSuccess: invalidate,
  })

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(`Jeton non révoqué : ${error.message}`)
    },
    onSuccess: invalidate,
  })

  return {
    tokens: query.data ?? [],
    loading: query.isPending,
    loadFailed: query.isError,
    retry: () => void query.refetch(),
    create,
    revoke,
  }
}

export type McpTokensApi = ReturnType<typeof useMcpTokens>
