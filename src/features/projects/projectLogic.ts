import { PROJECT_STATUSES, type Client, type Project, type ProjectStatus } from '../../shared/types'
import type { ProjectWithClient } from './types'

/** Valeur du filtre Statut : '' = tous les statuts actifs (tout sauf archivé), sinon un statut. */
export type StatusFilter = '' | ProjectStatus
/** Valeur du filtre Client : '' = tous, NO_CLIENT = sans client, sinon l'id du client. */
export const NO_CLIENT = 'none'

export interface ProjectFilters {
  query: string
  status: StatusFilter
  client: string
}

export function parseStatusParam(raw: string | null): StatusFilter {
  return (PROJECT_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as ProjectStatus) : ''
}

export function filterProjects(projects: ProjectWithClient[], { query, status, client }: ProjectFilters): ProjectWithClient[] {
  const q = query.trim().toLowerCase()
  return projects.filter((p) => {
    if (status === '' ? p.status === 'archived' : p.status !== status) return false
    if (client === NO_CLIENT ? p.client_id !== null : client !== '' && p.client_id !== client) return false
    if (!q) return true
    return p.name.toLowerCase().includes(q) || (p.client?.name ?? '').toLowerCase().includes(q)
  })
}

/** Clients présents dans les projets, triés par nom. */
export function clientsInProjects(projects: ProjectWithClient[]): Pick<Client, 'id' | 'name'>[] {
  const byId = new Map<string, Pick<Client, 'id' | 'name'>>()
  for (const p of projects) if (p.client) byId.set(p.client.id, { id: p.client.id, name: p.client.name })
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Erreur à afficher sur l'échéance si elle précède le début (dates AAAA-MM-JJ, comparables en texte). */
export function validateDates(start: string, due: string): string | null {
  if (start && due && due < start) return "L'échéance ne peut pas être avant la date de début."
  return null
}

export function diffMembers(current: string[], next: string[]): { toAdd: string[]; toRemove: string[] } {
  const cur = new Set(current)
  const nxt = new Set(next)
  return { toAdd: next.filter((id) => !cur.has(id)), toRemove: current.filter((id) => !nxt.has(id)) }
}

/** Date AAAA-MM-JJ en français, lue en heure locale (pas de décalage de fuseau). */
export function formatDay(day: string | null): string | null {
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d))
}

export const TONE_TEMPLATES = [
  { label: 'Formel', text: 'Vouvoiement, phrases complètes, vocabulaire professionnel, pas d\'emoji.' },
  { label: 'Chaleureux', text: 'Tutoiement, ton bienveillant et proche, phrases simples, un emoji de temps en temps.' },
  { label: 'Direct', text: 'Phrases courtes, droit au but, pas de formules de politesse superflues, pas d\'emoji.' },
  { label: 'Créatif', text: 'Ton vivant et imagé, tournures originales, vocabulaire de la marque, humour léger bienvenu.' },
] as const

export type ProjectInput = Pick<Project, 'client_id' | 'name' | 'status' | 'start_date' | 'due_date' | 'tone_of_voice'>
