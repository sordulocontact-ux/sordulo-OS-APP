import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Client, ClientContact, Project } from '../../shared/types'

/** Client de la liste, avec ses contacts et le nombre de ses projets. */
export type ClientListItem = Client & {
  contacts: ClientContact[]
  projects: { count: number }[]
  /** Statut de chaque projet du client (pour « avec un projet en cours »). */
  project_statuses: { status: string }[]
}

/** Message d'erreur affichable pour une erreur Supabase ou autre. */
export function errorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '23505') return 'Cet enregistrement existe déjà (un seul contact principal par client).'
  if (code === '42501') return 'Tu n’as pas le droit de faire cette action.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Tous les clients de l'organisation, archivés compris (le filtre se fait à l'affichage). */
export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*, contacts:client_contacts(*), projects(count), project_statuses:projects(status)')
        .order('name')
        .overrideTypes<ClientListItem[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Un client ; `data` vaut null s'il n'existe pas ou n'est pas visible. */
export function useClient(clientId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.client(clientId ?? ''),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId ?? '')
        .limit(1)
        .overrideTypes<Client[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** Contacts d'un client, le principal en premier. */
export function useClientContacts(clientId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.clientContacts(clientId ?? ''),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_contacts')
        .select('*')
        .eq('client_id', clientId ?? '')
        .order('is_primary', { ascending: false })
        .order('name')
        .overrideTypes<ClientContact[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Projets d'un client. Clé sous `projects()` : toute invalidation des projets les recharge. */
export function useClientProjects(clientId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.projects(), 'client', clientId ?? ''] as const,
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('client_id', clientId ?? '')
        .order('name')
        .overrideTypes<Project[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Champs modifiables d'un client (valeurs déjà trimées, vide = null). */
export interface ClientFields {
  name: string
  siret: string | null
  billing_street: string | null
  billing_postal_code: string | null
  billing_city: string | null
  billing_country: string | null
  website: string | null
  notes: string | null
}

export interface ContactFields {
  name: string
  email: string | null
  phone: string | null
  role: string | null
  is_primary: boolean
}

function useInvalidateClients() {
  const queryClient = useQueryClient()
  return (clientId?: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
    if (clientId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.client(clientId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientContacts(clientId) })
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
  }
}

export function useCreateClient() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async ({ organizationId, fields }: { organizationId: string; fields: ClientFields }) => {
      const { data, error } = await supabase
        .from('clients')
        .insert({ ...fields, organization_id: organizationId })
        .select()
        .overrideTypes<Client[], { merge: false }>()
      if (error) throw error
      const client = data[0]
      if (!client) throw new Error('Le client créé est introuvable.')
      return client
    },
    onSettled: () => invalidate(),
  })
}

export function useUpdateClient(clientId: string) {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (fields: ClientFields) => {
      const { error } = await supabase
        .from('clients')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', clientId)
      if (error) throw error
    },
    onSettled: () => invalidate(clientId),
  })
}

/** Archive ou désarchive un client choisi au moment de l'appel (listes : un seul hook pour toutes les lignes). */
export function useToggleClientArchived() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async ({ clientId, archived }: { clientId: string; archived: boolean }) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('clients')
        .update({ archived_at: archived ? now : null, updated_at: now })
        .eq('id', clientId)
      if (error) throw error
    },
    onSettled: (_data, _error, variables) => invalidate(variables.clientId),
  })
}

/** Archive (archived_at = maintenant) ou désarchive. Jamais de suppression. */
export function useSetClientArchived(clientId: string) {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (archived: boolean) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('clients')
        .update({ archived_at: archived ? now : null, updated_at: now })
        .eq('id', clientId)
      if (error) throw error
    },
    onSettled: () => invalidate(clientId),
  })
}

/**
 * Un seul principal par client (index unique partiel) : l'ancien perd le statut avant que le nouveau le prenne.
 * Si la seconde requête échoue, l'ancien principal est rétabli (au mieux) puis l'erreur est relancée.
 */
async function writeWithPrimary(clientId: string, keepId: string | null, write: () => Promise<void>) {
  let demote = supabase
    .from('client_contacts')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('is_primary', true)
  if (keepId) demote = demote.neq('id', keepId)
  const { data, error } = await demote.select('id')
  if (error) throw error
  const demoted = (data ?? []).map((row: { id: string }) => row.id)
  try {
    await write()
  } catch (error) {
    if (demoted.length > 0) {
      await supabase.from('client_contacts').update({ is_primary: true }).in('id', demoted)
    }
    throw error
  }
}

/** Crée (contactId absent) ou modifie un contact ; is_primary à true retire le statut à l'ancien principal. */
export function useSaveContact(clientId: string) {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async ({ contactId, fields }: { contactId?: string; fields: ContactFields }) => {
      const write = async () => {
        const query = contactId
          ? supabase
              .from('client_contacts')
              .update({ ...fields, updated_at: new Date().toISOString() })
              .eq('id', contactId)
          : supabase.from('client_contacts').insert({ ...fields, client_id: clientId })
        const { error } = await query
        if (error) throw error
      }
      if (fields.is_primary) await writeWithPrimary(clientId, contactId ?? null, write)
      else await write()
    },
    onSettled: () => invalidate(clientId),
  })
}

export function useSetPrimaryContact(clientId: string) {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (contactId: string) => {
      await writeWithPrimary(clientId, contactId, async () => {
        const { error } = await supabase
          .from('client_contacts')
          .update({ is_primary: true, updated_at: new Date().toISOString() })
          .eq('id', contactId)
        if (error) throw error
      })
    },
    onSettled: () => invalidate(clientId),
  })
}

export function useDeleteContact(clientId: string) {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase.from('client_contacts').delete().eq('id', contactId)
      if (error) throw error
    },
    onSettled: () => invalidate(clientId),
  })
}

/** Création d'un contact principal juste après la création du client (formulaire de création). */
export function useCreatePrimaryContact() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async ({ clientId, fields }: { clientId: string; fields: Omit<ContactFields, 'is_primary'> }) => {
      const { error } = await supabase.from('client_contacts').insert({ ...fields, client_id: clientId, is_primary: true })
      if (error) throw error
    },
    onSettled: (_data, _error, variables) => invalidate(variables.clientId),
  })
}
