/**
 * Processing of an input: (transcription) -> analysis -> proposed tickets + assigned tasks.
 * Never throws: any error puts the input in status "error" with a French message naming the step.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addToWorkload,
  areaKey,
  assignmentCandidates,
  emptyWorkload,
  pickTicketAssignee,
  ticketHours,
  type TeamWorkload,
} from '../../src/shared/assignment.js'
import type { Client, Input, InputStatus, Member, MemberAbsence, Project, Transcript } from '../../src/shared/types.js'
import { analyzeInput, type OpenTicketSummary } from './analysis.js'
import type { ProcessedTicket } from './analysis-postprocess.js'
import { createSignedReadUrl } from './storage.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { transcribeFromUrl } from './transcription.js'

const SIGNED_READ_URL_SECONDS = 60 * 60
const OPEN_TICKETS_LIMIT = 200

type Step = 'chargement' | 'transcription' | 'analyse' | 'enregistrement'

const STEP_PREFIX: Record<Step, string> = {
  chargement: 'Chargement impossible',
  transcription: 'Transcription impossible',
  analyse: 'Analyse impossible',
  enregistrement: 'Enregistrement des tickets impossible',
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() || 'erreur inconnue'
}

export function stepErrorMessage(step: Step, error: unknown): string {
  return `${STEP_PREFIX[step]} : ${messageOf(error)}`.slice(0, 1000)
}

async function setStatus(
  admin: SupabaseClient,
  inputId: string,
  status: InputStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from('inputs')
    .update({ status, error_message: null, updated_at: new Date().toISOString(), ...extra })
    .eq('id', inputId)
  if (error) throw new Error(`mise à jour du statut « ${status} » impossible : ${error.message}`)
}

async function markError(inputId: string, message: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from('inputs')
      .update({ status: 'error', error_message: message, updated_at: new Date().toISOString() })
      .eq('id', inputId)
    if (error) console.error(`[process] input=${inputId} : statut error non enregistré (${error.message})`)
  } catch (error) {
    console.error(`[process] input=${inputId} : statut error non enregistré`, error)
  }
}

export interface ProjectContext {
  project: Project
  client: Client | null
  /** Personnes qui peuvent recevoir un ticket (voir assignmentCandidates). */
  candidates: CandidateWithAbsences[]
}

/** Candidat à l'attribution, avec ses absences datées (member_absences) pour placer les tâches les bons jours. */
export type CandidateWithAbsences = Member & { absences: Pick<MemberAbsence, 'start_date' | 'end_date'>[] }

interface LoadedContext extends ProjectContext {
  input: Input
}

async function loadContext(admin: SupabaseClient, inputId: string): Promise<LoadedContext> {
  const inputRes = await admin.from('inputs').select('*').eq('id', inputId).maybeSingle()
  if (inputRes.error) throw new Error(`lecture de l'entrée : ${inputRes.error.message}`)
  if (!inputRes.data) throw new Error('entrée introuvable.')
  const input = inputRes.data as Input
  return { input, ...(await loadProjectContext(admin, input)) }
}

