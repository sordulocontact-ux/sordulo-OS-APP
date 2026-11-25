/**
 * Lectures du classement (clé service : chaque requête est bornée à l'organisation du dépôt).
 * Seuls eq / is / in / not is null / order / limit sont utilisés (simulés par fake-supabase).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { versionKey } from '../../../src/shared/filing.js'
import type { FileIntake, FileKind, FilingRule, Member } from '../../../src/shared/types.js'
import { documentNumberVariants, latestVersions } from './proposal.js'
import {
  DOCUMENT_REF_COLUMNS,
  FILE_REF_COLUMNS,
  isBillingFile,
  type ClassifyContext,
  type ClientRef,
  type DocumentRef,
  type FileRef,
  type ProjectRef,
  type VersionCandidate,
} from './types.js'

const CLIENTS_MAX = 300
const PROJECTS_MAX = 300
const DOCUMENTS_MAX = 60
const FILES_SCAN_MAX = 500
const CANDIDATES_MAX = 5
/** Un numéro plus court se retrouverait par hasard dans n'importe quel texte. */
const NUMBER_MIN_LENGTH = 6

function failed(what: string, message: string): Error {
  return new Error(`lecture ${what} impossible (${message})`)
}

export async function loadIntake(admin: SupabaseClient, intakeId: string): Promise<FileIntake | null> {
  const { data, error } = await admin.from('file_intakes').select('*').eq('id', intakeId).maybeSingle()
  if (error) throw failed('du dépôt', error.message)
  return (data as FileIntake | null) ?? null
}

const BILLING_ROLES: readonly Member['role'][] = ['admin', 'finance']
const NO_ROWS = Promise.resolve({ data: [], error: null })

/**
 * Devis et factures visibles dans ce classement : l'appelant ET l'auteur du dépôt sont admin ou finance.
 * L'auteur compte aussi : la proposition (lien vers le devis, raisons écrites par Claude) est enregistrée sur
 * son dépôt, qu'il relit (un admin qui classe le dépôt d'un membre ne lui fait donc pas voir les devis).
 */
export async function billingVisible(
  admin: SupabaseClient,
  caller: Pick<Member, 'id' | 'role'>,
  intake: Pick<FileIntake, 'created_by'>,
): Promise<boolean> {
  if (!BILLING_ROLES.includes(caller.role)) return false
  if (intake.created_by === null || intake.created_by === caller.id) return true
  const { data, error } = await admin.from('members').select('role').eq('id', intake.created_by).maybeSingle()
  if (error) throw failed('de l’auteur du dépôt', error.message)
  const role = (data as Pick<Member, 'role'> | null)?.role
  return role !== undefined && BILLING_ROLES.includes(role)
}

/**
 * Contexte donné à Claude : clients, projets, doublons, fichiers proches ; devis et factures récents seulement
 * si `billing` (admin et finance, voir billingVisible). Sans `billing`, ni devis, ni factures, ni fichier de
 * devis / facture : le texte du dépôt ne peut pas faire recracher ce que l'appelant n'a pas le droit de lire.
 */
export async function loadClassifyContext(
  admin: SupabaseClient,
  intake: FileIntake,
  options: { billing: boolean },
): Promise<ClassifyContext> {
  const org = intake.organization_id
  const { billing } = options
  const [clients, projects, quotes, invoices, files, duplicates] = await Promise.all([
    admin.from('clients').select('id, name, siret').eq('organization_id', org).is('archived_at', null).order('name').limit(CLIENTS_MAX),
    admin
      .from('projects')
      .select('id, name, client_id, status, start_date, due_date')
      .eq('organization_id', org)
      .order('updated_at', { ascending: false })
      .limit(PROJECTS_MAX),
    billing
      ? admin.from('quotes').select(DOCUMENT_REF_COLUMNS).eq('organization_id', org).order('issue_date', { ascending: false }).limit(DOCUMENTS_MAX)
      : NO_ROWS,
    billing
      ? admin
          .from('invoices')
          .select(DOCUMENT_REF_COLUMNS)
          .eq('organization_id', org)
          .not('number', 'is', null)
          .order('issue_date', { ascending: false })
          .limit(DOCUMENTS_MAX)
      : NO_ROWS,
    admin
      .from('project_files')
      .select(FILE_REF_COLUMNS)
      .eq('organization_id', org)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(FILES_SCAN_MAX),
    intake.sha256
      ? admin.from('project_files').select(FILE_REF_COLUMNS).eq('organization_id', org).eq('sha256', intake.sha256).is('deleted_at', null)
      : NO_ROWS,
  ])
  if (clients.error) throw failed('des clients', clients.error.message)
  if (projects.error) throw failed('des projets', projects.error.message)
  if (quotes.error) throw failed('des devis', quotes.error.message)
  if (invoices.error) throw failed('des factures', invoices.error.message)
  if (files.error) throw failed('des fichiers', files.error.message)
  if (duplicates.error) throw failed('des fichiers', duplicates.error.message)

  const projectRows = (projects.data ?? []) as ProjectRef[]
  // Non archivés d'abord (tri stable : l'ordre de mise à jour est gardé dans chaque groupe).
  const sortedProjects = [...projectRows.filter((p) => p.status !== 'archived'), ...projectRows.filter((p) => p.status === 'archived')]
  const quoteRows = (quotes.data ?? []) as DocumentRef[]
  const invoiceRows = (invoices.data ?? []) as DocumentRef[]
  const allowed = (f: FileRef) => billing || !isBillingFile(f)
  const fileRows = ((files.data ?? []) as FileRef[]).filter(allowed)
  const duplicateRows = ((duplicates.data ?? []) as FileRef[]).filter(allowed)

  const candidates = await versionCandidates(admin, intake, fileRows, [...quoteRows, ...invoiceRows])
  return {
    billing,
    clients: (clients.data ?? []) as ClientRef[],
    projects: sortedProjects,
    quotes: quoteRows,
    invoices: invoiceRows,
    duplicates: duplicateRows,
    candidates,
  }
}

