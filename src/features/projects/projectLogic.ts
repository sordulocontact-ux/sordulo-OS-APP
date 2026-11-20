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

/** Jours calendaires (heure locale) de `now` à `day` (AAAA-MM-JJ) : positif = à venir, négatif = passé. */
export function daysUntil(day: string | null, now: Date): number | null {
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return null
  // Date.UTC évite les décalages d'heure d'été : on compare des jours entiers.
  const target = Date.UTC(y, m - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86_400_000)
}

export interface RelativeDue {
  text: string
  overdue: boolean
}

/** Statuts pour lesquels une échéance n'a plus d'enjeu : pas de ligne relative. */
const NO_DUE_HINT: readonly ProjectStatus[] = ['delivered', 'paid', 'archived']

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n > 1 ? 's' : ''}`
}

/** « aujourd'hui », « demain », « dans 12 jours », « en retard de 3 jours » ; null si pas d'échéance ou projet terminé. */
export function relativeDue(project: Pick<Project, 'status' | 'due_date'>, now: Date): RelativeDue | null {
  if (NO_DUE_HINT.includes(project.status)) return null
  const days = daysUntil(project.due_date, now)
  if (days === null) return null
  if (days === 0) return { text: "aujourd'hui", overdue: false }
  if (days === 1) return { text: 'demain', overdue: false }
  if (days > 1) return { text: `dans ${plural(days, 'jour')}`, overdue: false }
  return { text: `en retard de ${plural(-days, 'jour')}`, overdue: true }
}

export interface ProjectStats {
  inProgress: number
  /** Projets en cours dont l'échéance est passée. */
  overdue: number
  quoteSent: number
  delivered: number
  paid: number
}

export function projectStats(projects: readonly Pick<Project, 'status' | 'due_date'>[], now: Date): ProjectStats {
  const stats: ProjectStats = { inProgress: 0, overdue: 0, quoteSent: 0, delivered: 0, paid: 0 }
  for (const p of projects) {
    if (p.status === 'in_progress') {
      stats.inProgress += 1
      if ((daysUntil(p.due_date, now) ?? 0) < 0) stats.overdue += 1
    } else if (p.status === 'quote_sent') stats.quoteSent += 1
    else if (p.status === 'delivered') stats.delivered += 1
    else if (p.status === 'paid') stats.paid += 1
  }
  return stats
}

/** Sous-texte de la carte « En cours ». */
export function overdueHint(overdue: number): string {
  return overdue === 0 ? 'Aucun en retard' : `${overdue} en retard`
}
