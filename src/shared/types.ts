/**
 * Data contract shared by the front (src/) and the serverless functions (api/).
 * Mirrors supabase/migrations exactly: any column change goes here too.
 * Relative imports in src/shared and api/ use the ".js" extension (Node ESM on Vercel).
 */

export const MEMBER_ROLES = ['admin', 'membre', 'prospection', 'finance'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

/** Statuts d'un projet (migration 0003 : l'ancien « active » devient « in_progress »). */
export const PROJECT_STATUSES = ['prospect', 'quote_sent', 'in_progress', 'delivered', 'paid', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Jours de la semaine ISO : 1 = lundi … 7 = dimanche (members.unavailable_weekdays). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Niveau d'une compétence saisi dans l'équipe (1 à 5). 0 ou absent = ne pratique pas. */
export const SKILL_LEVEL_MIN = 1
export const SKILL_LEVEL_MAX = 5

export const SKILLS = ['design', 'dev'] as const
export type Skill = (typeof SKILLS)[number]

export const INPUT_KINDS = ['meeting', 'written'] as const
export type InputKind = (typeof INPUT_KINDS)[number]

export const INPUT_STATUSES = ['uploaded', 'transcribing', 'analyzing', 'ready', 'error'] as const
export type InputStatus = (typeof INPUT_STATUSES)[number]

export const TICKET_TYPES = ['bug', 'modification', 'new_request'] as const
export type TicketType = (typeof TICKET_TYPES)[number]

export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_STATUSES = ['proposed', 'validated', 'rejected', 'done'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/**
 * Niveaux de compétence, ex. { "design": 5, "dev": 2, "motion": 3 } : 1 à 5 saisis dans l'Équipe, 0 ou absent =
 * ne pratique pas. Compétences ouvertes depuis la migration 0012 : toute clé de 1 à 30 caractères (design et dev
 * restent les compétences des tâches).
 */
export type SkillLevels = Partial<Record<string, number>>

/** Longueur maximale du nom d'une compétence (contrainte members_skills_levels_check, migration 0012). */
export const SKILL_KEY_MAX_LENGTH = 30

/** Nombre maximal d'affinités d'un membre (migration 0012). */
export const AFFINITIES_MAX = 30

/** Priorité d'une tâche (migration 0012), mêmes valeurs que les tickets. */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/* ---------- Devis, factures, prospection (migration 0004) ---------- */

/** Brouillon → envoyé → accepté ou refusé. « Expiré » est calculé (envoyé et date de validité passée). */
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'refused'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/** Facture, facture d'acompte, avoir (annule une facture émise). */
export const INVOICE_KINDS = ['invoice', 'deposit', 'credit_note'] as const
export type InvoiceKind = (typeof INVOICE_KINDS)[number]

/** Brouillon modifiable → émise (numérotée, figée) ↔ payée ; annulée par un avoir. */
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const LINE_UNITS = ['day', 'hour', 'flat', 'unit'] as const
export type LineUnit = (typeof LINE_UNITS)[number]

/**
 * Étapes de prospection. « À auditer » et « Offre prête » (migration 0014) sont posées par l'agence : un prospect
 * créé par un apporteur commence « À auditer ». L'apporteur ne pose que les étapes de démarche.
 */
export const PROSPECT_STAGES = ['to_audit', 'offer_ready', 'to_contact', 'contacted', 'followed_up', 'meeting', 'won', 'lost'] as const
export type ProspectStage = (typeof PROSPECT_STAGES)[number]

/** Étapes que l'apporteur (rôle prospection) peut poser, et seulement « Perdu » tant que le prospect est « À auditer ». */
export const PROSPECT_OUTREACH_STAGES = ['to_contact', 'contacted', 'followed_up', 'meeting', 'won', 'lost'] as const satisfies readonly ProspectStage[]

/** État du pré-audit IA d'un prospect (migration 0014). */
export const PROSPECT_AUDIT_STATUSES = ['none', 'running', 'done', 'error'] as const
export type ProspectAuditStatus = (typeof PROSPECT_AUDIT_STATUSES)[number]

/** Ligne d'un devis ou d'une facture (jsonb). Montants en centimes HT. */
export interface DocumentLine {
  label: string
  description: string | null
  /** > 0, décimales permises (0,5 jour). */
  quantity: number
  unit: LineUnit
  /** Prix unitaire HT en centimes ; négatif seulement sur un avoir. */
  unit_price_cents: number
  /** Taux de TVA en %, 0 à 100. */
  vat_rate: number
  /** Prestation du catalogue d'où vient la ligne (migration 0011) : ses tâches types sont proposées à l'acceptation. */
  service_id?: string | null
  /** Frais refacturés (migration 0011) : comptés dans les totaux, exclus de la commission de l'apporteur. */
  rebilled?: boolean | null
}

/**
 * Émetteur de facturation (migration 0005) : une des micro-entreprises qui émettent les documents de
 * l'organisation (ex. Sacha Moricet EI, Maël Auzenet EI). Chacun a ses infos légales, son IBAN et sa
 * série de numéros de factures.
 */
export interface BillingIssuer {
  id: string
  organization_id: string
  member_id: string | null
  display_name: string
  legal_name: string | null
  legal_form: string | null
  siret: string | null
  address_street: string | null
  address_postal_code: string | null
  address_city: string | null
  address_country: string | null
  vat_mention: string | null
  vat_number: string | null
  bank_iban: string | null
  bank_bic: string | null
  email: string | null
  phone: string | null
  /** Émetteur proposé par défaut (un seul par organisation). */
  is_default: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

/** Totaux calculés par la base (trigger), en centimes. */
export interface DocumentTotals {
  total_ht_cents: number
  total_vat_cents: number
  total_ttc_cents: number
}

export interface Quote extends DocumentTotals {
  id: string
  organization_id: string
  client_id: string
  project_id: string | null
  /** Émetteur (micro-entreprise) ; null = l'organisation. */
  issuer_id: string | null
  /** AAAA-NNN, attribué par la base à la création (les devis importés gardent leur numéro d'origine). */
  number: string
  title: string
  status: QuoteStatus
  issue_date: string
  valid_until: string | null
  lines: DocumentLine[]
  notes: string | null
  sent_at: string | null
  accepted_at: string | null
  refused_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Vendeur copié dans la facture à l'émission (l'organisation à cette date). */
export interface InvoiceSeller {
  name: string
  legal_name: string | null
  legal_form: string | null
  siret: string | null
  address_street: string | null
  address_postal_code: string | null
  address_city: string | null
  address_country: string | null
  vat_mention: string | null
  bank_iban: string | null
  bank_bic: string | null
  /** Émetteur seulement (migration 0005) ; absents des factures émises avant. */
  vat_number?: string | null
  email?: string | null
  phone?: string | null
}

/** Acheteur copié dans la facture à l'émission (le client à cette date). */
export interface InvoiceBuyer {
  name: string
  siret: string | null
  billing_street: string | null
  billing_postal_code: string | null
  billing_city: string | null
  billing_country: string | null
  contact_name: string | null
  contact_email: string | null
}

export interface Invoice extends DocumentTotals {
  id: string
  organization_id: string
  client_id: string
  project_id: string | null
  quote_id: string | null
  /** Émetteur (micro-entreprise) ; null = l'organisation. Sa série numérote factures, acomptes et avoirs. */
  issuer_id: string | null
  kind: InvoiceKind
  status: InvoiceStatus
  /** AAAA-NNN dans la série de l'émetteur (les factures importées gardent leur numéro d'origine) ; null en brouillon. */
  number: string | null
  title: string
  issue_date: string | null
  due_date: string | null
  lines: DocumentLine[]
  notes: string | null
  /** Facture d'acompte : pourcentage du devis (information). */
  deposit_percent: number | null
  /** Avoir : facture annulée. */
  credited_invoice_id: string | null
  /** null tant que la facture est en brouillon. */
  seller: InvoiceSeller | null
  buyer: InvoiceBuyer | null
  issued_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Prospect {
  id: string
  organization_id: string
  company: string
  website: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  /** D'où vient le prospect (salon, recommandation, recherche…), texte libre. */
  source: string | null
  stage: ProspectStage
  next_action_date: string | null
  notes: string | null
  owner_member_id: string | null
  /** Client créé à la conversion. */
  client_id: string | null
  /** Passage à « gagné » (posé par la base), null sinon. */
  won_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** Date du premier contact, AAAA-MM-JJ (migration 0014) : fait foi pour la commission. Seul un admin la modifie. */
  registered_at: string
  /** Pré-audit IA du site, écrit par le serveur. */
  audit: ProspectAudit | null
  audit_status: ProspectAuditStatus
  /** Audit humain (admin, membre). audited_at / audited_by sont posés par la base. */
  audit_notes: string | null
  audited_at: string | null
  audited_by: string | null
  /** Offre recommandée (prestation du catalogue) et ses notes (admin, membre). */
  recommended_service_id: string | null
  offer_notes: string | null
  /** Argumentaire (IA ou apporteur). */
  pitch: string | null
  lost_reason: string | null
  /** Le prospect s'oppose à tout nouveau contact (RGPD). */
  do_not_contact: boolean
}

/** Pré-audit IA d'un site (prospects.audit, jsonb). Scores de 0 à 100. */
export interface ProspectAudit {
  url: string
  /** Date de l'audit (ISO). */
  audited_at: string
  /** Le site s'affiche correctement sur mobile. null = inconnu. */
  mobile_friendly: boolean | null
  /** Vitesse : score PageSpeed et temps de chargement estimé. */
  speed_score: number | null
  load_time_ms: number | null
  /** Référencement naturel (balises, titres, métadonnées). */
  seo_score: number | null
  /** Le design paraît daté. */
  dated_design: boolean | null
  /** Autres scores (accessibilité, bonnes pratiques…). */
  scores: Record<string, number>
  /** Points relevés, du plus important au moins important. */
  points: { label: string; severity: 'low' | 'medium' | 'high'; detail?: string }[]
  /** Résumé en une ou deux phrases. */
  summary: string | null
  /** Source des mesures : PageSpeed Insights, ou analyse du HTML seul. */
  source: 'pagespeed' | 'html'
}

export interface Organization {
  id: string
  name: string
  /** Infos légales, utilisées par les futurs devis et factures (migration 0003). */
  legal_name: string | null
  legal_form: string | null
  /** 14 chiffres, sans espaces. */
  siret: string | null
  address_street: string | null
  address_postal_code: string | null
  address_city: string | null
  address_country: string | null
  /** Mention TVA libre, ex. « TVA non applicable, art. 293 B du CGI ». */
  vat_mention: string | null
  /** Taux par défaut en euros HT. */
  default_daily_rate: number | null
  default_hourly_rate: number | null
  /** Facturation (migration 0004) : TVA par défaut des lignes (%), délai de paiement (jours, 60 max), validité des devis (jours). */
  default_vat_rate: number
  payment_terms_days: number
  quote_validity_days: number
  bank_iban: string | null
  bank_bic: string | null
  created_at: string
  updated_at: string
}

export interface Member {
  id: string
  organization_id: string
  user_id: string | null
  name: string
  email: string
  role: MemberRole
  skills: SkillLevels
  weekly_capacity_hours: number
  /** Jours indisponibles chaque semaine (école, alternance), 1 = lundi … 7 = dimanche. Stockés seulement. */
  unavailable_weekdays: Weekday[]
  /** Date d'invitation par un admin (null pour les membres créés par le seed). */
  invited_at: string | null
  /** Retiré de l'organisation : ne voit plus rien, ne reçoit plus de tâches. null = actif. */
  removed_at: string | null
  created_at: string
  updated_at: string
  /** Sujets que le membre aime traiter (migration 0012), 30 au plus. */
  affinities: string[]
}

export interface Client {
  id: string
  organization_id: string
  name: string
  /** 14 chiffres, sans espaces. */
  siret: string | null
  billing_street: string | null
  billing_postal_code: string | null
  billing_city: string | null
  billing_country: string | null
  website: string | null
  notes: string | null
  /** Archivé : masqué des listes par défaut. null = actif. */
  archived_at: string | null
  /** @deprecated Repris dans client_contacts par la migration 0003. Ne plus lire ni écrire. */
  contact_name: string | null
  /** @deprecated Repris dans client_contacts par la migration 0003. Ne plus lire ni écrire. */
  contact_email: string | null
  created_at: string
  updated_at: string
}

export interface ClientContact {
  id: string
  /** Rempli par un trigger à partir du client. */
  organization_id: string
  client_id: string
  name: string
  email: string | null
  phone: string | null
  /** Rôle chez le client (« Directrice marketing »…), texte libre. */
  role: string | null
  /** Un seul contact principal par client (index unique partiel). */
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  organization_id: string
  client_id: string | null
  name: string
  status: ProjectStatus
  /** Dates au format AAAA-MM-JJ. */
  start_date: string | null
  due_date: string | null
  tone_of_voice: string | null
  /**
   * Mémoire de l'IA pour ce projet (migration 0007) : consignes de l'équipe (qui fait quelles pages,
   * façon de regrouper ou rédiger). Complétée par les notes à l'IA, modifiable à la main, 4000 caractères max.
   */
  ai_instructions: string | null
  /** Rounds de retours compris dans le devis (migration 0011), 0 à 20. */
  feedback_rounds_included: number
  /** Droits de diffusion (portfolio). */
  showcase: ProjectShowcase
  /** Étude de cas proposée à la clôture. */
  case_study: CaseStudy | null
  /** Jeton du lien secret du portail client (32 à 128 caractères [A-Za-z0-9_-]) ; null = portail fermé. */
  portal_token: string | null
  created_at: string
  updated_at: string
}

/** Droits de diffusion d'un projet (migration 0011). */
export const PROJECT_SHOWCASES = ['unknown', 'showable', 'nda'] as const
export type ProjectShowcase = (typeof PROJECT_SHOWCASES)[number]

/** Étude de cas d'un projet (projects.case_study, jsonb). Champs libres, tous facultatifs. */
export interface CaseStudy {
  title?: string
  summary?: string
  challenge?: string
  solution?: string
  results?: string
  /** Fichiers du projet (project_files) à montrer. */
  file_ids?: string[]
  /** Brouillon proposé par l'IA, ou relu et prêt à publier. */
  status?: 'draft' | 'ready'
}

/** Rounds de retours compris par défaut (projects.feedback_rounds_included). */
export const DEFAULT_FEEDBACK_ROUNDS = 2

/** Longueur maximale de la mémoire de l'IA d'un projet (contrainte de la migration 0007). */
export const AI_INSTRUCTIONS_MAX_LENGTH = 4000

/** Membres affectés à un projet. Si un projet en a, l'attribution automatique se limite à eux. */
export interface ProjectMember {
  project_id: string
  member_id: string
  /** Rempli par un trigger à partir du projet. */
  organization_id: string
  created_at: string
}

/** One diarized segment of a meeting transcript. speaker = 0-based voice index from the STT. */
export interface TranscriptUtterance {
  speaker: number
  start: number
  end: number
  text: string
}

export interface Transcript {
  provider: string
  language: string
  duration_seconds: number | null
  utterances: TranscriptUtterance[]
}

/** Display names given to voices: { "0": "Maël", "1": "Ibé" }. */
export type SpeakerNames = Record<string, string>

export interface Input {
  id: string
  organization_id: string
  project_id: string
  kind: InputKind
  title: string | null
  audio_path: string | null
  raw_text: string | null
  transcript: Transcript | null
  speaker_names: SpeakerNames
  status: InputStatus
  error_message: string | null
  created_by: string | null
  /** Devis accepté d'où vient l'entrée (migration 0011, propose_tasks_from_quote) ; une entrée par devis. */
  quote_id: string | null
  created_at: string
  updated_at: string
}

export interface Ticket {
  id: string
  organization_id: string
  project_id: string
  input_id: string | null
  title: string
  description: string
  type: TicketType
  priority: TicketPriority
  source_quote: string | null
  status: TicketStatus
  related_ticket_id: string | null
  /** Partie du produit concernée (« Finance », « Juridique »…), donnée par l'analyse. */
  area: string | null
  /** Pourquoi le ticket est allé à cette personne (charge, habitude). */
  assignment_note: string | null
  created_at: string
}

export interface Task {
  id: string
  organization_id: string
  project_id: string
  ticket_id: string | null
  title: string
  skill: Skill
  estimate_hours: number | null
  assignee_member_id: string | null
  /** Filled by a database trigger (migration 0006): who set the assignee, and when. Null for service-role writes. */
  assigned_by_member_id: string | null
  assigned_at: string | null
  status: TaskStatus
  depends_on_task_id: string | null
  position: number
  /** Échéance AAAA-MM-JJ (migration 0012). */
  due_date: string | null
  priority: TaskPriority
  /**
   * Passage à « Fait » (migration 0016), posé par la base, null hors de « Fait » et pour les tâches finies avant
   * 0016. Optionnel dans le type pour ne pas casser les jeux de données des tests ; toujours présent en base.
   */
  done_at?: string | null
  created_at: string
}

/* ---------- Fichiers et rangement automatique (migration 0010) ---------- */

/**
 * Bucket Storage privé des fichiers (100 Mo par fichier). Chemins (1er segment = organisation) :
 *   `<organization_id>/<project_id>/<uuid>-<nom>`        fichier rangé (admin, membre, finance)
 *   `<organization_id>/inbox/<member_id>/<uuid>-<nom>`   dépôt en attente (seulement son propre dossier)
 */
export const FILES_BUCKET = 'files'
export const FILE_MAX_BYTES = 104_857_600
export const FILES_INBOX_FOLDER = 'inbox'

/** Type d'un document rangé. */
export const FILE_KINDS = ['quote', 'invoice', 'contract', 'brief', 'mockup', 'feedback', 'deliverable', 'asset', 'other'] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** Dossiers types d'un projet (texte libre accepté, 80 caractères au plus). */
export const DEFAULT_FOLDERS = ['Devis', 'Factures', 'Contrats', 'Briefs', 'Maquettes', 'Retours', 'Livrables', 'Divers'] as const
export type DefaultFolder = (typeof DEFAULT_FOLDERS)[number]
export const FILE_FOLDER_MAX_LENGTH = 80

/** Dossier proposé par défaut pour chaque type. */
export const FOLDER_BY_KIND = {
  quote: 'Devis',
  invoice: 'Factures',
  contract: 'Contrats',
  brief: 'Briefs',
  mockup: 'Maquettes',
  feedback: 'Retours',
  deliverable: 'Livrables',
  asset: 'Divers',
  other: 'Divers',
} as const satisfies Record<FileKind, DefaultFolder>

export const FILE_INTAKE_SOURCES = ['island', 'web'] as const
export type FileIntakeSource = (typeof FILE_INTAKE_SOURCES)[number]

/**
 * Déposé → classement (serveur) → prêt (proposition) → rangé, ou annulé / erreur. Un client de l'API ne pose que
 * ready (rangement annulé), filed (avec filed_file_id) et cancelled ; les autres statuts viennent du serveur.
 */
export const FILE_INTAKE_STATUSES = ['uploaded', 'classifying', 'ready', 'filed', 'cancelled', 'error'] as const
export type FileIntakeStatus = (typeof FILE_INTAKE_STATUSES)[number]

/** Longueur maximale du texte extrait d'un dépôt (file_intakes.extracted_text). */
export const EXTRACTED_TEXT_MAX_LENGTH = 20_000

/** Rangement validable dans l'île si la confiance atteint ce seuil et que le projet n'est pas ambigu. */
export const FILING_CONFIDENCE_THRESHOLD = 0.75

/** Fichier rangé dans un projet. */
export interface ProjectFile {
  id: string
  /** Rempli par un trigger à partir du projet. */
  organization_id: string
  project_id: string
  folder: string
  name: string
  /** Chemin dans le bucket « files », unique, dans le dossier de l'organisation. */
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  /** SHA-256 en hexadécimal minuscule (doublons). */
  sha256: string | null
  kind: FileKind
  summary: string | null
  /** = id de la 1re version. Pour une nouvelle version, donner le version_group_id de la 1re : la base numérote. */
  version_group_id: string
  version: number
  /** Ce qui change par rapport à la version précédente. */
  change_summary: string | null
  quote_id: string | null
  invoice_id: string | null
  /** Membre connecté par défaut (trigger). */
  uploaded_by: string | null
  /** Corbeille (rangement annulé ou fichier supprimé). */
  deleted_at: string | null
  created_at: string
  updated_at: string
}

/** Règle « Toujours » : les documents de ce type pour ce client vont dans ce projet / dossier. */
export interface FilingRule {
  id: string
  /** Rempli par un trigger à partir du client. */
  organization_id: string
  client_id: string
  kind: FileKind
  /** null = le projet détecté par l'IA. */
  project_id: string | null
  /** null = le dossier proposé. */
  folder: string | null
  created_by: string | null
  created_at: string
  /** Une seule règle active (revoked_at null) par client et type. */
  revoked_at: string | null
}

/** Proposition de rangement de l'IA (file_intakes.proposal, jsonb). */
export interface FileIntakeProposal {
  kind: FileKind
  client_id: string | null
  project_id: string | null
  folder: string
  /** Nom proposé pour le fichier rangé. */
  title: string
  summary: string | null
  /** Numéro lu dans le document (devis, facture). */
  document_number: string | null
  /** Date du document, AAAA-MM-JJ. */
  document_date: string | null
  amount_ttc_cents: number | null
  /** 0 à 1. */
  confidence: number
  /** Pourquoi ce rangement (indices lus dans le document). */
  reasons: string[]
  /** Devis ou facture de l'app dont le numéro correspond. */
  linked_quote_id: string | null
  linked_invoice_id: string | null
  /** Même empreinte SHA-256 qu'un fichier déjà rangé. */
  duplicate_of_file_id: string | null
  /** Nouvelle version de ce fichier. */
  previous_version_file_id: string | null
  change_summary: string | null
  /** Devis / facture sans équivalent dans l'app : proposer de l'importer (numéro d'origine gardé). */
  suggest_import: boolean
  /** Retour client : proposer d'en faire une entrée (tickets). */
  suggest_tickets: boolean
}

/** Dépôt en attente de rangement. */
export interface FileIntake {
  id: string
  organization_id: string
  /** Membre connecté par défaut (trigger). */
  created_by: string | null
  source: FileIntakeSource
  /** Fichiers déposés ensemble (validation en lot). */
  batch_id: string | null
  /** Chemin dans le bucket « files » (dossier inbox du membre). */
  storage_path: string
  name: string
  mime_type: string | null
  size_bytes: number | null
  sha256: string | null
  extracted_text: string | null
  /** Écrits par le serveur. */
  proposal: FileIntakeProposal | null
  confidence: number | null
  status: FileIntakeStatus
  error_message: string | null
  filed_file_id: string | null
  /** Rangé seul par une règle « Toujours » (serveur). */
  auto_filed: boolean
  rule_id: string | null
  created_at: string
  updated_at: string
}

/* ---------- Catalogue et briefs (migration 0011) ---------- */

/** Tâche type d'une prestation, reprise par propose_tasks_from_quote. */
export interface TaskTemplate {
  title: string
  skill: Skill
  estimate_hours: number | null
  /** Index (à partir de 0) d'une autre tâche type de la même prestation, ou null. */
  depends_on: number | null
}

/** Prestation du catalogue. */
export interface Service {
  id: string
  organization_id: string
  name: string
  description: string | null
  category: string | null
  unit: LineUnit
  unit_price_cents: number
  /** % de 0 à 100, comme les lignes de devis. */
  vat_rate: number
  /** Lignes de devis types (même forme que quotes.lines). */
  lines: DocumentLine[]
  task_templates: TaskTemplate[]
  active: boolean
  position: number
  created_at: string
  updated_at: string
}

/** Contenu d'un brief structuré (briefs.content, jsonb). */
export interface BriefContent {
  contexte: string
  objectifs: string[]
  livrables: string[]
  contraintes: string[]
  /** Budget annoncé, texte libre (« 5 à 8 k€ »). */
  budget: string | null
  /** Délais annoncés, texte libre. */
  delais: string | null
  questions_ouvertes: string[]
}

export interface Brief {
  id: string
  organization_id: string
  project_id: string
  /** Entrée d'où vient le brief (un brief par entrée). */
  input_id: string | null
  content: BriefContent
  /** Brouillon de devis créé depuis le brief. */
  quote_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ---------- Travail : temps, absences, barème (migration 0012) ---------- */

/** Entrée de temps : ended_at null = minuteur en cours (un seul par membre). Durée calculée à l'arrêt. */
export interface TimeEntry {
  id: string
  organization_id: string
  project_id: string
  task_id: string | null
  /** Membre connecté par défaut (trigger). */
  member_id: string
  started_at: string
  ended_at: string | null
  /** Calculée à l'arrêt ; pour une entrée manuelle, donner started_at + duration_minutes (la base pose ended_at). */
  duration_minutes: number | null
  note: string | null
  created_at: string
  updated_at: string
}

export const ABSENCE_KINDS = ['school', 'leave', 'other'] as const
export type AbsenceKind = (typeof ABSENCE_KINDS)[number]

export interface MemberAbsence {
  id: string
  /** Rempli par un trigger à partir du membre. */
  organization_id: string
  member_id: string
  /** AAAA-MM-JJ, bornes comprises. */
  start_date: string
  end_date: string
  kind: AbsenceKind
  note: string | null
  created_at: string
}

/**
 * Tranche d'un barème de commission : rate % (0 à 100) sur la part de l'encaissé jusqu'à up_to_cents.
 * Plafonds strictement croissants, la dernière tranche (et elle seule) a up_to_cents null.
 */
export interface CommissionTier {
  up_to_cents: number | null
  rate: number
}

/** Barème de commission d'un apporteur (saisi dans l'app, jamais en dur). */
export interface CommissionPlan {
  member_id: string
  /** Rempli par un trigger à partir du membre. */
  organization_id: string
  /** Barème cumulatif sur l'encaissé du premier devis signé. */
  tiers: CommissionTier[]
  /** % sur l'encaissé des devis suivants signés dans followup_window_months après le premier. */
  followup_rate: number
  /** Le client signe son premier devis dans ce délai (mois) après son enregistrement. */
  sign_window_months: number
  followup_window_months: number
  active: boolean
  created_at: string
  updated_at: string
}

/* ---------- Notifications, propositions de l'IA, relances (migration 0013) ---------- */

/** Types créés par les déclencheurs de la base (create_notification accepte d'autres types : [a-z0-9_.]). */
export const NOTIFICATION_KINDS = [
  'prospect.created',
  'prospect.offer_ready',
  'prospect.stage',
  'task.assigned',
  'input.ready',
  'file.ready',
  'file.auto_filed',
  'proposal.created',
  'deliverable.comment',
  'commission.created',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Notification in-app (table notifications). Nommée AppNotification pour ne pas masquer Notification du DOM. */
export interface AppNotification {
  id: string
  organization_id: string
  /** Destinataire. */
  member_id: string
  kind: string
  title: string
  body: string | null
  /** Route de l'app (« /prospects/<id> »…). */
  link: string | null
  payload: Record<string, unknown>
  dedupe_key: string | null
  /** Seule colonne modifiable par le destinataire. */
  read_at: string | null
  created_at: string
}

export const AI_PROPOSAL_KINDS = ['reassign_task', 'move_due_date', 'reorder', 'other'] as const
export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number]

export const AI_PROPOSAL_STATUSES = ['pending', 'accepted', 'refused', 'auto_applied', 'undone'] as const
export type AiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number]

/** Valeurs d'une tâche modifiables par une proposition (seules les clés présentes changent). */
export interface AiProposalTaskValues {
  assignee_member_id?: string | null
  due_date?: string | null
  priority?: TaskPriority
  position?: number
}

export interface AiProposalOperation {
  task_id: string
  before: AiProposalTaskValues
  after: AiProposalTaskValues
}

export interface AiProposalPayload {
  operations?: AiProposalOperation[]
  /** Membres à notifier (sinon les admins). */
  member_ids?: string[]
  /** Périmètre de la règle « Toujours » (sinon le projet de la proposition). */
  scope?: Record<string, unknown>
}

export interface AiProposal {
  id: string
  organization_id: string
  project_id: string | null
  kind: AiProposalKind
  title: string
  explanation: string | null
  payload: AiProposalPayload
  /** Changé seulement par apply_ai_proposal / refuse_ai_proposal / undo_ai_proposal (ou le serveur). */
  status: AiProposalStatus
  rule_id: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

/** Règle « Toujours » : les propositions de ce type et de ce périmètre s'appliquent seules. */
export interface AiAutonomyRule {
  id: string
  organization_id: string
  kind: AiProposalKind
  /** Ex. { project_id } ; {} = toute l'organisation. */
  scope: Record<string, unknown>
  created_by: string | null
  created_at: string
  revoked_at: string | null
}

export const FOLLOWUP_TARGET_TYPES = ['quote', 'invoice'] as const
export type FollowupTargetType = (typeof FOLLOWUP_TARGET_TYPES)[number]

export const FOLLOWUP_STATUSES = ['draft', 'sent', 'dismissed'] as const
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number]

/** Brouillon de relance d'un devis ou d'une facture (un seul brouillon par document). */
export interface Followup {
  id: string
  /** Rempli par un trigger à partir du document. */
  organization_id: string
  target_type: FollowupTargetType
  target_id: string
  draft: string
  status: FollowupStatus
  /** Posé par la base au passage à « envoyée ». */
  sent_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ---------- Commissions des apporteurs (migration 0014) ---------- */

export const COMMISSION_KINDS = ['first', 'followup'] as const
export type CommissionKind = (typeof COMMISSION_KINDS)[number]

export const COMMISSION_STATUSES = ['due', 'invoiced', 'paid', 'cancelled'] as const
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

/** Commission calculée par la base au paiement d'une facture (ou négative pour un avoir). */
export interface Commission {
  id: string
  organization_id: string
  /** Apporteur. */
  member_id: string
  prospect_id: string | null
  client_id: string
  quote_id: string | null
  invoice_id: string
  kind: CommissionKind
  /** Encaissé HT pris en compte (hors frais refacturés), négatif pour un avoir. Centimes. */
  base_cents: number
  amount_cents: number
  /** Modifiable par admin et finance (avec note). invoiced_at / paid_at suivent. */
  status: CommissionStatus
  /** Émetteur qui a encaissé (il paie la commission). */
  payer_issuer_id: string | null
  invoiced_at: string | null
  paid_at: string | null
  note: string | null
  created_at: string
  updated_at: string
}

/* ---------- Contrats, livrables, jetons MCP (migration 0015) ---------- */

export const CONTRACT_STATUSES = ['draft', 'sent', 'signed', 'cancelled'] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const CONTRACT_SIGNED_VIA = ['manual', 'portal', 'yousign'] as const
export type ContractSignedVia = (typeof CONTRACT_SIGNED_VIA)[number]

export interface Contract {
  id: string
  /** Rempli par un trigger à partir du client. */
  organization_id: string
  project_id: string | null
  client_id: string
  quote_id: string | null
  title: string
  /** Markdown. */
  body: string
  /** Signé = figé (seule l'annulation reste). Suppression des brouillons seulement. */
  status: ContractStatus
  /** Posés par la base au passage à envoyé / signé (signed_at fourni gardé : signature papier antérieure). */
  sent_at: string | null
  signed_at: string | null
  signed_by_name: string | null
  signed_via: ContractSignedVia | null
  file_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const DELIVERABLE_STATUSES = ['in_progress', 'in_review', 'approved', 'changes_requested'] as const
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number]

export const DELIVERABLE_VERSION_STATUSES = ['pending', 'approved', 'changes_requested'] as const
export type DeliverableVersionStatus = (typeof DELIVERABLE_VERSION_STATUSES)[number]

export interface Deliverable {
  id: string
  organization_id: string
  project_id: string
  title: string
  description: string | null
  /** Suit sa dernière version (nouvelle version → in_review, décision → approved / changes_requested). */
  status: DeliverableStatus
  position: number
  created_at: string
  updated_at: string
}

export interface DeliverableVersion {
  id: string
  /** Rempli par un trigger à partir du livrable. */
  organization_id: string
  deliverable_id: string
  /** Numéro attribué par la base. */
  version: number
  /** Fichier du projet du livrable. */
  file_id: string
  note: string | null
  status: DeliverableVersionStatus
  /** Posé par la base à la décision. */
  decided_at: string | null
  decided_by_name: string | null
  created_by: string | null
  created_at: string
}

export interface DeliverableComment {
  id: string
  organization_id: string
  version_id: string
  /** Épingle sur l'image, 0 à 1 (les deux null : commentaire général). */
  x: number | null
  y: number | null
  body: string
  /** Membre (membre connecté par défaut) ; null pour un commentaire du client. */
  author_member_id: string | null
  /** Nom du client (portail). */
  author_name: string | null
  from_client: boolean
  resolved_at: string | null
  created_at: string
}

/** Jeton personnel du serveur MCP (seule son empreinte est stockée). */
export interface ApiToken {
  id: string
  organization_id: string
  member_id: string
  name: string
  /** SHA-256 hexadécimal du jeton. */
  token_hash: string
  /** Premiers caractères du jeton, pour l'affichage. */
  prefix: string
  last_used_at: string | null
  created_at: string
  /** Un jeton révoqué le reste. */
  revoked_at: string | null
}

/* ---------- Réseau de partenaires et notes (migration 0020) ---------- */

/** Métier d'un partenaire (même liste que la contrainte de partners.category). */
export const PARTNER_CATEGORIES = [
  'freelance',
  'subcontractor',
  'developer',
  'designer',
  'photographer',
  'videographer',
  'copywriter',
  'printer',
  'referrer',
  'other',
] as const
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number]

/** Bornes des compétences (étiquettes) d'un partenaire, contrôlées par la base. */
export const PARTNER_SKILLS_MAX = 30
export const PARTNER_SKILL_MAX_LENGTH = 40
export const PARTNER_RATING_MIN = 1
export const PARTNER_RATING_MAX = 5

/** Partenaire du réseau. Lu par admin, membre, finance ; écrit par admin, membre. */
export interface Partner {
  id: string
  organization_id: string
  name: string
  company: string | null
  category: PartnerCategory
  /** Nettoyées par la base : sans espaces autour, sans vide ni doublon (casse ignorée). */
  skills: string[]
  /** Tarif jour indicatif HT, en centimes (pas un prix client). */
  day_rate_cents: number | null
  email: string | null
  phone: string | null
  /** http(s) seulement. */
  website: string | null
  city: string | null
  /** Note interne. */
  notes: string | null
  /** 1 à 5, facultative. */
  rating: number | null
  /** Texte court (« Dispo en janvier »). */
  availability: string | null
  archived_at: string | null
  /** Posé par la base. */
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Projet sur lequel un partenaire a travaillé. Partenaire et projet figés après création. */
export interface PartnerProject {
  id: string
  /** Rempli par un trigger à partir du partenaire. */
  organization_id: string
  partner_id: string
  project_id: string
  role: string | null
  /** Montant facturé par le partenaire sur ce projet, en centimes. */
  amount_cents: number | null
  created_at: string
  updated_at: string
}

/** « perso » : l'auteur seul ; « équipe » : admin, membre, finance de l'organisation. */
export const NOTE_VISIBILITIES = ['personal', 'team'] as const
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number]

export const NOTE_TITLE_MAX_LENGTH = 200
export const NOTE_BODY_MAX_LENGTH = 100_000

/** Note libre (Markdown léger), rattachable à un projet et / ou un client. */
export interface Note {
  id: string
  organization_id: string
  /** Membre connecté à la création, posé par la base. */
  author_id: string
  project_id: string | null
  client_id: string | null
  /** Peut être vide (« Sans titre » à l'affichage). */
  title: string
  body: string
  visibility: NoteVisibility
  pinned: boolean
  created_at: string
  /** Dernière modification du contenu : épingler ne la change pas. */
  updated_at: string
}

/** French labels for the UI. */
export const LABELS = {
  inputKind: { meeting: 'Réunion', written: 'Retour écrit' } satisfies Record<InputKind, string>,
  inputStatus: {
    uploaded: 'Envoyée',
    transcribing: 'Transcription…',
    analyzing: 'Analyse…',
    ready: 'Prête',
    error: 'Erreur',
  } satisfies Record<InputStatus, string>,
  ticketType: { bug: 'Bug', modification: 'Modification', new_request: 'Nouvelle demande' } satisfies Record<
    TicketType,
    string
  >,
  ticketPriority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' } satisfies Record<TicketPriority, string>,
  ticketStatus: { proposed: 'Proposé', validated: 'Validé', rejected: 'Refusé', done: 'Terminé' } satisfies Record<
    TicketStatus,
    string
  >,
  taskStatus: { todo: 'À faire', in_progress: 'En cours', review: 'En relecture', done: 'Fait' } satisfies Record<
    TaskStatus,
    string
  >,
  skill: { design: 'Design', dev: 'Dev' } satisfies Record<Skill, string>,
  projectStatus: {
    prospect: 'Prospect',
    quote_sent: 'Devis envoyé',
    in_progress: 'En cours',
    delivered: 'Livré',
    paid: 'Payé',
    archived: 'Archivé',
  } satisfies Record<ProjectStatus, string>,
  memberRole: { admin: 'Admin', membre: 'Membre', prospection: 'Prospection', finance: 'Finance' } satisfies Record<
    MemberRole,
    string
  >,
  quoteStatus: { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé' } satisfies Record<
    QuoteStatus,
    string
  >,
  invoiceKind: { invoice: 'Facture', deposit: 'Acompte', credit_note: 'Avoir' } satisfies Record<InvoiceKind, string>,
  invoiceStatus: { draft: 'Brouillon', issued: 'Émise', paid: 'Payée', cancelled: 'Annulée' } satisfies Record<
    InvoiceStatus,
    string
  >,
  lineUnit: { day: 'jour', hour: 'heure', flat: 'forfait', unit: 'unité' } satisfies Record<LineUnit, string>,
  prospectStage: {
    to_audit: 'À auditer',
    offer_ready: 'Offre prête',
    to_contact: 'À contacter',
    contacted: 'Contacté',
    followed_up: 'Relancé',
    meeting: 'Rendez-vous',
    won: 'Gagné',
    lost: 'Perdu',
  } satisfies Record<ProspectStage, string>,
  taskPriority: { low: 'Basse', medium: 'Moyenne', high: 'Haute' } satisfies Record<TaskPriority, string>,
  prospectAuditStatus: { none: 'Pas d\'audit', running: 'Audit en cours', done: 'Audit fait', error: 'Audit en échec' } satisfies Record<
    ProspectAuditStatus,
    string
  >,
  projectShowcase: { unknown: 'À définir', showable: 'Montrable', nda: 'Sous NDA' } satisfies Record<ProjectShowcase, string>,
  fileKind: {
    quote: 'Devis',
    invoice: 'Facture',
    contract: 'Contrat',
    brief: 'Brief',
    mockup: 'Maquette',
    feedback: 'Retour',
    deliverable: 'Livrable',
    asset: 'Ressource',
    other: 'Autre',
  } satisfies Record<FileKind, string>,
  fileIntakeStatus: {
    uploaded: 'Envoyé',
    classifying: 'Analyse…',
    ready: 'À ranger',
    filed: 'Rangé',
    cancelled: 'Annulé',
    error: 'Erreur',
  } satisfies Record<FileIntakeStatus, string>,
  absenceKind: { school: 'École', leave: 'Congé', other: 'Autre' } satisfies Record<AbsenceKind, string>,
  aiProposalKind: {
    reassign_task: 'Réattribution',
    move_due_date: 'Échéance déplacée',
    reorder: 'Réorganisation',
    other: 'Autre',
  } satisfies Record<AiProposalKind, string>,
  aiProposalStatus: {
    pending: 'À valider',
    accepted: 'Validée',
    refused: 'Refusée',
    auto_applied: 'Appliquée automatiquement',
    undone: 'Annulée',
  } satisfies Record<AiProposalStatus, string>,
  followupStatus: { draft: 'Brouillon', sent: 'Envoyée', dismissed: 'Ignorée' } satisfies Record<FollowupStatus, string>,
  commissionKind: { first: 'Premier devis', followup: 'Devis suivant' } satisfies Record<CommissionKind, string>,
  commissionStatus: { due: 'Due', invoiced: 'Facturée', paid: 'Payée', cancelled: 'Annulée' } satisfies Record<
    CommissionStatus,
    string
  >,
  contractStatus: { draft: 'Brouillon', sent: 'Envoyé', signed: 'Signé', cancelled: 'Annulé' } satisfies Record<
    ContractStatus,
    string
  >,
  deliverableStatus: {
    in_progress: 'En cours',
    in_review: 'En relecture client',
    approved: 'Validé',
    changes_requested: 'Modifications demandées',
  } satisfies Record<DeliverableStatus, string>,
  deliverableVersionStatus: {
    pending: 'En attente',
    approved: 'Validée',
    changes_requested: 'Modifications demandées',
  } satisfies Record<DeliverableVersionStatus, string>,
  partnerCategory: {
    freelance: 'Freelance',
    subcontractor: 'Sous-traitant',
    developer: 'Développeur',
    designer: 'Designer',
    photographer: 'Photographe',
    videographer: 'Vidéaste',
    copywriter: 'Rédacteur',
    printer: 'Imprimeur',
    referrer: 'Apporteur',
    other: 'Autre',
  } satisfies Record<PartnerCategory, string>,
  noteVisibility: { personal: 'Perso', team: 'Équipe' } satisfies Record<NoteVisibility, string>,
  weekday: {
    1: 'Lundi',
    2: 'Mardi',
    3: 'Mercredi',
    4: 'Jeudi',
    5: 'Vendredi',
    6: 'Samedi',
    7: 'Dimanche',
  } satisfies Record<Weekday, string>,
} as const
