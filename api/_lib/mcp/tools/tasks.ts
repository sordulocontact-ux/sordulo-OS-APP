/** Outils MCP d'écriture : créer et modifier une tâche (admin, membre). */
import { z } from 'zod'
import { LABELS, SKILLS, TASK_PRIORITIES, TASK_STATUSES, type Member, type Project, type Task } from '../../../../src/shared/types.js'
import { ACCESS } from '../access.js'
import { McpToolError, defineTool, rowOf, type McpToolContext } from './types.js'

const isoDate = z.iso.date('Date au format AAAA-MM-JJ.')

/** Membre de l'organisation à qui une tâche peut être attribuée : actif, admin ou membre. */
async function assignableMember(ctx: McpToolContext, memberId: string): Promise<Pick<Member, 'id' | 'name'>> {
  const member = await rowOf<Pick<Member, 'id' | 'name' | 'role' | 'removed_at'>>(
    ctx.admin
      .from('members')
      .select('id, name, role, removed_at')
      .eq('id', memberId)
      .eq('organization_id', ctx.member.organization_id)
      .maybeSingle(),
    'du membre',
  )
  if (!member || member.removed_at) throw new McpToolError('Personne introuvable dans l’organisation.')
  if (member.role !== 'admin' && member.role !== 'membre') {
    throw new McpToolError(`${member.name} ne travaille pas sur les tâches (rôle ${LABELS.memberRole[member.role].toLowerCase()}).`)
  }
  return { id: member.id, name: member.name }
}

function describeTask(task: Task, projectName: string, assigneeName: string | null): string {
  const parts = [LABELS.taskStatus[task.status], LABELS.skill[task.skill], `priorité ${LABELS.taskPriority[task.priority].toLowerCase()}`]
  if (task.estimate_hours !== null) parts.push(`${task.estimate_hours} h`)
  if (task.due_date) parts.push(`échéance ${task.due_date}`)
  parts.push(assigneeName ? `attribuée à ${assigneeName}` : 'non attribuée')
  return `« ${task.title} » sur ${projectName} (${parts.join(', ')}) [id ${task.id}]`
}

export const createTaskTool = defineTool({
  name: 'create_task',
  title: 'Créer une tâche',
  description:
    'Crée une tâche « À faire » sur un projet. Attribution facultative à un membre (admin ou membre) de l’organisation ; sans attribution, la tâche reste non attribuée.',
  schema: z.object({
    project_id: z.uuid().describe('Projet (voir list_projects ou search).'),
    title: z.string().trim().min(1, 'Titre obligatoire.').max(200),
    skill: z.enum(SKILLS).describe('Compétence : design ou dev.'),
    estimate_hours: z.number().min(0).max(1000).nullable().optional().describe('Estimation en heures.'),
    due_date: isoDate.nullable().optional().describe('Échéance AAAA-MM-JJ.'),
    priority: z.enum(TASK_PRIORITIES).optional().describe('Priorité (moyenne par défaut).'),
    assignee_member_id: z.uuid().nullable().optional().describe('Membre à qui attribuer la tâche.'),
  }),
  roles: ACCESS.work,
  readOnly: false,
  async run(ctx, args) {
    const project = await rowOf<Pick<Project, 'id' | 'name' | 'organization_id'>>(
      ctx.admin.from('projects').select('id, name, organization_id').eq('id', args.project_id).eq('organization_id', ctx.member.organization_id).maybeSingle(),
      'du projet',
    )
    if (!project) throw new McpToolError('Projet introuvable.')
    const assignee = args.assignee_member_id ? await assignableMember(ctx, args.assignee_member_id) : null

    const last = await rowOf<Pick<Task, 'position'>>(
      ctx.admin.from('tasks').select('position').eq('project_id', project.id).order('position', { ascending: false }).limit(1).maybeSingle(),
      'des tâches',
    )
    const inserted = await ctx.admin
      .from('tasks')
      .insert({
        organization_id: project.organization_id,
        project_id: project.id,
        ticket_id: null,
        title: args.title,
        skill: args.skill,
        estimate_hours: args.estimate_hours ?? null,
        due_date: args.due_date ?? null,
        priority: args.priority ?? 'medium',
        assignee_member_id: assignee?.id ?? null,
        status: 'todo',
        depends_on_task_id: null,
        position: (last?.position ?? 0) + 1,
      })
      .select('*')
      .single()
    if (inserted.error) throw new Error(`Création de la tâche impossible : ${inserted.error.message}`)
    const task = inserted.data as Task
    console.log(`[mcp] tâche créée ${task.id} (membre ${ctx.member.id})`)
    return {
      text: `Tâche créée : ${describeTask(task, project.name, assignee?.name ?? null)}.`,
      structured: { task: { ...task, project: { id: project.id, name: project.name }, assignee } },
    }
  },
})

export const updateTaskTool = defineTool({
  name: 'update_task',
  title: 'Modifier une tâche',
  description: 'Change le statut, l’échéance, la priorité ou l’attribution d’une tâche (null retire l’échéance ou l’attribution).',
  schema: z
    .object({
      task_id: z.uuid().describe('Tâche (voir get_project, list_my_tasks ou search).'),
      status: z.enum(TASK_STATUSES).optional().describe('todo, in_progress, review ou done.'),
      due_date: isoDate.nullable().optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      assignee_member_id: z.uuid().nullable().optional(),
    })
    .refine(
      (args) => args.status !== undefined || args.due_date !== undefined || args.priority !== undefined || args.assignee_member_id !== undefined,
      'Rien à modifier : donne au moins status, due_date, priority ou assignee_member_id.',
    ),
  roles: ACCESS.work,
  readOnly: false,
  async run(ctx, args) {
    const task = await rowOf<Task>(
      ctx.admin.from('tasks').select('*').eq('id', args.task_id).eq('organization_id', ctx.member.organization_id).maybeSingle(),
      'de la tâche',
    )
    if (!task) throw new McpToolError('Tâche introuvable.')
    const patch: Partial<Pick<Task, 'status' | 'due_date' | 'priority' | 'assignee_member_id'>> = {}
    if (args.status !== undefined) patch.status = args.status
    if (args.due_date !== undefined) patch.due_date = args.due_date
    if (args.priority !== undefined) patch.priority = args.priority
    let assigneeName: string | null = null
    if (args.assignee_member_id !== undefined) {
      const assignee = args.assignee_member_id ? await assignableMember(ctx, args.assignee_member_id) : null
      patch.assignee_member_id = assignee?.id ?? null
      assigneeName = assignee?.name ?? null
    } else if (task.assignee_member_id) {
      const current = await rowOf<Pick<Member, 'name'>>(ctx.admin.from('members').select('name').eq('id', task.assignee_member_id).maybeSingle(), 'du membre')
      assigneeName = current?.name ?? null
    }

    const updated = await ctx.admin
      .from('tasks')
      .update(patch)
      .eq('id', task.id)
      .eq('organization_id', ctx.member.organization_id)
      .select('*')
      .single()
    if (updated.error) throw new Error(`Modification de la tâche impossible : ${updated.error.message}`)
    const saved = updated.data as Task
    const project = await rowOf<Pick<Project, 'name'>>(ctx.admin.from('projects').select('name').eq('id', saved.project_id).maybeSingle(), 'du projet')
    console.log(`[mcp] tâche modifiée ${saved.id} (membre ${ctx.member.id})`)
    return {
      text: `Tâche modifiée : ${describeTask(saved, project?.name ?? 'projet inconnu', assigneeName)}.`,
      structured: { task: saved },
    }
  },
})
