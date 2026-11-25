/** Formes réduites lues par le classement des fichiers déposés (contexte donné à Claude, rapprochements). */
import type { FileKind, ProjectStatus } from '../../../src/shared/types.js'

export interface ClientRef {
  id: string
  name: string
  siret: string | null
}

export interface ProjectRef {
  id: string
  name: string
  client_id: string | null
  status: ProjectStatus
  start_date: string | null
  due_date: string | null
}

/** Devis ou facture de l'organisation (numéro, titre, client, projet, total TTC, date). */
export interface DocumentRef {
  id: string
  number: string
  title: string
  client_id: string
  project_id: string | null
  total_ttc_cents: number
  issue_date: string | null
}

/** Fichier rangé (project_files, hors corbeille). */
export interface FileRef {
  id: string
  project_id: string
  name: string
  folder: string
  kind: FileKind
  summary: string | null
  sha256: string | null
  quote_id: string | null
  invoice_id: string | null
  version_group_id: string
  version: number
  created_at: string
}

/** Version précédente possible, avec son texte (texte extrait du dépôt qui l'a rangée, sinon son résumé). */
export interface VersionCandidate extends FileRef {
  text: string | null
}

export interface ClassifyContext {
  /**
   * Devis et factures donnés à Claude et rapprochés (admin et finance seulement : un membre n'a pas accès aux
   * prix, même par une réponse de Claude que le texte du dépôt aurait détournée). Faux : quotes et invoices
   * vides, fichiers de devis / factures retirés de duplicates et candidates.
   */
  billing: boolean
  /** Clients actifs (non archivés). */
  clients: ClientRef[]
  /** Projets de l'organisation, non archivés d'abord. */
  projects: ProjectRef[]
  quotes: DocumentRef[]
  invoices: DocumentRef[]
  /** Fichiers rangés de même empreinte SHA-256. */
  duplicates: FileRef[]
  /** Fichiers proches : même nom normalisé, ou relié à un devis / une facture dont le numéro figure dans le dépôt. */
  candidates: VersionCandidate[]
}

/** Fichier de devis ou de facture (type, ou lien vers un document) : réservé à admin et finance. */
export function isBillingFile(file: Pick<FileRef, 'kind' | 'quote_id' | 'invoice_id'>): boolean {
  return file.kind === 'quote' || file.kind === 'invoice' || file.quote_id !== null || file.invoice_id !== null
}

export const FILE_REF_COLUMNS =
  'id, project_id, name, folder, kind, summary, sha256, quote_id, invoice_id, version_group_id, version, created_at'
export const DOCUMENT_REF_COLUMNS = 'id, number, title, client_id, project_id, total_ttc_cents, issue_date'

/** Projets qui comptent pour l'ambiguïté : ni archivés ni payés. */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['prospect', 'quote_sent', 'in_progress', 'delivered']
