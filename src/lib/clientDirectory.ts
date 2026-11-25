/**
 * Annuaire des clients pour les connecteurs Google de l'île : emails des contacts et projets de chaque client.
 * Sert à reconnaître un client d'après les participants d'un événement d'agenda (présélection du projet) et
 * l'expéditeur d'un mail (Gmail). Lecture par la RLS de l'organisation : un rôle sans accès aux clients
 * (prospection) obtient une liste vide. Fonctions de tri pures, testées dans clientDirectory.test.ts.
 */
import type { ProjectStatus } from '../shared/types'
import { supabase } from './supabase'

export interface DirectoryProject {
  id: string
  name: string
  status: ProjectStatus
  createdAt: string
}

export interface ClientDirectoryEntry {
  clientId: string
  clientName: string
  /** Emails des contacts, en minuscules, sans doublon. */
  emails: string[]
  projects: DirectoryProject[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Email comparable : espaces retirés, minuscules ; null si ce n'est pas une adresse. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null
}

/** Ligne brute (clients + client_contacts + projects) → entrée, ou null si inutilisable. Clients archivés exclus. */
export function normalizeDirectoryEntry(raw: unknown): ClientDirectoryEntry | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  if (raw.archived_at) return null
  const contacts = Array.isArray(raw.client_contacts) ? raw.client_contacts : []
  const emails = [...new Set(contacts.map((c) => normalizeEmail(isObject(c) ? c.email : null)).filter((e): e is string => !!e))]
  const projects = (Array.isArray(raw.projects) ? raw.projects : []).flatMap((p): DirectoryProject[] =>
    isObject(p) && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.status === 'string'
      ? [{ id: p.id, name: p.name, status: p.status as ProjectStatus, createdAt: typeof p.created_at === 'string' ? p.created_at : '' }]
      : [],
  )
  return { clientId: raw.id, clientName: raw.name, emails, projects }
}

/** Projet actif du client : le plus récent « en cours » (in_progress) ; null s'il n'en a pas. */
export function activeProjectOf(entry: Pick<ClientDirectoryEntry, 'projects'>): DirectoryProject | null {
  const running = entry.projects.filter((p) => p.status === 'in_progress')
  running.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return running[0] ?? null
}

/** Client dont un contact a cet email (comparaison sans casse) ; null : aucun. */
export function clientByEmail(directory: readonly ClientDirectoryEntry[], email: string): ClientDirectoryEntry | null {
  const wanted = normalizeEmail(email)
  if (!wanted) return null
  return directory.find((entry) => entry.emails.includes(wanted)) ?? null
}

/** Clients, contacts et projets visibles par le compte connecté. */
export async function loadClientDirectory(): Promise<ClientDirectoryEntry[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, archived_at, client_contacts(email), projects(id, name, status, created_at)')
  if (error) throw new Error('Impossible de lire les clients.')
  return (data ?? []).map(normalizeDirectoryEntry).filter((e): e is ClientDirectoryEntry => e !== null)
}
