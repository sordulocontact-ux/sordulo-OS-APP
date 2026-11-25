/** Outils MCP de lecture : recherche, projets, tâches, prospects, chiffres. */
import { z } from 'zod'
import {
  LABELS,
  PROJECT_STATUSES,
  PROSPECT_STAGES,
  TASK_PRIORITIES,
  type Client,
  type Invoice,
  type Member,
  type Project,
  type Prospect,
  type Quote,
  type Task,
  type Ticket,
} from '../../../../src/shared/types.js'
import { ACCESS, can, matchesQuery, ownsProspect, seesAllProspects } from '../access.js'
import { financeLines, financeSummary, formatEuros, type FinanceInvoice } from '../finance.js'
import { McpToolError, SCAN_LIMIT, defineTool, rowOf, rowsOf, type McpToolContext } from './types.js'

type ClientRow = Pick<Client, 'id' | 'name' | 'website' | 'archived_at'>
type ProjectRow = Pick<Project, 'id' | 'name' | 'status' | 'client_id' | 'start_date' | 'due_date'>
type QuoteRow = Pick<Quote, 'id' | 'number' | 'title' | 'status' | 'client_id' | 'project_id' | 'total_ttc_cents' | 'issue_date'>
type InvoiceRow = Pick<Invoice, 'id' | 'number' | 'title' | 'kind' | 'status' | 'client_id' | 'project_id' | 'total_ttc_cents' | 'due_date'>
type TaskRow = Pick<Task, 'id' | 'title' | 'status' | 'skill' | 'priority' | 'due_date' | 'estimate_hours' | 'assignee_member_id' | 'project_id'>
type TicketRow = Pick<Ticket, 'id' | 'title' | 'type' | 'priority' | 'status' | 'area'>
type ProspectRow = Pick<
  Prospect,
  'id' | 'company' | 'contact_name' | 'contact_email' | 'stage' | 'next_action_date' | 'owner_member_id' | 'created_by' | 'do_not_contact' | 'website'
>
type MemberRow = Pick<Member, 'id' | 'name' | 'role' | 'removed_at'>

const PRIORITY_RANK: Record<(typeof TASK_PRIORITIES)[number], number> = { high: 0, medium: 1, low: 2 }

async function orgRows<T>(ctx: McpToolContext, table: string, columns: string, what: string): Promise<T[]> {
  return rowsOf<T>(
    ctx.admin
      .from(table)
      .select(columns)
      .eq('organization_id', ctx.member.organization_id)
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT),
    what,
  )
}

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> => new Map(rows.map((row) => [row.id, row]))

export async function memberNames(ctx: McpToolContext): Promise<Map<string, MemberRow>> {
  return byId(await orgRows<MemberRow>(ctx, 'members', 'id, name, role, removed_at', 'des membres'))
}

async function visibleProspects(ctx: McpToolContext): Promise<ProspectRow[]> {
  const rows = await orgRows<ProspectRow>(
    ctx,
    'prospects',
    'id, company, contact_name, contact_email, stage, next_action_date, owner_member_id, created_by, do_not_contact, website',
    'des prospects',
  )
  return seesAllProspects(ctx.member.role) ? rows : rows.filter((p) => ownsProspect(ctx.member.id, p))
}

function taskView(task: TaskRow, members: Map<string, MemberRow>, projects?: Map<string, ProjectRow>) {
  const assignee = task.assignee_member_id ? members.get(task.assignee_member_id) : undefined
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    skill: task.skill,
    priority: task.priority,
    due_date: task.due_date,
    estimate_hours: task.estimate_hours,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    ...(projects ? { project: { id: task.project_id, name: projects.get(task.project_id)?.name ?? null } } : {}),
  }
}

function taskLine(task: ReturnType<typeof taskView>): string {
  const parts = [LABELS.taskStatus[task.status], LABELS.skill[task.skill], `priorité ${LABELS.taskPriority[task.priority].toLowerCase()}`]
  if (task.due_date) parts.push(`échéance ${task.due_date}`)
  if (task.assignee) parts.push(task.assignee.name)
  if (task.project?.name) parts.push(task.project.name)
  return `- ${task.title} (${parts.join(', ')}) [id ${task.id}]`
}

