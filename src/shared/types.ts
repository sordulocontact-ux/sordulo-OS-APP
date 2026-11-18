/**
 * Data contract shared by the front (src/) and the serverless functions (api/).
 * Mirrors supabase/migrations exactly: any column change goes here too.
 * Relative imports in src/shared and api/ use the ".js" extension (Node ESM on Vercel).
 */

export const MEMBER_ROLES = ['admin', 'membre', 'prospection'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

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

/** Skill levels, e.g. { "design": 5, "dev": 2 } (0–5). Missing skill = 0. */
export type SkillLevels = Partial<Record<Skill, number>>

export interface Organization {
  id: string
  name: string
  created_at: string
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
  created_at: string
}

export interface Client {
  id: string
  organization_id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  created_at: string
}

export interface Project {
  id: string
  organization_id: string
  client_id: string | null
  name: string
  status: string
  tone_of_voice: string | null
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
} as const
