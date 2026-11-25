/**
 * Lecture du portail client : projet retrouvé par son jeton, puis tout ce que le client peut voir.
 * Clé service (aucune RLS) : chaque requête est bornée au projet du jeton, et chaque statut est
 * filtré deux fois (dans la requête et dans le code) pour qu'aucun brouillon ne sorte.
 * Seuls des champs destinés au client sont renvoyés (voir src/features/portal/portalContract.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { quoteDisplayStatus } from '../../../src/shared/billing.js'
import type {
  Contract,
  Deliverable,
  DeliverableComment,
  DeliverableVersion,
  DocumentLine,
  Invoice,
  Member,
  Project,
  ProjectFile,
  Quote,
  Task,
  Ticket,
} from '../../../src/shared/types.js'
import {
  PORTAL_SIGNED_URL_SECONDS,
  type PortalAreaProgress,
  type PortalComment,
  type PortalContract,
  type PortalDeliverable,
  type PortalInvoice,
  type PortalProgress,
  type PortalQuote,
  type PortalResponse,
} from '../../../src/features/portal/portalContract.js'

/** Bucket privé des fichiers rangés (migration 0010). */
export const FILES_BUCKET = 'files'

export const PORTAL_QUOTE_STATUSES = ['sent', 'accepted'] as const
export const PORTAL_CONTRACT_STATUSES = ['sent', 'signed'] as const
export const PORTAL_INVOICE_STATUSES = ['issued', 'paid'] as const

export type PortalProjectRow = Pick<
  Project,
  'id' | 'organization_id' | 'client_id' | 'name' | 'status' | 'start_date' | 'due_date'
>

const PROJECT_COLUMNS = 'id, organization_id, client_id, name, status, start_date, due_date'

function fail(what: string, error: { message: string }): never {
  throw new Error(`Portail : lecture ${what} impossible : ${error.message}`)
}

/** Projet dont le portail est ouvert avec ce jeton (null si aucun). Le format est vérifié avant l'appel. */
export async function findProjectByToken(admin: SupabaseClient, token: string): Promise<PortalProjectRow | null> {
  const { data, error } = await admin.from('projects').select(PROJECT_COLUMNS).eq('portal_token', token).limit(1).maybeSingle()
  if (error) fail('du projet', error)
  return (data as PortalProjectRow | null) ?? null
}

/** Prénom affiché sur un commentaire de l'équipe (jamais l'email ni l'identifiant). */
export function memberDisplayName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first || 'L’équipe'
}

type CommentRow = Pick<
  DeliverableComment,
  'id' | 'version_id' | 'x' | 'y' | 'body' | 'author_member_id' | 'author_name' | 'from_client' | 'resolved_at' | 'created_at'
>

export function toPortalComment(row: CommentRow, memberNames: ReadonlyMap<string, string>): PortalComment {
  const authorName = row.from_client
    ? (row.author_name ?? 'Le client')
    : memberDisplayName(row.author_member_id ? memberNames.get(row.author_member_id) : null)
  return {
    id: row.id,
    x: row.x === null ? null : Number(row.x),
    y: row.y === null ? null : Number(row.y),
    body: row.body,
    authorName,
    fromClient: row.from_client,
    resolved: row.resolved_at !== null,
    createdAt: row.created_at,
  }
}

/** Avancement : tâches faites / total, tickets validés et terminés par partie (sans titre ni estimation). */
export function computeProgress(
  tasks: readonly Pick<Task, 'status'>[],
  tickets: readonly Pick<Ticket, 'status' | 'area'>[],
): PortalProgress {
  const byArea = new Map<string | null, PortalAreaProgress>()
  for (const ticket of tickets) {
    if (ticket.status !== 'validated' && ticket.status !== 'done') continue
    const area = ticket.area?.trim() || null
    const entry = byArea.get(area) ?? { area, open: 0, done: 0 }
    if (ticket.status === 'done') entry.done += 1
    else entry.open += 1
    byArea.set(area, entry)
  }
  const areas = [...byArea.values()].sort((a, b) => {
    if (a.area === null) return 1
    if (b.area === null) return -1
    return b.open - a.open || a.area.localeCompare(b.area, 'fr')
  })
  return {
    tasksDone: tasks.filter((t) => t.status === 'done').length,
    tasksTotal: tasks.length,
    areas,
  }
}

function publicLines(lines: readonly DocumentLine[] | null): PortalQuote['lines'] {
  // service_id et rebilled (commission de l'apporteur) restent internes.
  return (lines ?? []).map((line) => ({
    label: line.label,
    description: line.description ?? null,
    quantity: Number(line.quantity),
    unit: line.unit,
    unitPriceCents: Number(line.unit_price_cents),
    vatRate: Number(line.vat_rate),
  }))
}

