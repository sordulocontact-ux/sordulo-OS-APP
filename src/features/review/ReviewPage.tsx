import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Button, EmptyState, ErrorState, LoadingState, Spinner, useToast } from '../../components/ui'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useProject } from '../projects/useProject'
import { useProjectTickets } from '../tickets/useProjectTickets'
import { inputLabel, STATUS_TONE } from '../tickets/format'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, type Input, type Member, type Task, type Ticket, type TicketStatus } from '../../shared/types'
import {
  hasChanges,
  makeTicketDraft,
  nextPosition,
  planSave,
  validateDraft,
  type SavePlan,
  type TicketDraft,
} from './diff'
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
        <BackLink to={backTo} />
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
        <BackLink to={backTo} />
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
      projectId={project.data.id}
      input={current}
      tickets={tickets.data ?? []}
      tasks={tasks.data ?? []}
      members={members.data ?? []}
      projectTickets={projectTickets.data ?? []}
    />
  )
}

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className={styles.back}>
      Retour à l'entrée
    </Link>
  )
}

interface ReviewBoardProps {
  projectId: string
  input: Input
  tickets: Ticket[]
  tasks: Task[]
  members: Member[]
  projectTickets: Ticket[]
}

function ReviewBoard({ projectId, input, tickets, tasks, members, projectTickets }: ReviewBoardProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, TicketDraft>>({})
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState(false)

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

  return (
    <section className={styles.page} aria-labelledby="review-title">
      <BackLink to={`/projects/${projectId}/inputs/${input.id}`} />
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 id="review-title">Tickets proposés</h1>
          <p className={styles.muted}>
            {inputLabel(input)} · {proposed.length} ticket{proposed.length > 1 ? 's' : ''} à traiter
          </p>
        </div>
        {proposed.length > 0 ? (
          <Button variant="primary" loading={bulk} disabled={busyIds.size > 0} onClick={() => void validateAll()}>
            Tout valider ({proposed.length})
          </Button>
        ) : null}
      </header>

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
    </section>
  )
}