/** Échéance la plus proche d'abord (sans échéance à la fin), puis priorité haute d'abord. */
export function compareTasks(a: Pick<Task, 'due_date' | 'priority'>, b: Pick<Task, 'due_date' | 'priority'>): number {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date < b.due_date ? -1 : 1
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}

/* ---------- search ---------- */

export const searchTool = defineTool({
  name: 'search',
  title: 'Rechercher dans Sordulo OS',
  description:
    'Recherche par mots (sans accents ni casse) dans les clients, projets, devis, factures, tâches et prospects que ton rôle permet de voir. Renvoie les identifiants à réutiliser avec les autres outils.',
  schema: z.object({
    query: z.string().trim().min(2, 'Au moins 2 caractères.').max(100).describe('Mots à chercher : nom de client, de projet, numéro de devis…'),
    limit: z.number().int().min(1).max(20).optional().describe('Résultats par catégorie (5 par défaut).'),
  }),
  roles: ['admin', 'membre', 'finance', 'prospection'],
  readOnly: true,
  async run(ctx, { query, limit = 5 }) {
    const role = ctx.member.role
    const results: Record<string, unknown[]> = {}
    const lines: string[] = []
    const add = (key: string, label: string, items: { line: string; data: unknown }[]) => {
      results[key] = items.map((item) => item.data)
      if (items.length > 0) lines.push(`${label} :`, ...items.map((item) => item.line))
    }

    const clients = can(role, 'clients') ? await orgRows<ClientRow>(ctx, 'clients', 'id, name, website, archived_at', 'des clients') : []
    const clientById = byId(clients)
    const clientName = (id: string | null) => (id ? (clientById.get(id)?.name ?? null) : null)

    if (can(role, 'clients')) {
      add(
        'clients',
        'Clients',
        clients
          .filter((c) => matchesQuery(query, c.name, c.website))
          .slice(0, limit)
          .map((c) => ({
            line: `- ${c.name}${c.archived_at ? ' (archivé)' : ''} [id ${c.id}]`,
            data: { id: c.id, name: c.name, archived: c.archived_at !== null },
          })),
      )
    }
    let projectById = new Map<string, ProjectRow>()
    if (can(role, 'projects')) {
      const projects = await orgRows<ProjectRow>(ctx, 'projects', 'id, name, status, client_id, start_date, due_date', 'des projets')
      projectById = byId(projects)
      add(
        'projects',
        'Projets',
        projects
          .filter((p) => matchesQuery(query, p.name, clientName(p.client_id)))
          .slice(0, limit)
          .map((p) => ({
            line: `- ${p.name}${clientName(p.client_id) ? ` (${clientName(p.client_id)})` : ''}, ${LABELS.projectStatus[p.status]} [id ${p.id}]`,
            data: { id: p.id, name: p.name, status: p.status, client: clientName(p.client_id) },
          })),
      )
    }
    if (can(role, 'billing')) {
      const quotes = await orgRows<QuoteRow>(ctx, 'quotes', 'id, number, title, status, client_id, project_id, total_ttc_cents, issue_date', 'des devis')
      add(
        'quotes',
        'Devis',
        quotes
          .filter((q) => matchesQuery(query, q.number, q.title, clientName(q.client_id)))
          .slice(0, limit)
          .map((q) => ({
            line: `- Devis ${q.number} « ${q.title} » (${clientName(q.client_id) ?? 'client inconnu'}), ${LABELS.quoteStatus[q.status]}, ${formatEuros(q.total_ttc_cents)} TTC [id ${q.id}]`,
            data: { id: q.id, number: q.number, title: q.title, status: q.status, client: clientName(q.client_id), total_ttc_cents: q.total_ttc_cents },
          })),
      )
      const invoices = await orgRows<InvoiceRow>(
        ctx,
        'invoices',
        'id, number, title, kind, status, client_id, project_id, total_ttc_cents, due_date',
        'des factures',
      )
      add(
        'invoices',
        'Factures',
        invoices
          .filter((i) => matchesQuery(query, i.number, i.title, clientName(i.client_id)))
          .slice(0, limit)
          .map((i) => ({
            line: `- ${LABELS.invoiceKind[i.kind]} ${i.number ?? '(brouillon)'} « ${i.title} » (${clientName(i.client_id) ?? 'client inconnu'}), ${LABELS.invoiceStatus[i.status]}, ${formatEuros(i.total_ttc_cents)} TTC [id ${i.id}]`,
            data: { id: i.id, number: i.number, title: i.title, kind: i.kind, status: i.status, client: clientName(i.client_id), total_ttc_cents: i.total_ttc_cents },
          })),
      )
    }
    if (can(role, 'work')) {
      const tasks = await orgRows<TaskRow>(
        ctx,
        'tasks',
        'id, title, status, skill, priority, due_date, estimate_hours, assignee_member_id, project_id',
        'des tâches',
      )
      const members = await memberNames(ctx)
      add(
        'tasks',
        'Tâches',
        tasks
          .filter((t) => matchesQuery(query, t.title, projectById.get(t.project_id)?.name))
          .slice(0, limit)
          .map((t) => {
            const view = taskView(t, members, projectById)
            return { line: taskLine(view), data: view }
          }),
      )
    }
    if (can(role, 'prospects')) {
      const prospects = await visibleProspects(ctx)
      add(
        'prospects',
        'Prospects',
        prospects
          .filter((p) => matchesQuery(query, p.company, p.contact_name, p.contact_email, p.website))
          .slice(0, limit)
          .map((p) => ({
            line: `- ${p.company}, ${LABELS.prospectStage[p.stage]}${p.do_not_contact ? ', ne plus contacter' : ''} [id ${p.id}]`,
            data: { id: p.id, company: p.company, stage: p.stage, do_not_contact: p.do_not_contact },
          })),
      )
    }

    const text = lines.length > 0 ? [`Résultats pour « ${query} » :`, ...lines].join('\n') : `Aucun résultat pour « ${query} ».`
    return { text, structured: { query, results } }
  },
})