type QuoteRow = Pick<
  Quote,
  | 'id'
  | 'project_id'
  | 'number'
  | 'title'
  | 'status'
  | 'issue_date'
  | 'valid_until'
  | 'accepted_at'
  | 'lines'
  | 'notes'
  | 'total_ht_cents'
  | 'total_vat_cents'
  | 'total_ttc_cents'
>

export function toPortalQuote(row: QuoteRow, today: string): PortalQuote | null {
  if (row.status !== 'sent' && row.status !== 'accepted') return null
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    expired: quoteDisplayStatus(row, today) === 'expired',
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    acceptedAt: row.accepted_at,
    lines: publicLines(row.lines),
    notes: row.notes,
    totalHtCents: row.total_ht_cents,
    totalVatCents: row.total_vat_cents,
    totalTtcCents: row.total_ttc_cents,
  }
}

type ContractRow = Pick<Contract, 'id' | 'title' | 'body' | 'status' | 'sent_at' | 'signed_at' | 'signed_by_name'>

export function toPortalContract(row: ContractRow): PortalContract | null {
  if (row.status !== 'sent' && row.status !== 'signed') return null
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    sentAt: row.sent_at,
    signedAt: row.signed_at,
    signedByName: row.signed_by_name,
  }
}

type InvoiceRow = Pick<
  Invoice,
  'id' | 'number' | 'title' | 'kind' | 'status' | 'total_ttc_cents' | 'issue_date' | 'due_date' | 'paid_at'
>

export function toPortalInvoice(row: InvoiceRow, today: string): PortalInvoice | null {
  if (row.status !== 'issued' && row.status !== 'paid') return null
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    kind: row.kind,
    status: row.status,
    totalTtcCents: row.total_ttc_cents,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    overdue: row.status === 'issued' && row.due_date !== null && row.due_date < today,
  }
}

/** URLs signées courtes, par chemin (un fichier introuvable n'a pas d'URL). */
async function signPaths(admin: SupabaseClient, paths: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  const { data, error } = await admin.storage.from(FILES_BUCKET).createSignedUrls([...paths], PORTAL_SIGNED_URL_SECONDS)
  if (error) {
    console.error('[portal] URLs signées impossibles', error.message)
    return urls
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl)
  }
  return urls
}

type VersionRow = Pick<
  DeliverableVersion,
  'id' | 'deliverable_id' | 'version' | 'file_id' | 'note' | 'status' | 'decided_at' | 'decided_by_name' | 'created_at'
>
type FileRow = Pick<ProjectFile, 'id' | 'name' | 'mime_type' | 'storage_path' | 'deleted_at' | 'project_id'>

async function loadDeliverables(admin: SupabaseClient, projectId: string): Promise<PortalDeliverable[]> {
  const deliverablesRes = await admin
    .from('deliverables')
    .select('id, project_id, title, description, status, position')
    .eq('project_id', projectId)
    .order('position')
  if (deliverablesRes.error) fail('des livrables', deliverablesRes.error)
  const deliverables = (deliverablesRes.data as Pick<Deliverable, 'id' | 'project_id' | 'title' | 'description' | 'status' | 'position'>[])
    .filter((d) => d.project_id === projectId)
    .sort((a, b) => a.position - b.position)
  if (deliverables.length === 0) return []

  const versionsRes = await admin
    .from('deliverable_versions')
    .select('id, deliverable_id, version, file_id, note, status, decided_at, decided_by_name, created_at')
    .in(
      'deliverable_id',
      deliverables.map((d) => d.id),
    )
  if (versionsRes.error) fail('des versions', versionsRes.error)
  const versions = versionsRes.data as VersionRow[]

  const fileIds = [...new Set(versions.map((v) => v.file_id))]
  const versionIds = versions.map((v) => v.id)
  const [filesRes, commentsRes] = await Promise.all([
    fileIds.length
      ? admin.from('project_files').select('id, name, mime_type, storage_path, deleted_at, project_id').in('id', fileIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length
      ? admin
          .from('deliverable_comments')
          .select('id, version_id, x, y, body, author_member_id, author_name, from_client, resolved_at, created_at')
          .in('version_id', versionIds)
          .order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (filesRes.error) fail('des fichiers', filesRes.error)
  if (commentsRes.error) fail('des commentaires', commentsRes.error)
  const files = new Map((filesRes.data as FileRow[]).filter((f) => f.project_id === projectId).map((f) => [f.id, f]))
  const comments = commentsRes.data as CommentRow[]

  const authorIds = [...new Set(comments.map((c) => c.author_member_id).filter((v): v is string => Boolean(v)))]
  const memberNames = new Map<string, string>()
  if (authorIds.length > 0) {
    const membersRes = await admin.from('members').select('id, name').in('id', authorIds)
    if (membersRes.error) fail('des auteurs', membersRes.error)
    for (const m of membersRes.data as Pick<Member, 'id' | 'name'>[]) memberNames.set(m.id, m.name)
  }

  const livePaths = [...files.values()].filter((f) => f.deleted_at === null).map((f) => f.storage_path)
  const urls = await signPaths(admin, livePaths)

  return deliverables.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    status: d.status,
    versions: versions
      .filter((v) => v.deliverable_id === d.id)
      .sort((a, b) => a.version - b.version)
      .map((v) => {
        const file = files.get(v.file_id)
        return {
          id: v.id,
          version: v.version,
          status: v.status,
          note: v.note,
          createdAt: v.created_at,
          decidedAt: v.decided_at,
          decidedByName: v.decided_by_name,
          file: {
            name: file?.name ?? 'Fichier',
            mimeType: file?.mime_type ?? null,
            url: file && file.deleted_at === null ? (urls.get(file.storage_path) ?? null) : null,
          },
          comments: comments
            .filter((c) => c.version_id === v.id)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((c) => toPortalComment(c, memberNames)),
        }
      }),
  }))
}

