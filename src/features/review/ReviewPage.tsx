import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BackLink, Badge, Button, EmptyState, ErrorState, Icon, LoadingState, Spinner, useToast } from '../../components/ui'
import micIcon from '../../assets/icons/mic.svg'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useProject } from '../projects/useProject'
import { useProjectTickets } from '../tickets/useProjectTickets'
import { inputLabel, STATUS_TONE } from '../tickets/format'
import { countLabel } from '../inputs/inputUtils'
import { ticketHours } from '../../shared/assignment'
import { api } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, type Input, type Member, type Project, type Task, type Ticket, type TicketStatus } from '../../shared/types'
import {
  hasChanges,
  makeTicketDraft,
  nextPosition,
  parseEstimate,
  planSave,
  reviseSummary,
  toReviseState,
  validateDraft,
  type SavePlan,
  type TicketDraft,
} from './diff'
import { AiNoteModal } from './AiNoteModal'
import { executePlan } from './save'
import { TicketCard } from './TicketCard'
import { PROCESSING_STATUSES, useInputTasks, useInputTickets, useReviewInput } from './useReviewData'
import styles from './ReviewPage.module.css'

export function ReviewPage() {
  const { projectId, inputId } = useParams()
  const project = useProject(projectId)
  const input = useReviewInput(inputId)
  const members = useOrgMembers(project.data?.organization_id)
  const inputStatus = input.data?.status
  const ready = inputStatus === 'ready'
  const tickets = useInputTickets(inputId, ready)
  const ticketIds = useMemo(() => (tickets.data ?? []).map((ticket) => ticket.id), [tickets.data])
  const tasks = useInputTasks(inputId, ticketIds, ready && tickets.isSuccess)
  const projectTickets = useProjectTickets(projectId)

  const backTo = `/projects/${projectId}/inputs/${inputId}`

  if (project.isLoading || input.isLoading) return <LoadingState label="Chargement de l'entrée…" />
  if (project.isError || input.isError) {
    return (
      <ErrorState
        message="Impossible de charger l'entrée."
        onRetry={() => {
          void project.refetch()
          void input.refetch()
        }}
      />
    )
  }
  if (!project.data || !input.data) {
    return (
      <EmptyState
        title="Entrée introuvable"
        text="Cette entrée n'existe pas ou tu n'y as pas accès."
        action={<Link to={`/projects/${projectId}/inputs`}>Retour aux entrées</Link>}
      />
    )
  }
  const current = input.data

  if (PROCESSING_STATUSES.includes(current.status)) {
    return (
      <section className={styles.page} aria-live="polite">
        <BackLink to={backTo} label="Retour à l'entrée" />
        <div className={styles.waiting}>
          <Spinner label="" />
          <p>L'entrée est en cours de traitement ({LABELS.inputStatus[current.status].replace('…', '')}). Les tickets apparaîtront ici dès que l'analyse sera terminée.</p>
        </div>
      </section>
    )
  }
  if (current.status === 'error') {
    return (
      <section className={styles.page}>
        <BackLink to={backTo} label="Retour à l'entrée" />
        <ErrorState message={current.error_message ?? "Le traitement de l'entrée a échoué."} />
        <p>
          <Link to={backTo}>Ouvrir la fiche de l'entrée pour relancer le traitement</Link>
        </p>
      </section>
    )
  }

  if (tickets.isLoading || (tickets.isSuccess && ticketIds.length > 0 && tasks.isLoading) || members.isLoading) {
    return <LoadingState label="Chargement des tickets…" />
  }
  if (tickets.isError || tasks.isError || members.isError) {
    return (
      <ErrorState
        message="Impossible de charger les tickets proposés."
        onRetry={() => {
          void tickets.refetch()
          void tasks.refetch()
          void members.refetch()
        }}
      />
    )
  }

  return (
    <ReviewBoard
      project={project.data}
      input={current}
      tickets={tickets.data ?? []}
      tasks={tasks.data ?? []}
      members={members.data ?? []}
      projectTickets={projectTickets.data ?? []}
    />
  )
}

interface ReviewBoardProps {
  project: Pick<Project, 'id' | 'ai_instructions'>
  input: Input
  tickets: Ticket[]
  tasks: Task[]
  members: Member[]
  projectTickets: Ticket[]
}