/* ---------- list_projects ---------- */

export const listProjectsTool = defineTool({
  name: 'list_projects',
  title: 'Lister les projets',
  description: 'Liste les projets de l’organisation (hors archivés par défaut), avec leur client et leur statut.',
  schema: z.object({
    status: z.enum(PROJECT_STATUSES).optional().describe('Filtrer sur un statut.'),
    client_id: z.uuid().optional().describe('Filtrer sur un client.'),
    include_archived: z.boolean().optional().describe('Inclure les projets archivés.'),
  }),
  roles: ACCESS.projects,
  readOnly: true,
  async run(ctx, { status, client_id, include_archived = false }) {
    const [projects, clients] = await Promise.all([
      orgRows<ProjectRow>(ctx, 'projects', 'id, name, status, client_id, start_date, due_date', 'des projets'),
      orgRows<ClientRow>(ctx, 'clients', 'id, name, website, archived_at', 'des clients'),
    ])
    const clientById = byId(clients)
    const list = projects
      .filter((p) => (status ? p.status === status : include_archived || p.status !== 'archived'))
      .filter((p) => !client_id || p.client_id === client_id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        client: p.client_id ? { id: p.client_id, name: clientById.get(p.client_id)?.name ?? null } : null,
        start_date: p.start_date,
        due_date: p.due_date,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    const text =
      list.length === 0
        ? 'Aucun projet.'
        : [
            `${list.length} projet${list.length > 1 ? 's' : ''} :`,
            ...list.map(
              (p) =>
                `- ${p.name}${p.client?.name ? ` (${p.client.name})` : ''}, ${LABELS.projectStatus[p.status]}${p.due_date ? `, échéance ${p.due_date}` : ''} [id ${p.id}]`,
            ),
          ].join('\n')
    return { text, structured: { projects: list } }
  },
})

/* ---------- get_project ---------- */

export const getProjectTool = defineTool({
  name: 'get_project',
  title: 'Détail d’un projet',
  description:
    'Un projet : client, statut, dates ; ses tickets ouverts et ses tâches (admin, membre) ; ses devis et factures (admin, finance).',
  schema: z.object({ project_id: z.uuid().describe('Identifiant du projet (voir list_projects ou search).') }),
  roles: ACCESS.projects,
  readOnly: true,
  async run(ctx, { project_id }) {
    const project = await rowOf<ProjectRow>(
      ctx.admin
        .from('projects')
        .select('id, name, status, client_id, start_date, due_date')
        .eq('id', project_id)
        .eq('organization_id', ctx.member.organization_id)
        .maybeSingle(),
      'du projet',
    )
    if (!project) throw new McpToolError('Projet introuvable.')
    const client = project.client_id
      ? await rowOf<ClientRow>(
          ctx.admin.from('clients').select('id, name, website, archived_at').eq('id', project.client_id).eq('organization_id', ctx.member.organization_id).maybeSingle(),
          'du client',
        )
      : null
    const role = ctx.member.role
    const structured: Record<string, unknown> = {
      project: { ...project, client: client ? { id: client.id, name: client.name } : null },
    }
    const lines = [
      `Projet ${project.name}${client ? ` (client ${client.name})` : ''} : ${LABELS.projectStatus[project.status]}` +
        `${project.start_date ? `, début ${project.start_date}` : ''}${project.due_date ? `, échéance ${project.due_date}` : ''}. [id ${project.id}]`,
    ]

    if (can(role, 'work')) {
      const [tickets, tasks, members] = await Promise.all([
        rowsOf<TicketRow>(
          ctx.admin
            .from('tickets')
            .select('id, title, type, priority, status, area')
            .eq('project_id', project.id)
            .eq('organization_id', ctx.member.organization_id)
            .in('status', ['proposed', 'validated'])
            .order('created_at', { ascending: false }),
          'des tickets',
        ),
        rowsOf<TaskRow>(
          ctx.admin
            .from('tasks')
            .select('id, title, status, skill, priority, due_date, estimate_hours, assignee_member_id, project_id')
            .eq('project_id', project.id)
            .eq('organization_id', ctx.member.organization_id)
            .order('position', { ascending: true }),
          'des tâches',
        ),
        memberNames(ctx),
      ])
      const taskViews = tasks.map((t) => taskView(t, members))
      structured.open_tickets = tickets
      structured.tasks = taskViews
      lines.push('', `Tickets ouverts (${tickets.length}) :`)
      lines.push(
        ...(tickets.length === 0
          ? ['- aucun']
          : tickets.map((t) => `- ${t.title} (${LABELS.ticketType[t.type]}, ${LABELS.ticketStatus[t.status]}, priorité ${LABELS.ticketPriority[t.priority].toLowerCase()}) [id ${t.id}]`)),
      )
      lines.push('', `Tâches (${taskViews.length}) :`, ...(taskViews.length === 0 ? ['- aucune'] : taskViews.map(taskLine)))
    }

    if (can(role, 'billing')) {
      const [quotes, invoices] = await Promise.all([
        rowsOf<QuoteRow>(
          ctx.admin
            .from('quotes')
            .select('id, number, title, status, client_id, project_id, total_ttc_cents, issue_date')
            .eq('project_id', project.id)
            .eq('organization_id', ctx.member.organization_id),
          'des devis',
        ),
        rowsOf<InvoiceRow>(
          ctx.admin
            .from('invoices')
            .select('id, number, title, kind, status, client_id, project_id, total_ttc_cents, due_date')
            .eq('project_id', project.id)
            .eq('organization_id', ctx.member.organization_id),
          'des factures',
        ),
      ])
      structured.quotes = quotes
      structured.invoices = invoices
      lines.push('', `Devis (${quotes.length}) :`)
      lines.push(
        ...(quotes.length === 0
          ? ['- aucun']
          : quotes.map((q) => `- ${q.number} « ${q.title} », ${LABELS.quoteStatus[q.status]}, ${formatEuros(q.total_ttc_cents)} TTC [id ${q.id}]`)),
      )
      lines.push('', `Factures (${invoices.length}) :`)
      lines.push(
        ...(invoices.length === 0
          ? ['- aucune']
          : invoices.map(
              (i) => `- ${LABELS.invoiceKind[i.kind]} ${i.number ?? '(brouillon)'} « ${i.title} », ${LABELS.invoiceStatus[i.status]}, ${formatEuros(i.total_ttc_cents)} TTC [id ${i.id}]`,
            )),
      )
    }
    return { text: lines.join('\n'), structured }
  },
})

/* ---------- list_my_tasks ---------- */

export const listMyTasksTool = defineTool({
  name: 'list_my_tasks',
  title: 'Mes tâches',
  description: 'Les tâches attribuées au propriétaire du jeton, par échéance puis priorité (terminées exclues par défaut).',
  schema: z.object({ include_done: z.boolean().optional().describe('Inclure les tâches terminées.') }),
  roles: ACCESS.work,
  readOnly: true,
  async run(ctx, { include_done = false }) {
    const [tasks, projects, members] = await Promise.all([
      rowsOf<TaskRow>(
        ctx.admin
          .from('tasks')
          .select('id, title, status, skill, priority, due_date, estimate_hours, assignee_member_id, project_id')
          .eq('organization_id', ctx.member.organization_id)
          .eq('assignee_member_id', ctx.member.id)
          .limit(SCAN_LIMIT),
        'des tâches',
      ),
      orgRows<ProjectRow>(ctx, 'projects', 'id, name, status, client_id, start_date, due_date', 'des projets'),
      memberNames(ctx),
    ])
    const projectById = byId(projects)
    const list = tasks
      .filter((t) => include_done || t.status !== 'done')
      .sort(compareTasks)
      .map((t) => taskView(t, members, projectById))
    const late = list.filter((t) => t.status !== 'done' && t.due_date !== null && t.due_date < ctx.today).length
    const text =
      list.length === 0
        ? 'Aucune tâche attribuée.'
        : [`${list.length} tâche${list.length > 1 ? 's' : ''}${late > 0 ? `, dont ${late} en retard` : ''} :`, ...list.map(taskLine)].join('\n')
    return { text, structured: { member: { id: ctx.member.id, name: ctx.member.name }, tasks: list } }
  },
})

/* ---------- finance_summary ---------- */

export const financeSummaryTool = defineTool({
  name: 'finance_summary',
  title: 'Chiffres du mois',
  description: 'Chiffre d’affaires encaissé du mois et de l’année (HT, par date de paiement) et factures impayées (TTC, dont en retard).',
  schema: z.object({}),
  roles: ACCESS.billing,
  readOnly: true,
  async run(ctx) {
    const invoices = await rowsOf<FinanceInvoice>(
      ctx.admin
        .from('invoices')
        .select('kind, status, due_date, paid_at, total_ht_cents, total_ttc_cents')
        .eq('organization_id', ctx.member.organization_id)
        .in('status', ['issued', 'paid']),
      'des factures',
    )
    const summary = financeSummary(invoices, ctx.today)
    return { text: financeLines(summary).join('\n'), structured: { ...summary } }
  },
})

/* ---------- list_prospects ---------- */

export const listProspectsTool = defineTool({
  name: 'list_prospects',
  title: 'Lister les prospects',
  description:
    'Les prospects en cours (gagnés et perdus exclus par défaut), avec l’étape et la prochaine action. Un apporteur ne voit que les siens.',
  schema: z.object({
    stage: z.enum(PROSPECT_STAGES).optional().describe('Filtrer sur une étape.'),
    include_closed: z.boolean().optional().describe('Inclure les prospects gagnés et perdus.'),
  }),
  roles: ACCESS.prospects,
  readOnly: true,
  async run(ctx, { stage, include_closed = false }) {
    const [prospects, members] = await Promise.all([visibleProspects(ctx), memberNames(ctx)])
    const list = prospects
      .filter((p) => (stage ? p.stage === stage : include_closed || (p.stage !== 'won' && p.stage !== 'lost')))
      .map((p) => ({
        id: p.id,
        company: p.company,
        stage: p.stage,
        contact_name: p.contact_name,
        next_action_date: p.next_action_date,
        do_not_contact: p.do_not_contact,
        owner: p.owner_member_id ? { id: p.owner_member_id, name: members.get(p.owner_member_id)?.name ?? null } : null,
      }))
      .sort((a, b) => (a.next_action_date ?? '9999').localeCompare(b.next_action_date ?? '9999'))
    const text =
      list.length === 0
        ? 'Aucun prospect.'
        : [
            `${list.length} prospect${list.length > 1 ? 's' : ''} :`,
            ...list.map(
              (p) =>
                `- ${p.company}, ${LABELS.prospectStage[p.stage]}${p.next_action_date ? `, prochaine action ${p.next_action_date}` : ''}` +
                `${p.do_not_contact ? ', ne plus contacter' : ''}${p.owner?.name ? `, suivi par ${p.owner.name}` : ''} [id ${p.id}]`,
            ),
          ].join('\n')
    return { text, structured: { prospects: list } }
  },
})
