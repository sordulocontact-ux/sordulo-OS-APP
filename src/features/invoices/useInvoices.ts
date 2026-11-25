import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { DocumentLine, Invoice, InvoiceKind, Project } from '../../shared/types'
import type { InvoiceRow } from './invoiceLogic'

/** Toutes les factures de l'organisation avec leur client (le filtre et le tri se font à l'affichage). */
export function useInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, client:clients(id, name, siret)')
        .overrideTypes<InvoiceRow[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Une facture ; `data` vaut null si elle n'existe pas ou n'est pas visible. */
export function useInvoice(invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.invoice(invoiceId ?? ''),
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId ?? '')
        .limit(1)
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** L'avoir qui annule cette facture, s'il existe. */
export function useCreditNoteOf(invoiceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.invoices(), 'credit-note-of', invoiceId ?? ''] as const,
    enabled: Boolean(invoiceId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('credited_invoice_id', invoiceId ?? '')
        .limit(1)
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

export type ProjectOption = Pick<Project, 'id' | 'name' | 'client_id'>

/** Projets (id, nom, client) pour les listes déroulantes. Sous `projects()` : rechargés à chaque invalidation. */
export function useProjectOptions() {
  return useQuery({
    queryKey: [...queryKeys.projects(), 'options'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, client_id')
        .order('name')
        .overrideTypes<ProjectOption[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Une fonction qui renvoie une ligne répond par un objet (ou, selon la version, par un tableau d'un élément). */
function invoiceFromRpc(data: unknown): Invoice {
  const row: unknown = Array.isArray(data) ? data[0] : data
  if (typeof row !== 'object' || row === null || !('id' in row)) throw new Error('La réponse de la base est vide.')
  return row as Invoice
}

function useInvalidateInvoices() {
  const queryClient = useQueryClient()
  return (invoice?: Pick<Invoice, 'id' | 'project_id'> | null) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices() })
    if (invoice) void queryClient.invalidateQueries({ queryKey: queryKeys.invoice(invoice.id) })
    // Le statut du projet peut changer (« payé » quand toutes ses factures le sont).
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    if (invoice?.project_id) void queryClient.invalidateQueries({ queryKey: queryKeys.project(invoice.project_id) })
  }
}

export interface NewInvoiceFields {
  organizationId: string
  clientId: string
  projectId: string | null
  kind: Extract<InvoiceKind, 'invoice' | 'deposit'>
  title: string
  lines: DocumentLine[]
  notes?: string | null
  /** null : la base met l'émetteur par défaut. */
  issuerId?: string | null
}

export function useCreateInvoiceDraft() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async (fields: NewInvoiceFields) => {
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          organization_id: fields.organizationId,
          client_id: fields.clientId,
          project_id: fields.projectId,
          kind: fields.kind,
          status: 'draft',
          title: fields.title,
          lines: fields.lines,
          notes: fields.notes ?? null,
          ...(fields.issuerId ? { issuer_id: fields.issuerId } : {}),
        })
        .select()
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      const invoice = data[0]
      if (!invoice) throw new Error('La facture créée est introuvable.')
      return invoice
    },
    onSettled: () => invalidate(),
  })
}

export interface DraftFields {
  title: string
  lines: DocumentLine[]
  notes: string | null
  /** Seulement quand l'émetteur change. */
  issuer_id?: string
}

export function useSaveInvoiceDraft(invoice: Pick<Invoice, 'id' | 'project_id'>) {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async (fields: DraftFields) => {
      const { data, error } = await supabase
        .from('invoices')
        .update(fields)
        .eq('id', invoice.id)
        .select()
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      const saved = data[0]
      if (!saved) throw new Error('Seuls les admins et la finance peuvent modifier les factures.')
      return saved
    },
    onSettled: () => invalidate(invoice),
  })
}

export function useDeleteInvoice() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async (invoice: Pick<Invoice, 'id' | 'project_id'>) => {
      const { error } = await supabase.from('invoices').delete().eq('id', invoice.id)
      if (error) throw error
      return invoice
    },
    onSettled: (_data, _error, invoice) => invalidate(invoice),
  })
}

/** Émet la facture : numéro définitif, vendeur et acheteur figés (RPC). */
export function useIssueInvoice() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async (invoice: Pick<Invoice, 'id' | 'project_id'>) => {
      const { data, error } = await supabase
        .rpc('issue_invoice', { p_invoice_id: invoice.id })
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      return invoiceFromRpc(data)
    },
    onSettled: (_data, _error, invoice) => invalidate(invoice),
  })
}

/** Crée l'avoir qui annule toute la facture (RPC) et renvoie l'avoir. */
export function useCreateCreditNote() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async (invoice: Pick<Invoice, 'id' | 'project_id'>) => {
      const { data, error } = await supabase
        .rpc('create_credit_note', { p_invoice_id: invoice.id })
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      return invoiceFromRpc(data)
    },
    onSettled: (_data, _error, invoice) => invalidate(invoice),
  })
}

/**
 * Marque payée ou non payée. `paidAt` : date d'encaissement choisie (au passage en payée, ou pour la corriger
 * ensuite) ; sans elle, la base pose maintenant (migration 0021, qui refuse le futur et l'avant-émission).
 */
export function useSetInvoicePaid() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async ({
      invoice,
      paid,
      paidAt,
    }: {
      invoice: Pick<Invoice, 'id' | 'project_id'>
      paid: boolean
      paidAt?: string
    }) => {
      const { data, error } = await supabase
        .from('invoices')
        .update(paid && paidAt ? { status: 'paid', paid_at: paidAt } : { status: paid ? 'paid' : 'issued' })
        .eq('id', invoice.id)
        .select()
        .overrideTypes<Invoice[], { merge: false }>()
      if (error) throw error
      if (!data[0]) throw new Error('Seuls les admins et la finance peuvent modifier les factures.')
      return data[0]
    },
    onSettled: (_data, _error, { invoice }) => invalidate(invoice),
  })
}
