import briefcaseIcon from '../../assets/icons/briefcase.svg'
import fileTextIcon from '../../assets/icons/file-text.svg'
import layersIcon from '../../assets/icons/layers.svg'
import receiptIcon from '../../assets/icons/receipt.svg'
import targetIcon from '../../assets/icons/target.svg'
import usersIcon from '../../assets/icons/users.svg'
import { supabase } from '../../lib/supabase'
import { CLIENT_READ_ROLES, FINANCE_ROLES, PROJECT_ROLES, PROSPECT_ROLES } from '../auth/roles'
import { containsPattern, GROUP_LIMIT, orIlike } from './searchLogic'
import { registerSearchSource } from './registry'
import type { SearchContext, SearchResult, SearchSource } from './types'

/** Réponse Supabase réduite à ce dont une source a besoin. */
interface QueryOutcome<Row> {
  data: Row[] | null
  error: { message: string } | null
}

function unwrap<Row>({ data, error }: QueryOutcome<Row>, ctx: SearchContext): Row[] {
  // Saisie changée entre-temps : la requête est abandonnée, ce n'est pas une erreur.
  if (ctx.signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
  if (error) throw new Error(error.message)
  return data ?? []
}

function joinSubtitle(...parts: (string | null | undefined)[]): string | undefined {
  const text = parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ')
  return text === '' ? undefined : text
}

const clients: SearchSource = {
  id: 'clients',
  label: 'Clients',
  roles: CLIENT_READ_ROLES,
  order: 10,
  async search(query, ctx) {
    const outcome = await supabase
      .from('clients')
      .select('id, name, website, billing_city')
      .is('archived_at', null)
      .or(orIlike(['name', 'website', 'billing_city'], query))
      .order('name')
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; name: string; website: string | null; billing_city: string | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.name,
      subtitle: joinSubtitle(row.billing_city, row.website),
      to: `/clients/${row.id}`,
      icon: usersIcon,
    }))
  },
}

const projects: SearchSource = {
  id: 'projects',
  label: 'Projets',
  roles: CLIENT_READ_ROLES,
  order: 20,
  async search(query, ctx) {
    const outcome = await supabase
      .from('projects')
      .select('id, name, client:clients(name)')
      .ilike('name', containsPattern(query))
      .order('name')
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; name: string; client: { name: string } | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.client?.name,
      to: `/projects/${row.id}`,
      icon: briefcaseIcon,
    }))
  },
}

const quotes: SearchSource = {
  id: 'quotes',
  label: 'Devis',
  roles: FINANCE_ROLES,
  order: 30,
  async search(query, ctx) {
    const outcome = await supabase
      .from('quotes')
      .select('id, number, title, client:clients(name)')
      .or(orIlike(['number', 'title'], query))
      .order('issue_date', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; number: string; title: string; client: { name: string } | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.title || row.number,
      subtitle: joinSubtitle(row.number, row.client?.name),
      to: `/quotes/${row.id}`,
      icon: fileTextIcon,
    }))
  },
}

const invoices: SearchSource = {
  id: 'invoices',
  label: 'Factures',
  roles: FINANCE_ROLES,
  order: 40,
  async search(query, ctx) {
    const outcome = await supabase
      .from('invoices')
      .select('id, number, title, client:clients(name)')
      .or(orIlike(['number', 'title'], query))
      .order('created_at', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; number: string | null; title: string; client: { name: string } | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.title || row.number || 'Brouillon',
      subtitle: joinSubtitle(row.number ?? 'Brouillon', row.client?.name),
      to: `/invoices/${row.id}`,
      icon: receiptIcon,
    }))
  },
}

const prospects: SearchSource = {
  id: 'prospects',
  label: 'Prospects',
  roles: PROSPECT_ROLES,
  order: 50,
  async search(query, ctx) {
    const outcome = await supabase
      .from('prospects')
      .select('id, company, website, contact_name')
      .or(orIlike(['company', 'website'], query))
      .order('company')
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; company: string; website: string | null; contact_name: string | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.company,
      subtitle: joinSubtitle(row.contact_name, row.website),
      to: `/prospects/${row.id}`,
      icon: targetIcon,
    }))
  },
}

const tasks: SearchSource = {
  id: 'tasks',
  label: 'Tâches',
  roles: PROJECT_ROLES,
  order: 60,
  async search(query, ctx) {
    const outcome = await supabase
      .from('tasks')
      .select('id, title, project_id, project:projects(name)')
      .ilike('title', containsPattern(query))
      .order('created_at', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<{ id: string; title: string; project_id: string; project: { name: string } | null }[], { merge: false }>()
    return unwrap(outcome, ctx).map<SearchResult>((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.project?.name,
      to: `/projects/${row.project_id}/tasks`,
      icon: layersIcon,
    }))
  },
}

/** Sources initiales. D'autres lots en ajoutent avec `registerSearchSource`. */
export const BUILT_IN_SOURCES: readonly SearchSource[] = [clients, projects, quotes, invoices, prospects, tasks]

let installed = false

/** Enregistre les sources initiales (une seule fois, appelé à l'import de la palette). */
export function installBuiltInSources(): void {
  if (installed) return
  installed = true
  BUILT_IN_SOURCES.forEach((source) => registerSearchSource(source))
}