/** Tout le portail d'un projet. `today` : AAAA-MM-JJ (Europe/Paris). */
export async function loadPortalView(admin: SupabaseClient, project: PortalProjectRow, today: string): Promise<PortalResponse> {
  const [orgRes, clientRes, tasksRes, ticketsRes, quotesRes, contractsRes, invoicesRes, deliverables] = await Promise.all([
    admin.from('organizations').select('id, name').eq('id', project.organization_id).maybeSingle(),
    project.client_id
      ? admin.from('clients').select('id, name').eq('id', project.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('tasks').select('status').eq('project_id', project.id),
    admin.from('tickets').select('status, area').eq('project_id', project.id).in('status', ['validated', 'done']),
    admin
      .from('quotes')
      .select(
        'id, project_id, number, title, status, issue_date, valid_until, accepted_at, lines, notes, total_ht_cents, total_vat_cents, total_ttc_cents',
      )
      .eq('project_id', project.id)
      .in('status', [...PORTAL_QUOTE_STATUSES])
      .order('issue_date', { ascending: false }),
    admin
      .from('contracts')
      .select('id, project_id, title, body, status, sent_at, signed_at, signed_by_name')
      .eq('project_id', project.id)
      .in('status', [...PORTAL_CONTRACT_STATUSES])
      .order('created_at', { ascending: false }),
    admin
      .from('invoices')
      .select('id, project_id, number, title, kind, status, total_ttc_cents, issue_date, due_date, paid_at')
      .eq('project_id', project.id)
      .in('status', [...PORTAL_INVOICE_STATUSES])
      .order('issue_date', { ascending: false }),
    loadDeliverables(admin, project.id),
  ])
  if (orgRes.error) fail('de l’agence', orgRes.error)
  if (clientRes.error) fail('du client', clientRes.error)
  if (tasksRes.error) fail('des tâches', tasksRes.error)
  if (ticketsRes.error) fail('des tickets', ticketsRes.error)
  if (quotesRes.error) fail('des devis', quotesRes.error)
  if (contractsRes.error) fail('des contrats', contractsRes.error)
  if (invoicesRes.error) fail('des factures', invoicesRes.error)

  const ofProject = <T extends { project_id: string | null }>(rows: T[]): T[] => rows.filter((r) => r.project_id === project.id)

  return {
    project: {
      name: project.name,
      clientName: (clientRes.data as { name: string } | null)?.name ?? null,
      agencyName: (orgRes.data as { name: string } | null)?.name ?? '',
      status: project.status,
      startDate: project.start_date,
      dueDate: project.due_date,
    },
    progress: computeProgress(tasksRes.data as Pick<Task, 'status'>[], ticketsRes.data as Pick<Ticket, 'status' | 'area'>[]),
    deliverables,
    quotes: ofProject(quotesRes.data as QuoteRow[])
      .map((q) => toPortalQuote(q, today))
      .filter((q): q is PortalQuote => q !== null),
    contracts: ofProject(contractsRes.data as (ContractRow & { project_id: string | null })[])
      .map(toPortalContract)
      .filter((c): c is PortalContract => c !== null),
    invoices: ofProject(invoicesRes.data as (InvoiceRow & { project_id: string | null })[])
      .map((i) => toPortalInvoice(i, today))
      .filter((i): i is PortalInvoice => i !== null),
  }
}
