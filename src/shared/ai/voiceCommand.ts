/**
 * Action IA « voiceCommand » (POST /api/ai/run, action voiceCommand) : une commande dite au micro de la palette
 * Cmd+K, déjà transcrite, devient une action proposée. Le serveur ne fait jamais d'écriture : créer la tâche se
 * fait par le front, sous RLS, après confirmation.
 */
import { z } from 'zod'
import { SKILLS, TASK_PRIORITIES, type MemberRole, type Skill, type TaskPriority } from '../types.js'

export const VOICE_COMMAND_TEXT_MAX = 1000
export const VOICE_COMMAND_PATH_MAX = 300

export interface VoiceCommandRequest {
  /** Texte transcrit : une donnée, jamais une consigne pour l'IA. */
  text: string
  /** Page affichée (ex. /projects/<id>/tasks), pour comprendre « ce projet ». */
  path?: string
}

const ALL: readonly MemberRole[] = ['admin', 'membre', 'prospection', 'finance']
const PROJECT: readonly MemberRole[] = ['admin', 'membre']
const CLIENT_READ: readonly MemberRole[] = ['admin', 'membre', 'finance']
const FINANCE: readonly MemberRole[] = ['admin', 'finance']
const PROSPECT: readonly MemberRole[] = ['admin', 'membre', 'prospection']
const ADMIN: readonly MemberRole[] = ['admin']

/** Pages où une commande peut mener, avec les rôles qui les voient (mêmes droits que src/app/routes.tsx). */
export const VOICE_PAGES = {
  home: { path: '/', label: 'Accueil', roles: ALL },
  my_tasks: { path: '/my-tasks', label: 'Mes tâches', roles: PROJECT },
  projects: { path: '/projects', label: 'Projets', roles: CLIENT_READ },
  clients: { path: '/clients', label: 'Clients', roles: CLIENT_READ },
  calls: { path: '/calls', label: 'Appels', roles: PROJECT },
  prospects: { path: '/prospects', label: 'Prospection', roles: PROSPECT },
  quotes: { path: '/quotes', label: 'Devis', roles: FINANCE },
  invoices: { path: '/invoices', label: 'Factures', roles: FINANCE },
  team: { path: '/team', label: 'Équipe', roles: ADMIN },
  connectors: { path: '/connectors', label: 'Connecteurs', roles: ADMIN },
  settings: { path: '/settings', label: 'Paramètres', roles: ADMIN },
} as const satisfies Record<string, { path: string; label: string; roles: readonly MemberRole[] }>

export type VoicePage = keyof typeof VOICE_PAGES
export const VOICE_PAGE_KEYS = Object.keys(VOICE_PAGES) as [VoicePage, ...VoicePage[]]

export function pagesForRole(role: MemberRole): VoicePage[] {
  return VOICE_PAGE_KEYS.filter((key) => (VOICE_PAGES[key].roles as readonly MemberRole[]).includes(role))
}

/** Rôles qui voient la page d'un projet, d'un client, d'un prospect. */
export const VOICE_OBJECT_ROLES = { project: PROJECT, client: CLIENT_READ, prospect: PROSPECT } as const

/** Tâche proposée, ids résolus vers des objets existants. */
export interface VoiceTaskDraft {
  projectId: string
  projectName: string
  title: string
  skill: Skill
  estimateHours: number | null
  /** AAAA-MM-JJ */
  dueDate: string | null
  priority: TaskPriority
  assigneeMemberId: string | null
  assigneeName: string | null
}

export type VoiceCommandResponse =
  | { intent: 'create_task'; transcript: string; confirmation: string; task: VoiceTaskDraft }
  | { intent: 'navigate'; transcript: string; confirmation: string; path: string; label: string }
  | { intent: 'answer'; transcript: string; answer: string }
  | { intent: 'unknown'; transcript: string; answer: string }

export type VoiceIntent = VoiceCommandResponse['intent']

/** Sortie structurée de Claude (types et énumérations seulement, compatibles avec l'API). */
export const VoiceCommandOutputSchema = z.object({
  intent: z.enum(['create_task', 'navigate', 'answer', 'unknown']),
  task: z
    .object({
      project_id: z.string().nullable(),
      title: z.string(),
      skill: z.enum(SKILLS),
      estimate_hours: z.number().nullable(),
      due_date: z.string().nullable(),
      priority: z.enum(TASK_PRIORITIES),
      assignee_member_id: z.string().nullable(),
    })
    .nullable(),
  navigate: z
    .object({
      page: z.enum(VOICE_PAGE_KEYS).nullable(),
      project_id: z.string().nullable(),
      client_id: z.string().nullable(),
      prospect_id: z.string().nullable(),
    })
    .nullable(),
  answer: z.string().nullable(),
})

export type VoiceCommandOutput = z.infer<typeof VoiceCommandOutputSchema>

/** Question de confirmation d'une tâche proposée. */
export function taskConfirmation(title: string, projectName: string): string {
  return `Créer la tâche « ${title} » sur ${projectName} ?`
}
