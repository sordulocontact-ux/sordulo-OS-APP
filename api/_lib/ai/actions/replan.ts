/**
 * Action IA « replan » : propositions de réorganisation du planning (POST /api/ai/run { action: 'replan', projectId? }).
 * Droits : admin ou membre de l'organisation.
 *
 * 1. Analyse déterministe (src/shared/replan.ts) : semaine qui déborde, tâche bloquante, urgence, avec les
 *    opérations candidates (réattribuer, décaler une échéance) et leurs valeurs avant / après exactes.
 * 2. Claude (sortie structurée) choisit parmi ces candidats seulement et rédige titre + explication. Une
 *    opération hors liste rejette la proposition (vérifié par buildProposals, jamais par confiance).
 * 3. Insertion des ai_proposals (en attente). Les tâches déjà couvertes par une proposition en attente sont
 *    exclues, et une proposition identique à une proposition en attente n'est jamais recréée.
 *    Une règle « Toujours » active qui couvre le type (et le projet) : les opérations sont appliquées tout de
 *    suite, la proposition est enregistrée « appliquée automatiquement » (annulable par undo_ai_proposal).
 * Les notifications partent du déclencheur de la base (proposal.created, membres de payload.member_ids).
 * Aucun problème : ni appel à Claude ni proposition.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { parisDate } from '../../../../src/shared/assignment.js'
import { ReplanOutputSchema, type ReplanResponse } from '../../../../src/shared/ai/replan.js'
import {
  analyzePlanning,
  buildProposals,
  formatShortDate,
  operationsSignature,
  ruleCovers,
  type ReplanAnalysis,
  type ReplanDraft,
  type ReplanMember,
  type ReplanTask,
} from '../../../../src/shared/replan.js'
import type { AiAutonomyRule, AiProposal, AiProposalPayload, Member, MemberAbsence, MemberRole } from '../../../../src/shared/types.js'
import { callClaudeStructured } from '../../analysis.js'
import { HttpError } from '../../http.js'
import { defineAiAction } from '../types.js'

const WRITER_ROLES: readonly MemberRole[] = ['admin', 'membre']

export const REPLAN_SYSTEM_PROMPT = `Tu es l'assistant chef de projet de Sordulo, une agence (branding, sites, applications). Le code a analysé le planning de l'équipe et détecté des problèmes : une semaine qui déborde pour une personne, une tâche bloquée par une autre qui finit trop tard, ou une urgence. Pour chaque problème, il te donne des opérations possibles, chacune avec un identifiant.

Ta mission : choisir les opérations qui règlent le mieux chaque problème, les regrouper en propositions, et rédiger pour chacune un titre et une explication. L'équipe validera, refusera, ou acceptera « Toujours ».

Règles strictes :
- Tu ne choisis QUE des identifiants de la liste fournie, recopiés exactement. Jamais d'opération inventée.
- Une proposition règle un seul problème (ou des problèmes liés) : une à quatre opérations, jamais deux opérations sur la même tâche, et un identifiant ne sert qu'une fois.
- Préfère réattribuer à quelqu'un de compétent qui a de la place plutôt que décaler une échéance, sauf si la réattribution surchargerait cette personne ou si la tâche est déjà bien engagée.
- Pour une tâche bloquée, choisis entre avancer la tâche dont elle dépend ou décaler la tâche bloquée, selon ce qui est le plus réaliste.
- Si aucune opération n'est raisonnable pour un problème, ne fais pas de proposition pour lui. Tu peux renvoyer une liste vide.
- Titre : court (moins de 80 caractères), concret, à l'infinitif ou nominal, par exemple « Confier la maquette de l'accueil à Sacha ».
- Explication : 2 à 4 phrases en français, au tutoiement, qui disent le problème constaté (chiffres et dates donnés) et ce que le changement règle. Pas de tiret cadratin, pas de markdown.`

const ReplanBodySchema = z.object({
  projectId: z.uuid({ error: 'projectId doit être un identifiant valide.' }).optional(),
  organizationId: z.uuid({ error: 'organizationId doit être un identifiant valide.' }).optional(),
})

type MemberRow = Pick<Member, 'id' | 'name' | 'role' | 'removed_at' | 'skills' | 'weekly_capacity_hours' | 'unavailable_weekdays'>
type TaskRow = ReplanTask & { ticket_id: string | null }

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what} impossible : ${error.message}`)
}

/** Message envoyé à Claude : date, semaine, équipe, problèmes et opérations candidates (avec leurs ids). */
export function buildReplanMessage(analysis: ReplanAnalysis, today: string, members: readonly ReplanMember[]): string {
  const weekday = WEEKDAY_NAMES[(new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7]
  const byId = new Map(analysis.candidates.map((c) => [c.id, c]))
  const lines = [
    `Date du jour : ${weekday} ${formatShortDate(today)} (${today}). Semaine analysée : du ${formatShortDate(analysis.weekStart)} au ${formatShortDate(analysis.weekEnd)}.`,
    '',
    'Équipe :',
    ...members
      .filter((m) => m.removed_at === null && (m.role === 'admin' || m.role === 'membre'))
      .map((m) => {
        const skills = Object.entries(m.skills ?? {})
          .filter(([, level]) => typeof level === 'number' && level > 0)
          .map(([skill, level]) => `${skill} ${level}/5`)
          .join(', ')
        return `- ${m.name} : ${m.weekly_capacity_hours} h par semaine${skills ? `, ${skills}` : ''}`
      }),
    '',
    'Problèmes détectés et opérations possibles :',
  ]
  analysis.issues.forEach((issue, index) => {
    lines.push('', `${index + 1}. ${issue.summary}`)
    for (const id of issue.candidateIds) {
      const candidate = byId.get(id)
      if (candidate) lines.push(`   - [${candidate.id}] ${candidate.label}`)
    }
  })
  return lines.join('\n')
}

async function resolveOrganization(
  admin: SupabaseClient,
  userId: string,
  body: z.output<typeof ReplanBodySchema>,
): Promise<string> {
  if (body.projectId) {
    const { data, error } = await admin.from('projects').select('id, organization_id').eq('id', body.projectId).maybeSingle()
    if (error) fail('Lecture du projet', error)
    if (!data) throw new HttpError(404, 'Projet introuvable.')
    return (data as { organization_id: string }).organization_id
  }
  if (body.organizationId) return body.organizationId
  const { data, error } = await admin.from('members').select('organization_id').eq('user_id', userId).is('removed_at', null)
  if (error) fail('Lecture des membres', error)
  const orgs = [...new Set((data as { organization_id: string }[]).map((m) => m.organization_id))]
  if (orgs.length === 0) throw new HttpError(403, "Accès refusé : tu n'es membre d'aucune organisation.")
  if (orgs.length > 1) throw new HttpError(400, 'Précise l’organisation ou le projet à réorganiser.')
  return orgs[0] as string
}

export default defineAiAction({
  schema: ReplanBodySchema,
  async run(ctx): Promise<ReplanResponse> {
    const { admin, body } = ctx
    const organizationId = await resolveOrganization(admin, ctx.user.id, body)
    await ctx.requireMember(organizationId, WRITER_ROLES)

    const [membersRes, absencesRes, tasksRes, ticketsRes, projectMembersRes, projectsRes, pendingRes, rulesRes] = await Promise.all([
      admin
        .from('members')
        .select('id, name, role, removed_at, skills, weekly_capacity_hours, unavailable_weekdays')
        .eq('organization_id', organizationId),
      admin.from('member_absences').select('member_id, start_date, end_date').eq('organization_id', organizationId),
      admin
        .from('tasks')
        .select('id, project_id, ticket_id, title, skill, estimate_hours, assignee_member_id, status, depends_on_task_id, due_date, priority')
        .eq('organization_id', organizationId),
      // Tâches de tickets encore proposés ou refusés : pas du travail engagé.
      admin.from('tickets').select('id').eq('organization_id', organizationId).in('status', ['proposed', 'rejected']),
      admin.from('project_members').select('project_id, member_id').eq('organization_id', organizationId),
      admin.from('projects').select('id, name').eq('organization_id', organizationId),
      admin.from('ai_proposals').select('*').eq('organization_id', organizationId).eq('status', 'pending'),
      admin.from('ai_autonomy_rules').select('*').eq('organization_id', organizationId).is('revoked_at', null),
    ])
    if (membersRes.error) fail('Lecture des membres', membersRes.error)
    if (absencesRes.error) fail('Lecture des absences', absencesRes.error)
    if (tasksRes.error) fail('Lecture des tâches', tasksRes.error)
    if (ticketsRes.error) fail('Lecture des tickets', ticketsRes.error)
    if (projectMembersRes.error) fail('Lecture des membres des projets', projectMembersRes.error)
    if (projectsRes.error) fail('Lecture des projets', projectsRes.error)
    if (pendingRes.error) fail('Lecture des propositions', pendingRes.error)
    if (rulesRes.error) fail('Lecture des règles « Toujours »', rulesRes.error)

    const absences = absencesRes.data as Pick<MemberAbsence, 'member_id' | 'start_date' | 'end_date'>[]
    const members: ReplanMember[] = (membersRes.data as MemberRow[]).map((m) => ({
      ...m,
      absences: absences.filter((a) => a.member_id === m.id),
    }))
    const notEngaged = new Set((ticketsRes.data as { id: string }[]).map((t) => t.id))
    const tasks = (tasksRes.data as TaskRow[]).filter((t) => !t.ticket_id || !notEngaged.has(t.ticket_id))
    const projectMembers = new Map<string, string[]>()
    for (const row of projectMembersRes.data as { project_id: string; member_id: string }[]) {
      projectMembers.set(row.project_id, [...(projectMembers.get(row.project_id) ?? []), row.member_id])
    }
    const projectNames = new Map((projectsRes.data as { id: string; name: string }[]).map((p) => [p.id, p.name]))
    const pending = pendingRes.data as AiProposal[]
    const rules = rulesRes.data as AiAutonomyRule[]
    const excludedTaskIds = new Set(pending.flatMap((p) => (p.payload?.operations ?? []).map((op) => op.task_id)))

    const today = parisDate(new Date())
    const analysis = analyzePlanning({
      today,
      tasks,
      members,
      projectMembers,
      projectNames,
      projectId: body.projectId ?? null,
      excludedTaskIds,
    })
    if (analysis.issues.length === 0 || analysis.candidates.length === 0) {
      return { proposals: [], issueCount: analysis.issues.length }
    }

    const output = await callClaudeStructured({
      schema: ReplanOutputSchema,
      system: REPLAN_SYSTEM_PROMPT,
      content: buildReplanMessage(analysis, today, members),
      logTag: '[replan]',
      refusal: 'Claude a refusé de proposer une réorganisation',
      truncated: 'La réponse de Claude a été coupée : relance la réorganisation.',
      retryHint: 'Relance la réorganisation.',
      maxTokens: 4000,
    })

    const { drafts, rejected } = buildProposals(analysis, output.proposals)
    for (const { reason } of rejected) console.error(`[replan] proposition de Claude écartée : ${reason}`)

    const pendingSignatures = new Set(pending.map((p) => operationsSignature(p.payload?.operations)))
    const created: AiProposal[] = []
    for (const draft of drafts) {
      const signature = operationsSignature(draft.operations)
      if (pendingSignatures.has(signature)) continue
      pendingSignatures.add(signature)
      const rule = rules.find((r) => ruleCovers(r, draft.kind, draft.projectId)) ?? null
      created.push(rule ? await autoApply(admin, organizationId, draft, rule) : await insertProposal(admin, organizationId, draft, null))
    }
    console.log(`[replan] ${analysis.issues.length} problème(s), ${analysis.candidates.length} candidat(s), ${created.length} proposition(s) créée(s)`)
    return { proposals: created, issueCount: analysis.issues.length }
  },
})

function payloadOf(draft: ReplanDraft): AiProposalPayload {
  return { operations: draft.operations, member_ids: draft.memberIds }
}

async function insertProposal(admin: SupabaseClient, organizationId: string, draft: ReplanDraft, rule: AiAutonomyRule | null): Promise<AiProposal> {
  const row = {
    organization_id: organizationId,
    project_id: draft.projectId,
    kind: draft.kind,
    title: draft.title,
    explanation: draft.explanation,
    payload: payloadOf(draft),
    ...(rule ? { status: 'auto_applied', rule_id: rule.id, decided_at: new Date().toISOString() } : { status: 'pending' }),
  }
  const { data, error } = await admin.from('ai_proposals').insert(row).select('*').single()
  if (error) fail('Enregistrement de la proposition', error)
  return data as AiProposal
}

/** Applique les valeurs « après » (règle « Toujours »), puis enregistre la proposition appliquée. */
async function autoApply(admin: SupabaseClient, organizationId: string, draft: ReplanDraft, rule: AiAutonomyRule): Promise<AiProposal> {
  const applied: ReplanDraft['operations'] = []
  try {
    for (const op of draft.operations) {
      const { error } = await admin.from('tasks').update(op.after).eq('id', op.task_id).eq('organization_id', organizationId)
      if (error) fail('Mise à jour de la tâche', error)
      applied.push(op)
    }
    return await insertProposal(admin, organizationId, draft, rule)
  } catch (error) {
    // Rien ne doit rester appliqué sans proposition annulable : on remet les valeurs « avant ».
    for (const op of applied) {
      await admin.from('tasks').update(op.before).eq('id', op.task_id).eq('organization_id', organizationId)
    }
    throw error
  }
}