/** Projet de l'entrée, son client et les candidats à l'attribution. Partagé avec la révision par note. */
export async function loadProjectContext(admin: SupabaseClient, input: Pick<Input, 'project_id'>): Promise<ProjectContext> {
  const projectRes = await admin.from('projects').select('*').eq('id', input.project_id).maybeSingle()
  if (projectRes.error) throw new Error(`lecture du projet : ${projectRes.error.message}`)
  if (!projectRes.data) throw new Error('projet introuvable.')
  const project = projectRes.data as Project

  const [clientRes, membersRes, projectMembersRes, absencesRes] = await Promise.all([
    project.client_id
      ? admin.from('clients').select('*').eq('id', project.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('members').select('*').eq('organization_id', project.organization_id).order('name'),
    admin.from('project_members').select('member_id').eq('project_id', project.id),
    admin
      .from('member_absences')
      .select('member_id, start_date, end_date')
      .eq('organization_id', project.organization_id),
  ])
  if (clientRes.error) throw new Error(`lecture du client : ${clientRes.error.message}`)
  if (membersRes.error) throw new Error(`lecture des membres : ${membersRes.error.message}`)
  if (projectMembersRes.error) throw new Error(`lecture des membres du projet : ${projectMembersRes.error.message}`)
  // Les absences ne sont qu'un critère de départage : si leur lecture échoue, on attribue sans elles.
  if (absencesRes.error) console.error(`[assign] lecture des absences : ${absencesRes.error.message}`)
  const absenceRows = absencesRes.error ? [] : ((absencesRes.data as { member_id: string; start_date: string; end_date: string }[] | null) ?? [])
  const members: CandidateWithAbsences[] = ((membersRes.data as Member[] | null) ?? []).map((m) => ({
    ...m,
    absences: absenceRows.filter((a) => a.member_id === m.id),
  }))
  const projectMemberIds = ((projectMembersRes.data as { member_id: string }[] | null) ?? []).map((row) => row.member_id)
  return {
    project,
    client: (clientRes.data as Client | null) ?? null,
    candidates: assignmentCandidates(members, projectMemberIds),
  }
}

async function loadOpenTickets(admin: SupabaseClient, projectId: string): Promise<OpenTicketSummary[]> {
  const { data, error } = await admin
    .from('tickets')
    .select('id, title, type, status')
    .eq('project_id', projectId)
    .in('status', ['proposed', 'validated'])
    .order('created_at', { ascending: false })
    .limit(OPEN_TICKETS_LIMIT)
  if (error) throw new Error(`lecture des tickets ouverts : ${error.message}`)
  return (data as OpenTicketSummary[] | null) ?? []
}

/**
 * Charge de l'équipe (heures des tâches de tickets validés pas encore faites, tous projets de
 * l'organisation) et habitudes (tickets validés ou faits du projet, par partie). Sert à attribuer
 * chaque nouveau ticket. Renvoie aussi les parties déjà connues du projet, pour l'analyse.
 */
export async function loadWorkload(
  admin: SupabaseClient,
  project: Project,
): Promise<{ workload: TeamWorkload; knownAreas: string[] }> {
  const ticketsRes = await admin
    .from('tickets')
    .select('id, project_id, status, area')
    .eq('organization_id', project.organization_id)
    .in('status', ['validated', 'done'])
  if (ticketsRes.error) throw new Error(`lecture de la charge : ${ticketsRes.error.message}`)
  const tickets = (ticketsRes.data as { id: string; project_id: string; status: string; area: string | null }[] | null) ?? []
  const ticketById = new Map(tickets.map((t) => [t.id, t]))

  const workload = emptyWorkload()
  const knownAreas = new Map<string, string>()
  for (const t of tickets) {
    const key = areaKey(t.area)
    if (key && t.area && t.project_id === project.id && !knownAreas.has(key)) knownAreas.set(key, t.area.trim())
  }
  if (tickets.length === 0) return { workload, knownAreas: [] }

  const tasksRes = await admin
    .from('tasks')
    .select('ticket_id, assignee_member_id, estimate_hours, status')
    .eq('organization_id', project.organization_id)
    .not('assignee_member_id', 'is', null)
  if (tasksRes.error) throw new Error(`lecture de la charge : ${tasksRes.error.message}`)
  const tasks =
    (tasksRes.data as { ticket_id: string | null; assignee_member_id: string; estimate_hours: number | null; status: string }[] | null) ?? []

  const counted = new Set<string>()
  for (const task of tasks) {
    const ticket = task.ticket_id ? ticketById.get(task.ticket_id) : undefined
    if (!ticket) continue
    if (ticket.status === 'validated' && task.status !== 'done') {
      addToWorkload(workload, task.assignee_member_id, ticketHours([task]), null)
    }
    // Habitude : un ticket compte une fois par personne, seulement dans ce projet.
    const seen = `${ticket.id}:${task.assignee_member_id}`
    if (ticket.project_id === project.id && !counted.has(seen)) {
      counted.add(seen)
      addToWorkload(workload, task.assignee_member_id, 0, ticket.area)
    }
  }
  return { workload, knownAreas: [...knownAreas.values()] }
}

/**
 * Filet de sécurité contre les doublons à la relance d'une analyse : écarte un ticket dont le titre
 * (sans casse ni accents) est celui d'un ticket déjà validé ou fait de la même entrée.
 */
async function dropAlreadyValidated(
  admin: SupabaseClient,
  inputId: string,
  tickets: ProcessedTicket[],
): Promise<ProcessedTicket[]> {
  const { data, error } = await admin.from('tickets').select('title').eq('input_id', inputId).in('status', ['validated', 'done'])
  if (error) throw new Error(`lecture des tickets validés : ${error.message}`)
  const existing = new Set(((data as { title: string }[] | null) ?? []).map((t) => areaKey(t.title)))
  const kept = tickets.filter((t) => !existing.has(areaKey(t.title)))
  if (kept.length < tickets.length) {
    console.log(`[process] input=${inputId} : ${tickets.length - kept.length} ticket(s) déjà validé(s) écarté(s)`)
  }
  return kept
}

export async function nextTaskPosition(admin: SupabaseClient, projectId: string): Promise<number> {
  const { data, error } = await admin
    .from('tasks')
    .select('position')
    .eq('project_id', projectId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`lecture des positions : ${error.message}`)
  const max = (data as { position: number } | null)?.position
  return typeof max === 'number' && Number.isFinite(max) ? Math.floor(max) + 1 : 0
}

/** Inserts the tickets (status "proposed") and their assigned tasks. Cleans up on failure. */
/** Compétence qui pèse le plus d'heures dans les tâches du ticket (égalité : la première rencontrée). */
function dominantSkill(tasks: readonly { skill: string; estimate_hours: number | null }[]): string | null {
  const hours = new Map<string, number>()
  for (const t of tasks) hours.set(t.skill, (hours.get(t.skill) ?? 0) + ticketHours([t]))
  let best: string | null = null
  for (const [skill, h] of hours) if (best === null || h > (hours.get(best) ?? 0)) best = skill
  return best
}

async function saveTickets(
  admin: SupabaseClient,
  ctx: LoadedContext,
  tickets: ProcessedTicket[],
  workload: TeamWorkload,
): Promise<{ tickets: number; tasks: number }> {
  if (tickets.length === 0) return { tickets: 0, tasks: 0 }
  const { input, project, candidates } = ctx

  // Un ticket = une personne. Si les consignes du projet la désignent (assignee_member_id de l'IA, parmi
  // les candidats), c'est elle. Sinon la moins chargée, avec un bonus d'habitude sur la même partie.
  // La charge augmente au fil des tickets de cette analyse, pour les répartir.
  // Aucun candidat (équipe vide, tous retirés ou en prospection) : tickets et tâches sans personne.
  const candidateById = new Map(candidates.map((m) => [m.id, m]))
  const assignments = tickets.map((t) => {
    const hours = ticketHours(t.tasks)
    const designated = t.assignee_member_id ? candidateById.get(t.assignee_member_id) : undefined
    const picked = designated
      ? { member: designated, note: `Consigne du projet : ${t.assignment_reason ?? 'attribution demandée'}` }
      : pickTicketAssignee(candidates, { area: t.area, title: t.title, skill: dominantSkill(t.tasks), hours }, workload, { today: new Date() })
    if (picked) addToWorkload(workload, picked.member.id, hours, t.area)
    return picked
  })

  const ticketRows = tickets.map((t, i) => ({
    id: crypto.randomUUID(),
    organization_id: project.organization_id,
    project_id: project.id,
    input_id: input.id,
    title: t.title,
    description: t.description,
    type: t.type,
    priority: t.priority,
    source_quote: t.source_quote,
    status: 'proposed',
    related_ticket_id: t.related_ticket_id,
    area: t.area,
    assignment_note: assignments[i]?.note ?? null,
  }))
  const ticketIds = ticketRows.map((row) => row.id)

  const ticketInsert = await admin.from('tickets').insert(ticketRows)
  if (ticketInsert.error) throw new Error(`insertion des tickets : ${ticketInsert.error.message}`)

  try {
    let position = await nextTaskPosition(admin, project.id)
    const taskRows: Record<string, unknown>[] = []
    const dependencies: { taskId: string; dependsOnId: string }[] = []

    tickets.forEach((ticket, ticketIndex) => {
      const ids = ticket.tasks.map(() => crypto.randomUUID())
      ticket.tasks.forEach((task, taskIndex) => {
        const id = ids[taskIndex] as string
        taskRows.push({
          id,
          organization_id: project.organization_id,
          project_id: project.id,
          ticket_id: ticketIds[ticketIndex],
          title: task.title,
          skill: task.skill,
          estimate_hours: task.estimate_hours,
          assignee_member_id: assignments[ticketIndex]?.member.id ?? null,
          status: 'todo',
          depends_on_task_id: null,
          position: position++,
        })
        if (task.depends_on_index !== null) {
          const dependsOnId = ids[task.depends_on_index]
          if (dependsOnId) dependencies.push({ taskId: id, dependsOnId })
        }
      })
    })

    if (taskRows.length > 0) {
      const taskInsert = await admin.from('tasks').insert(taskRows)
      if (taskInsert.error) throw new Error(`insertion des tâches : ${taskInsert.error.message}`)
    }
    // Insert first, then link: no ordering constraint on the self-referencing foreign key.
    const links = await Promise.all(
      dependencies.map((d) => admin.from('tasks').update({ depends_on_task_id: d.dependsOnId }).eq('id', d.taskId)),
    )
    const linkError = links.find((res) => res.error)?.error
    if (linkError) throw new Error(`liaison des dépendances : ${linkError.message}`)

    return { tickets: ticketRows.length, tasks: taskRows.length }
  } catch (error) {
    // Tasks follow through ON DELETE CASCADE.
    const cleanup = await admin.from('tickets').delete().in('id', ticketIds)
    if (cleanup.error) console.error(`[process] input=${input.id} : nettoyage impossible (${cleanup.error.message})`)
    throw error
  }
}

async function ensureTranscript(admin: SupabaseClient, input: Input): Promise<Transcript> {
  if (input.transcript && input.transcript.utterances.length > 0) return input.transcript
  if (!input.audio_path) throw new Error("aucun fichier audio n'est associé à cette réunion.")
  await setStatus(admin, input.id, 'transcribing')
  const audioUrl = await createSignedReadUrl(input.audio_path, SIGNED_READ_URL_SECONDS)
  const started = Date.now()
  const transcript = await transcribeFromUrl(audioUrl)
  console.log(
    `[process] input=${input.id} transcription ok : ${transcript.utterances.length} interventions, ${Date.now() - started} ms`,
  )
  const { error } = await admin
    .from('inputs')
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq('id', input.id)
  if (error) throw new Error(`enregistrement de la transcription : ${error.message}`)
  return transcript
}

/** Processes an input end to end. Never throws, never leaves the input in transcribing/analyzing. */
export async function processInput(inputId: string): Promise<void> {
  let step: Step = 'chargement'
  const started = Date.now()
  try {
    console.log(`[process] input=${inputId} début`)
    const admin = getSupabaseAdmin()
    const ctx = await loadContext(admin, inputId)
    const { input, project, client, candidates } = ctx

    let transcript: Transcript | null = input.transcript
    if (input.kind === 'meeting') {
      step = 'transcription'
      transcript = await ensureTranscript(admin, input)
    }

    step = 'analyse'
    await setStatus(admin, input.id, 'analyzing')
    // Re-run without duplicates: the input's tickets still "proposed" are replaced (tasks cascade).
    const removed = await admin.from('tickets').delete().eq('input_id', input.id).eq('status', 'proposed')
    if (removed.error) throw new Error(`suppression des anciens tickets proposés : ${removed.error.message}`)
    const openTickets = await loadOpenTickets(admin, project.id)
    const { workload, knownAreas } = await loadWorkload(admin, project)
    const analysisStarted = Date.now()
    const tickets = await analyzeInput({
      clientName: client?.name ?? null,
      projectName: project.name,
      toneOfVoice: project.tone_of_voice,
      aiInstructions: project.ai_instructions ?? null,
      team: candidates.map((m) => ({ id: m.id, name: m.name })),
      openTickets,
      knownAreas,
      input: {
        kind: input.kind,
        title: input.title,
        rawText: input.raw_text,
        transcript,
        speakerNames: input.speaker_names ?? {},
      },
    })
    console.log(`[process] input=${inputId} analyse ok : ${tickets.length} tickets, ${Date.now() - analysisStarted} ms`)

    step = 'enregistrement'
    const fresh = await dropAlreadyValidated(admin, input.id, tickets)
    const saved = await saveTickets(admin, ctx, fresh, workload)
    await setStatus(admin, input.id, 'ready')
    console.log(
      `[process] input=${inputId} prête : ${saved.tickets} tickets, ${saved.tasks} tâches, ${Date.now() - started} ms au total`,
    )
  } catch (error) {
    const message = stepErrorMessage(step, error)
    console.error(`[process] input=${inputId} échec (${step}) : ${messageOf(error)}`)
    await markError(inputId, message)
  }
}
