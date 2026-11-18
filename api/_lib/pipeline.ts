/**
 * Processing of an input: (transcription) -> analysis -> proposed tickets + assigned tasks.
 * Never throws: any error puts the input in status "error" with a French message naming the step.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickAssignee } from '../../src/shared/assignment.js'
import type { Client, Input, InputStatus, Member, Project, Transcript } from '../../src/shared/types.js'
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

interface LoadedContext {
  input: Input
  project: Project
  client: Client | null
  members: Member[]
}

async function loadContext(admin: SupabaseClient, inputId: string): Promise<LoadedContext> {
  const inputRes = await admin.from('inputs').select('*').eq('id', inputId).maybeSingle()
  if (inputRes.error) throw new Error(`lecture de l'entrée : ${inputRes.error.message}`)
  if (!inputRes.data) throw new Error('entrée introuvable.')
  const input = inputRes.data as Input

  const projectRes = await admin.from('projects').select('*').eq('id', input.project_id).maybeSingle()
  if (projectRes.error) throw new Error(`lecture du projet : ${projectRes.error.message}`)
  if (!projectRes.data) throw new Error('projet introuvable.')
  const project = projectRes.data as Project

  const [clientRes, membersRes] = await Promise.all([
    project.client_id
      ? admin.from('clients').select('*').eq('id', project.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from('members').select('*').eq('organization_id', project.organization_id).order('name'),
  ])
  if (clientRes.error) throw new Error(`lecture du client : ${clientRes.error.message}`)
  if (membersRes.error) throw new Error(`lecture des membres : ${membersRes.error.message}`)
  return {
    input,
    project,
    client: (clientRes.data as Client | null) ?? null,
    members: (membersRes.data as Member[] | null) ?? [],
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

async function nextTaskPosition(admin: SupabaseClient, projectId: string): Promise<number> {
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
async function saveTickets(
  admin: SupabaseClient,
  ctx: LoadedContext,
  tickets: ProcessedTicket[],
): Promise<{ tickets: number; tasks: number }> {
  if (tickets.length === 0) return { tickets: 0, tasks: 0 }
  const { input, project, members } = ctx

  const ticketRows = tickets.map((t) => ({
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
          assignee_member_id: pickAssignee(task.skill, members)?.id ?? null,
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
    const { input, project, client } = ctx

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
    const analysisStarted = Date.now()
    const tickets = await analyzeInput({
      clientName: client?.name ?? null,
      projectName: project.name,
      toneOfVoice: project.tone_of_voice,
      openTickets,
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
    const saved = await saveTickets(admin, ctx, tickets)
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