/**
 * Fichiers proches (versions précédentes possibles) : même nom normalisé, ou relié à un devis / une facture
 * dont le numéro figure dans le nom ou le texte du dépôt. Dernière version de chaque groupe, 5 au plus,
 * avec le texte extrait du dépôt qui les a rangés (sinon leur résumé).
 */
async function versionCandidates(
  admin: SupabaseClient,
  intake: FileIntake,
  files: readonly FileRef[],
  documents: readonly DocumentRef[],
): Promise<VersionCandidate[]> {
  const key = versionKey(intake.name)
  const haystack = `${intake.name}\n${intake.extracted_text ?? ''}`
  const mentioned = new Set(
    documents.filter((d) => d.number.length >= NUMBER_MIN_LENGTH && haystack.includes(d.number)).map((d) => d.id),
  )
  const near = files.filter(
    (f) =>
      !(intake.sha256 && f.sha256 === intake.sha256) &&
      ((key !== '' && versionKey(f.name) === key) ||
        (f.quote_id !== null && mentioned.has(f.quote_id)) ||
        (f.invoice_id !== null && mentioned.has(f.invoice_id))),
  )
  const latest = latestVersions(near)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, CANDIDATES_MAX)
  if (latest.length === 0) return []

  const { data, error } = await admin
    .from('file_intakes')
    .select('filed_file_id, extracted_text')
    .in(
      'filed_file_id',
      latest.map((f) => f.id),
    )
  if (error) throw failed('des versions précédentes', error.message)
  const texts = new Map<string, string>()
  for (const row of (data ?? []) as { filed_file_id: string | null; extracted_text: string | null }[]) {
    if (row.filed_file_id && row.extracted_text?.trim()) texts.set(row.filed_file_id, row.extracted_text)
  }
  return latest.map((f) => ({ ...f, text: texts.get(f.id) ?? f.summary }))
}

/** Devis (kind quote) ou factures (kind invoice) de l'organisation dont le numéro est exactement celui lu. */
export async function findDocumentsByNumber(
  admin: SupabaseClient,
  organizationId: string,
  kind: FileKind,
  number: string | null,
): Promise<DocumentRef[]> {
  if (kind !== 'quote' && kind !== 'invoice') return []
  const variants = documentNumberVariants(number)
  if (variants.length === 0) return []
  const { data, error } = await admin
    .from(kind === 'quote' ? 'quotes' : 'invoices')
    .select(DOCUMENT_REF_COLUMNS)
    .eq('organization_id', organizationId)
    .in('number', variants)
  if (error) throw failed(kind === 'quote' ? 'des devis' : 'des factures', error.message)
  return (data ?? []) as DocumentRef[]
}

/** Fichiers (hors corbeille) déjà reliés à ce devis ou à cette facture. */
export async function filesLinkedTo(
  admin: SupabaseClient,
  organizationId: string,
  link: { quoteId: string | null; invoiceId: string | null },
): Promise<FileRef[]> {
  const column = link.quoteId ? 'quote_id' : link.invoiceId ? 'invoice_id' : null
  const id = link.quoteId ?? link.invoiceId
  if (!column || !id) return []
  const { data, error } = await admin
    .from('project_files')
    .select(FILE_REF_COLUMNS)
    .eq('organization_id', organizationId)
    .eq(column, id)
    .is('deleted_at', null)
  if (error) throw failed('des fichiers', error.message)
  return (data ?? []) as FileRef[]
}

/** Règle « Toujours » active pour ce client et ce type, s'il y en a une. */
export async function findActiveRule(
  admin: SupabaseClient,
  organizationId: string,
  clientId: string | null,
  kind: FileKind,
): Promise<FilingRule | null> {
  if (!clientId) return null
  const { data, error } = await admin
    .from('filing_rules')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('client_id', clientId)
    .eq('kind', kind)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle()
  if (error) throw failed('des règles de rangement', error.message)
  return (data as FilingRule | null) ?? null
}

/** Version précédente : sa ligne (pour le version_group_id et le projet). */
export async function loadFileRef(admin: SupabaseClient, fileId: string): Promise<FileRef | null> {
  const { data, error } = await admin.from('project_files').select(FILE_REF_COLUMNS).eq('id', fileId).maybeSingle()
  if (error) throw failed('du fichier', error.message)
  return (data as FileRef | null) ?? null
}