function ReviewBoard({ project, input, tickets, tasks, members, projectTickets }: ReviewBoardProps) {
  const projectId = project.id
  const queryClient = useQueryClient()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, TicketDraft>>({})
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)

  const proposed = tickets.filter((ticket) => ticket.status === 'proposed')
  const processed = tickets.filter((ticket) => ticket.status !== 'proposed')
  const titleById = useMemo(
    () => new Map([...projectTickets, ...tickets].map((ticket) => [ticket.id, ticket.title])),
    [projectTickets, tickets],
  )

  function tasksOf(ticket: Ticket): Task[] {
    return tasks.filter((task) => task.ticket_id === ticket.id)
  }

  function draftOf(ticket: Ticket): TicketDraft {
    return drafts[ticket.id] ?? makeTicketDraft(ticket, tasksOf(ticket))
  }

  // Durée totale, qui suit les modifications en cours.
  const proposedHours = proposed.reduce(
    (sum, ticket) => sum + ticketHours(draftOf(ticket).tasks.map((t) => ({ estimate_hours: parseEstimate(t.estimate) ?? null }))),
    0,
  )

  function setBusy(id: string, value: boolean) {
    setBusyIds((previous) => {
      const next = new Set(previous)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inputTickets(input.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tickets(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) }),
    ])
  }

  function forget(id: string) {
    setDrafts((previous) => {
      const { [id]: _removed, ...rest } = previous
      return rest
    })
  }

  /** Saves the edits of one ticket then gives it a status. Returns the number of inserted tasks. */
  async function persist(ticket: Ticket, status: TicketStatus, startPosition: number): Promise<number> {
    const plan = planSave(ticket, tasksOf(ticket), draftOf(ticket), { startPosition, status })
    await executePlan(ticket.id, plan)
    return plan.taskInserts.length
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'erreur inconnue'
  }

  async function validateOne(ticket: Ticket) {
    if (!validateDraft(draftOf(ticket)).valid) {
      toast.error('Corrige les champs signalés avant de valider ce ticket.')
      return
    }
    setBusy(ticket.id, true)
    try {
      await persist(ticket, 'validated', nextPosition(tasks))
      forget(ticket.id)
      await refresh()
      toast.success(`Ticket « ${draftOf(ticket).title.trim()} » validé.`)
    } catch (error) {
      toast.error(`Validation impossible : ${errorMessage(error)}`)
      await refresh()
    } finally {
      setBusy(ticket.id, false)
    }
  }

  async function rejectOne(ticket: Ticket) {
    setBusy(ticket.id, true)
    try {
      const plan: SavePlan = { ticketPatch: { status: 'rejected' }, taskUpdates: [], taskInserts: [], taskDeletes: [] }
      await executePlan(ticket.id, plan)
      forget(ticket.id)
      await refresh()
      toast.success(`Ticket « ${ticket.title} » refusé.`)
    } catch (error) {
      toast.error(`Refus impossible : ${errorMessage(error)}`)
    } finally {
      setBusy(ticket.id, false)
    }
  }

  async function validateAll() {
    setBulk(true)
    const failed: string[] = []
    let done = 0
    let position = nextPosition(tasks)
    for (const ticket of proposed) {
      if (!validateDraft(draftOf(ticket)).valid) {
        failed.push(`${ticket.title} (champs invalides)`)
        continue
      }
      try {
        position += await persist(ticket, 'validated', position)
        forget(ticket.id)
        done += 1
      } catch (error) {
        failed.push(`${ticket.title} (${errorMessage(error)})`)
      }
    }
    await refresh()
    setBulk(false)
    if (failed.length === 0) toast.success(`${done} ticket${done > 1 ? 's' : ''} validé${done > 1 ? 's' : ''}.`)
    else toast.error(`${done} validé${done > 1 ? 's' : ''}, ${failed.length} en échec : ${failed.join(' ; ')}`)
  }

  /** Note à l'IA : part de l'état affiché (brouillons compris). Une erreur remonte à la fenêtre, qui garde la note. */
  async function applyNote(note: string) {
    const result = await api.reviseTickets({
      inputId: input.id,
      note,
      tickets: proposed.map((ticket) => toReviseState(ticket, draftOf(ticket))),
    })
    // Les brouillons sont intégrés aux tickets réécrits : on repart de la base.
    setDrafts({})
    await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })])
    setNoteOpen(false)
    toast.success(reviseSummary(result))
  }

  const memory = project.ai_instructions?.trim() ?? ''

  return (
    <section className={styles.page} aria-labelledby="review-title">
      <BackLink to={`/projects/${projectId}/inputs/${input.id}`} label="Retour à l'entrée" />
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 id="review-title">Tickets proposés</h1>
          <p className={styles.muted}>
            {inputLabel(input)} · {countLabel(proposed.length, 'ticket')} à traiter
            {proposedHours > 0 ? `, environ ${String(Math.round(proposedHours * 100) / 100).replace('.', ',')} h` : ''}
          </p>
        </div>
        {proposed.length > 0 ? (
          <div className={styles.actions}>
            <Button disabled={bulk || busyIds.size > 0} onClick={() => setNoteOpen(true)}>
              <Icon src={micIcon} />
              Note à l'IA
            </Button>
            <Button variant="primary" loading={bulk} disabled={busyIds.size > 0} onClick={() => void validateAll()}>
              Tout valider ({countLabel(proposed.length, 'ticket')})
            </Button>
          </div>
        ) : null}
      </header>

      <details className={styles.memory}>
        <summary>Ce que l'IA retient pour ce projet</summary>
        <div className={styles.memoryBody}>
          {memory ? (
            <p className={styles.memoryText}>{memory}</p>
          ) : (
            <p className={styles.muted}>
              Rien pour l'instant. Une note à l'IA peut lui apprendre vos habitudes (qui fait quelles pages, comment
              regrouper les tickets).
            </p>
          )}
          <p className={styles.muted}>
            Modifiable dans les infos du projet (<Link to={`/projects/${projectId}`}>page du projet</Link>, bouton
            Modifier).
          </p>
        </div>
      </details>

      {proposed.length === 0 ? (
        <EmptyState
          title="Tous les tickets de cette entrée sont traités"
          action={
            <div className={styles.links}>
              <Link to={`/projects/${projectId}/tasks`}>Voir les tâches</Link>
              <Link to={`/projects/${projectId}/tickets`}>Voir les tickets</Link>
            </div>
          }
        />
      ) : (
        <ul className={styles.list}>
          {proposed.map((ticket) => {
            const draft = draftOf(ticket)
            return (
              <li key={ticket.id}>
                <TicketCard
                  ticket={ticket}
                  draft={draft}
                  members={members}
                  relatedTitle={ticket.related_ticket_id ? (titleById.get(ticket.related_ticket_id) ?? null) : null}
                  errors={validateDraft(draft)}
                  dirty={ticket.id in drafts && hasChanges(ticket, tasksOf(ticket), draft)}
                  busy={busyIds.has(ticket.id)}
                  frozen={bulk}
                  onChange={(next) => setDrafts((previous) => ({ ...previous, [ticket.id]: next }))}
                  onValidate={() => void validateOne(ticket)}
                  onReject={() => void rejectOne(ticket)}
                />
              </li>
            )
          })}
        </ul>
      )}

      {processed.length > 0 ? (
        <details className={styles.processed}>
          <summary>Déjà traités ({processed.length})</summary>
          <ul className={styles.processedList}>
            {processed.map((ticket) => (
              <li key={ticket.id} className={styles.processedItem}>
                <div className={styles.processedHead}>
                  <span className={styles.processedTitle}>{ticket.title}</span>
                  <Badge tone={STATUS_TONE[ticket.status]}>{LABELS.ticketStatus[ticket.status]}</Badge>
                </div>
                <p className={styles.muted}>
                  {LABELS.ticketType[ticket.type]} · Priorité {LABELS.ticketPriority[ticket.priority].toLowerCase()}
                </p>
                {ticket.description ? <p className={styles.muted}>{ticket.description}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <AiNoteModal open={noteOpen} onClose={() => setNoteOpen(false)} projectId={projectId} onApply={applyNote} />
    </section>
  )
}
