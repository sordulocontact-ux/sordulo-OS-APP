import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { duplicateQuote, invoiceFromQuote } from '../../shared/billing'
import type { Client, ClientContact, DocumentLine, Invoice, Project, Quote } from '../../shared/types'
import type { QuoteWithLinks } from './quoteLogic'

const WITH_LINKS = '*, client:clients(id, name), project:projects(id, name)'

/** Tous les devis de l'organisation (le tri et les filtres se font à l'affichage). */
export function useQuotes() {
  return useQuery({
    queryKey: queryKeys.quotes(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select(WITH_LINKS)
        .overrideTypes<QuoteWithLinks[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Un devis ; `data` vaut null s'il n'existe pas ou n'est pas visible. */
export function useQuote(quoteId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.quote(quoteId ?? ''),
    enabled: Boolean(quoteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quotes')
        .select(WITH_LINKS)
        .eq('id', quoteId ?? '')
        .limit(1)
        .overrideTypes<QuoteWithLinks[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** Clients non archivés (modale de création, filtre de la liste). */
export function useQuoteClients() {
  return useQuery({
    queryKey: [...queryKeys.clients(), 'quote-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .order('name')
        .overrideTypes<Pick<Client, 'id' | 'name'>[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Projets d'un client, pour la modale de création. */
export function useClientProjectOptions(clientId: string) {
  return useQuery({
    queryKey: [...queryKeys.projects(), 'of-client', clientId],
    enabled: clientId !== '',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('client_id', clientId)
        .order('name')
        .overrideTypes<Pick<Project, 'id' | 'name'>[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Client et contact principal, pour l'aperçu imprimable. */
export function useClientWithContacts(clientId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.client(clientId ?? ''), 'with-contacts'],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*, client_contacts(*)')
        .eq('id', clientId ?? '')
        .limit(1)
        .overrideTypes<(Client & { client_contacts: ClientContact[] })[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

function useInvalidateQuotes() {
  const queryClient = useQueryClient()
  return (quoteId?: string, projectId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.quotes() })
    if (quoteId) void queryClient.invalidateQueries({ queryKey: queryKeys.quote(quoteId) })
    // Envoyer ou accepter un devis change le statut du projet (trigger).
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    if (projectId) void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
  }
}

export interface NewQuoteInput {
  organizationId: string
  memberId: string | null
  clientId: string
  projectId: string | null
  title: string
  firstLine: DocumentLine
}

export function useCreateQuote() {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: async (input: NewQuoteInput) => {
      const { data, error } = await supabase
        .from('quotes')
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          project_id: input.projectId,
          title: input.title,
          status: 'draft',
          lines: [input.firstLine],
          created_by: input.memberId,
        })
        .select()
        .overrideTypes<Quote[], { merge: false }>()
      if (error) throw error
      const quote = data[0]
      if (!quote) throw new Error('Le devis créé est introuvable.')
      return quote
    },
    onSettled: (quote) => invalidate(quote?.id),
  })
}

/** Colonnes modifiables ; les totaux sont recalculés par la base. */
export type QuotePatch = Record<string, string | number | null | DocumentLine[]>

export function useUpdateQuote(quote: Pick<Quote, 'id' | 'project_id'> | null) {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: async (patch: QuotePatch) => {
      if (!quote) throw new Error('Devis introuvable.')
      const { data, error } = await supabase
        .from('quotes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', quote.id)
        .select('id')
      if (error) throw error
      // Aucune ligne touchée : la RLS a filtré l'écriture.
      if (data.length === 0) throw Object.assign(new Error('row-level security'), { code: '42501' })
    },
    onSettled: () => invalidate(quote?.id, quote?.project_id),
  })
}

export function useDeleteQuote() {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: async (quoteId: string) => {
      const { data, error } = await supabase.from('quotes').delete().eq('id', quoteId).select('id')
      if (error) throw error
      if (data.length === 0) throw Object.assign(new Error('row-level security'), { code: '42501' })
    },
    onSettled: () => invalidate(),
  })
}

export function useDuplicateQuote() {
  const invalidate = useInvalidateQuotes()
  return useMutation({
    mutationFn: async ({ quote, organizationId, memberId }: { quote: Quote; organizationId: string; memberId: string | null }) => {
      const { data, error } = await supabase
        .from('quotes')
        .insert({ ...duplicateQuote(quote), organization_id: organizationId, created_by: memberId })
        .select()
        .overrideTypes<Quote[], { merge: false }>()
      if (error) throw error
      const copy = data[0]
      if (!copy) throw new Error('La copie du devis est introuvable.')
      return copy
    },
    onSettled: (copy) => invalidate(copy?.id),
  })
}

export function useCreateInvoiceFromQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      quote,
      organizationId,
      memberId,
      kind,
      percent,
    }: {
      quote: Quote
      organizationId: string
      memberId: string | null
      kind: 'invoice' | 'deposit'
      percent?: number
    }) => {
      const draft = invoiceFromQuote(quote, { kind, percent })
      const { data, error } = await supabase
        .from('invoices')
        .insert({ ...draft, organization_id: organizationId, status: 'draft', created_by: memberId })
        .select()
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      const invoice = data[0]
      if (!invoice) throw new Error('La facture créée est introuvable.')
      return invoice
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.invoices() }),
  })
}
