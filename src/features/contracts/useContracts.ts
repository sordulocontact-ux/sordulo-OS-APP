import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runAi } from '../../lib/ai'
import { supabase } from '../../lib/supabase'
import type { ContractDraftRequest, ContractDraftResponse } from '../../shared/ai/contractDraft'
import {
  FILES_BUCKET,
  FOLDER_BY_KIND,
  type Client,
  type Contract,
  type ProjectFile,
  type Quote,
} from '../../shared/types'
import { contractStoragePath, type ContractWithLinks } from './contractLogic'

export const contractKeys = {
  all: () => ['contracts'] as const,
  list: (projectId: string | null) => ['contracts', 'list', projectId ?? 'all'] as const,
  one: (id: string) => ['contracts', 'one', id] as const,
  file: (fileId: string) => ['contracts', 'file', fileId] as const,
  acceptedQuotes: (projectId: string | null) => ['contracts', 'accepted-quotes', projectId ?? 'all'] as const,
}

const WITH_LINKS = '*, client:clients(id, name), project:projects(id, name)'

/** Contrats de l'organisation, ou d'un projet. */
export function useContracts(projectId: string | null = null) {
  return useQuery({
    queryKey: contractKeys.list(projectId),
    queryFn: async () => {
      let query = supabase.from('contracts').select(WITH_LINKS)
      if (projectId) query = query.eq('project_id', projectId)
      const { data, error } = await query.overrideTypes<ContractWithLinks[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Un contrat ; `data` vaut null s'il n'existe pas ou n'est pas visible. */
export function useContract(contractId: string | undefined) {
  return useQuery({
    queryKey: contractKeys.one(contractId ?? ''),
    enabled: Boolean(contractId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contracts')
        .select(WITH_LINKS)
        .eq('id', contractId ?? '')
        .limit(1)
        .overrideTypes<ContractWithLinks[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

export type AcceptedQuote = Pick<Quote, 'id' | 'number' | 'title' | 'client_id' | 'project_id'> & { client: { name: string } | null }

/** Devis acceptés (du projet si donné), à partir desquels on peut rédiger un contrat. */
export function useAcceptedQuotes(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: contractKeys.acceptedQuotes(projectId),
    enabled,
    queryFn: async () => {
      let query = supabase.from('quotes').select('id, number, title, client_id, project_id, client:clients(name)').eq('status', 'accepted')
      if (projectId) query = query.eq('project_id', projectId)
      const { data, error } = await query.order('number', { ascending: false }).overrideTypes<AcceptedQuote[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function useClientOptions(enabled: boolean) {
  return useQuery({
    queryKey: [...contractKeys.all(), 'clients'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .is('archived_at', null)
        .order('name')
        .overrideTypes<Pick<Client, 'id' | 'name'>[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: contractKeys.all() })
}

/** Rédaction par l'IA depuis un devis accepté : renvoie l'id du contrat brouillon créé. */
export function useDraftContract() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (quoteId: string) => (await runAi<ContractDraftRequest, ContractDraftResponse>('contractDraft', { quoteId })).contractId,
    onSettled: invalidate,
  })
}

export interface BlankContractInput {
  organizationId: string
  memberId: string | null
  clientId: string
  projectId: string | null
  title: string
}

export function useCreateBlankContract() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: BlankContractInput) => {
      const { data, error } = await supabase
        .from('contracts')
        .insert({
          organization_id: input.organizationId,
          client_id: input.clientId,
          project_id: input.projectId,
          title: input.title,
          body: '',
          status: 'draft',
          created_by: input.memberId,
        })
        .select()
        .overrideTypes<Contract[], { merge: false }>()
      if (error) throw error
      const created = data[0]
      if (!created) throw new Error('Le contrat créé est introuvable.')
      return created
    },
    onSettled: invalidate,
  })
}

export type ContractPatch = Partial<Pick<Contract, 'title' | 'body' | 'status' | 'signed_at' | 'signed_by_name' | 'signed_via' | 'file_id'>>

export function useUpdateContract(contractId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (patch: ContractPatch) => {
      const { data, error } = await supabase.from('contracts').update(patch).eq('id', contractId).select('id')
      if (error) throw error
      if (data.length === 0) throw Object.assign(new Error('row-level security'), { code: '42501' })
    },
    onSettled: invalidate,
  })
}

export function useDeleteContract() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (contractId: string) => {
      const { data, error } = await supabase.from('contracts').delete().eq('id', contractId).select('id')
      if (error) throw error
      if (data.length === 0) throw Object.assign(new Error('row-level security'), { code: '42501' })
    },
    onSettled: invalidate,
  })
}

/** PDF signé : envoi dans le bucket, ligne project_files (dossier Contrats), puis contracts.file_id. */
export function useAttachSignedPdf(contract: Pick<Contract, 'id' | 'organization_id' | 'project_id'>) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (file: File) => {
      if (!contract.project_id) throw new Error('Rattache le contrat à un projet pour y joindre le PDF signé.')
      const path = contractStoragePath(contract.organization_id, contract.project_id, crypto.randomUUID(), file.name)
      const upload = await supabase.storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || 'application/pdf', upsert: false })
      if (upload.error) throw upload.error
      const inserted = await supabase
        .from('project_files')
        .insert({
          project_id: contract.project_id,
          folder: FOLDER_BY_KIND.contract,
          name: file.name,
          storage_path: path,
          mime_type: file.type || 'application/pdf',
          size_bytes: file.size,
          kind: 'contract',
        })
        .select('id')
        .overrideTypes<Pick<ProjectFile, 'id'>[], { merge: false }>()
      if (inserted.error || !inserted.data[0]) {
        await supabase.storage.from(FILES_BUCKET).remove([path])
        throw inserted.error ?? new Error('Le fichier n’a pas pu être rangé.')
      }
      const linked = await supabase.from('contracts').update({ file_id: inserted.data[0].id }).eq('id', contract.id).select('id')
      if (linked.error) throw linked.error
    },
    onSettled: invalidate,
  })
}

/** Lien temporaire (10 min) vers le PDF signé. */
export function useContractFileUrl(fileId: string | null) {
  return useQuery({
    queryKey: contractKeys.file(fileId ?? ''),
    enabled: fileId !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_files')
        .select('name, storage_path')
        .eq('id', fileId ?? '')
        .limit(1)
        .overrideTypes<Pick<ProjectFile, 'name' | 'storage_path'>[], { merge: false }>()
      if (error) throw error
      const file = data[0]
      if (!file) return null
      const signed = await supabase.storage.from(FILES_BUCKET).createSignedUrl(file.storage_path, 600)
      if (signed.error) throw signed.error
      return { name: file.name, url: signed.data.signedUrl }
    },
  })
}
