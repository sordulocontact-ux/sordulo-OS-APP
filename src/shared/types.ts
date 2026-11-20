/**
 * Data contract shared by the front (src/) and the serverless functions (api/).
 * Mirrors supabase/migrations exactly: any column change goes here too.
 * Relative imports in src/shared and api/ use the ".js" extension (Node ESM on Vercel).
 */

export const MEMBER_ROLES = ['admin', 'membre', 'prospection'] as const
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

/** Niveaux de compétence, ex. { "design": 5, "dev": 2 } : 1 à 5 saisis dans l'Équipe, 0 ou absent = ne pratique pas. */
export type SkillLevels = Partial<Record<Skill, number>>

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
  created_at: string
  updated_at: string
}

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
  status: TaskStatus
  depends_on_task_id: string | null
  position: number
  created_at: string
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
  memberRole: { admin: 'Admin', membre: 'Membre', prospection: 'Prospection' } satisfies Record<MemberRole, string>,
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
