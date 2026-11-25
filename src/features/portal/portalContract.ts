/**
 * Contrat HTTP du portail client public (api/portal.ts), partagé par la fonction serveur et PortalPage.
 * Sans session : tout passe par le jeton du lien (projects.portal_token). Aucune donnée interne :
 * pas d'id de membre, pas d'email, pas d'estimation, pas de note interne ; les membres n'apparaissent
 * que par leur prénom sur leurs commentaires.
 *
 * Imports relatifs en « .js » : ce fichier est aussi compilé avec l'API (Node ESM sur Vercel).
 */
import type {
  ContractStatus,
  DeliverableStatus,
  DeliverableVersionStatus,
  InvoiceKind,
  InvoiceStatus,
  LineUnit,
  ProjectStatus,
  QuoteStatus,
} from '../../shared/types.js'

/** Jeton du lien : 32 à 128 caractères [A-Za-z0-9_-] (même contrainte que la base). */
export const PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

/** Durée de validité des liens de fichiers signés renvoyés par le portail. */
export const PORTAL_SIGNED_URL_SECONDS = 600

/** Longueurs maximales acceptées par l'API (les champs sont trimés avant contrôle). */
export const PORTAL_LIMITS = {
  name: 80,
  comment: 2000,
  note: 2000,
} as const

export interface PortalProject {
  name: string
  clientName: string | null
  /** Nom de l'agence (organisation). */
  agencyName: string
  status: ProjectStatus
  startDate: string | null
  dueDate: string | null
}

export interface PortalAreaProgress {
  /** Partie du produit (« Accueil », « Paiement »…) ; null = sans partie. */
  area: string | null
  /** Tickets validés, pas encore terminés. */
  open: number
  done: number
}

export interface PortalProgress {
  tasksDone: number
  tasksTotal: number
  areas: PortalAreaProgress[]
}

export interface PortalComment {
  id: string
  x: number | null
  y: number | null
  body: string
  /** Nom tapé par le client, ou prénom du membre de l'équipe. */
  authorName: string
  fromClient: boolean
  resolved: boolean
  createdAt: string
}

export interface PortalFile {
  name: string
  mimeType: string | null
  /** URL signée courte (PORTAL_SIGNED_URL_SECONDS) ; null si le fichier n'est plus disponible. */
  url: string | null
}

export interface PortalVersion {
  id: string
  version: number
  status: DeliverableVersionStatus
  /** Note de l'équipe pour le client, saisie avec la version. */
  note: string | null
  createdAt: string
  decidedAt: string | null
  decidedByName: string | null
  file: PortalFile
  comments: PortalComment[]
}

export interface PortalDeliverable {
  id: string
  title: string
  description: string | null
  status: DeliverableStatus
  /** De la plus ancienne à la plus récente. */
  versions: PortalVersion[]
}

export interface PortalQuoteLine {
  label: string
  description: string | null
  quantity: number
  unit: LineUnit
  unitPriceCents: number
  vatRate: number
}

export interface PortalQuote {
  id: string
  number: string
  title: string
  /** Jamais « draft » : les brouillons ne sortent pas. */
  status: Exclude<QuoteStatus, 'draft' | 'refused'>
  /** Envoyé mais date de validité passée : ne peut plus être accepté sur le portail. */
  expired: boolean
  issueDate: string
  validUntil: string | null
  acceptedAt: string | null
  lines: PortalQuoteLine[]
  notes: string | null
  totalHtCents: number
  totalVatCents: number
  totalTtcCents: number
}

export interface PortalContract {
  id: string
  title: string
  /** Markdown. */
  body: string
  status: Extract<ContractStatus, 'sent' | 'signed'>
  sentAt: string | null
  signedAt: string | null
  signedByName: string | null
}

export interface PortalInvoice {
  id: string
  number: string | null
  title: string
  kind: InvoiceKind
  status: Extract<InvoiceStatus, 'issued' | 'paid'>
  totalTtcCents: number
  issueDate: string | null
  dueDate: string | null
  paidAt: string | null
  /** Émise et échéance dépassée. */
  overdue: boolean
}

/** GET /api/portal?token=… */
export interface PortalResponse {
  project: PortalProject
  progress: PortalProgress
  deliverables: PortalDeliverable[]
  quotes: PortalQuote[]
  contracts: PortalContract[]
  invoices: PortalInvoice[]
}

/** POST /api/portal : une action du client. */
export type PortalActionRequest =
  | { token: string; action: 'comment'; versionId: string; x?: number | null; y?: number | null; body: string; authorName: string }
  | { token: string; action: 'approve'; versionId: string; authorName: string; note?: string }
  | { token: string; action: 'request_changes'; versionId: string; authorName: string; note?: string }
  | { token: string; action: 'accept_quote'; quoteId: string; authorName: string; accepted: true }
  | { token: string; action: 'sign_contract'; contractId: string; signerName: string; accepted: true }

export type PortalAction = PortalActionRequest['action']

export interface PortalActionResponse {
  ok: true
  /** Commentaire créé (action comment). */
  comment?: PortalComment
}
