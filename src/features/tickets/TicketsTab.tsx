import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Badge, Card, EmptyState, ErrorState, Field, LoadingState, Select } from '../../components/ui'
import {
  LABELS,
  TICKET_STATUSES,
  TICKET_TYPES,
  type Input,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '../../shared/types'
import { formatTimestamp, speakerLabel } from '../../shared/transcript'
import { formatDate, inputLabel, PRIORITY_TONE, STATUS_TONE } from './format'
import { findQuoteUtterance } from './quote'
import { useProjectInputs, useProjectTickets, useTicketTaskStats, type TicketTaskStats } from './useProjectTickets'
import styles from './TicketsTab.module.css'

/** Default filter: everything except rejected tickets. */
const DEFAULT_STATUS = 'open'
type StatusFilter = typeof DEFAULT_STATUS | 'all' | TicketStatus

function readStatus(value: string | null): StatusFilter {
  if (value === 'all') return 'all'
  return TICKET_STATUSES.find((status) => status === value) ?? DEFAULT_STATUS
}

function readType(value: string | null): TicketType | 'all' {
  return TICKET_TYPES.find((type) => type === value) ?? 'all'
}

const SHORT_LENGTH = 200

function shortText(text: string): string {
  return text.length > SHORT_LENGTH ? `${text.slice(0, SHORT_LENGTH).trimEnd()}…` : text
}

function matchesStatus(ticket: Ticket, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === DEFAULT_STATUS) return ticket.status !== 'rejected'
  return ticket.status === filter
}

export function TicketsTab() {
  const { projectId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tickets = useProjectTickets(projectId)
  const inputs = useProjectInputs(projectId)
  const stats = useTicketTaskStats(projectId)

  const statusFilter = readStatus(searchParams.get('status'))
  const typeFilter = readType(searchParams.get('type'))

  const inputsById = useMemo(() => new Map((inputs.data ?? []).map((input) => [input.id, input])), [inputs.data])
  const visible = useMemo(
    () =>
      (tickets.data ?? []).filter(
        (ticket) => matchesStatus(ticket, statusFilter) && (typeFilter === 'all' || ticket.type === typeFilter),
      ),
    [tickets.data, statusFilter, typeFilter],
  )

  function setParam(key: 'status' | 'type', value: string, defaultValue: string) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === defaultValue) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  if (tickets.isLoading) return <LoadingState label="Chargement des tickets…" />
  if (tickets.isError) {
    return <ErrorState message="Impossible de charger les tickets." onRetry={() => void tickets.refetch()} />
  }
  const all = tickets.data ?? []
  if (all.length === 0) {
    return (
      <EmptyState
        title="Aucun ticket. Ajoute une entrée pour en générer."
        action={<Link to={`/projects/${projectId}/inputs`}>Aller aux entrées</Link>}
      />
    )
  }

  return (
    <section className={styles.root} aria-labelledby="tickets-title">
      <h2 id="tickets-title" className="visually-hidden">
        Tickets
      </h2>
      <div className={styles.filters}>
        <Field label="Statut">
          <Select value={statusFilter} onChange={(event) => setParam('status', event.target.value, DEFAULT_STATUS)}>
            <option value="open">Tous sauf refusés</option>
            <option value="all">Tous</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LABELS.ticketStatus[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={typeFilter} onChange={(event) => setParam('type', event.target.value, 'all')}>
            <option value="all">Tous les types</option>
            {TICKET_TYPES.map((type) => (
              <option key={type} value={type}>
                {LABELS.ticketType[type]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="Aucun ticket ne correspond à ces filtres." />
      ) : (
        <ul className={styles.list}>
          {visible.map((ticket) => (
            <li key={ticket.id}>
              <TicketItem
                ticket={ticket}
                input={ticket.input_id ? inputsById.get(ticket.input_id) : undefined}
                stats={stats.data?.get(ticket.id)}
                projectId={projectId ?? ''}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

interface TicketItemProps {
  ticket: Ticket
  input: Input | undefined
  stats: TicketTaskStats | undefined
  projectId: string
}

function TicketItem({ ticket, input, stats, projectId }: TicketItemProps) {
  const utterance = useMemo(
    () => (input?.kind === 'meeting' ? findQuoteUtterance(input.transcript, ticket.source_quote) : null),
    [input, ticket.source_quote],
  )
  const count = stats?.count ?? 0
  const hours = stats?.hours ?? 0

  return (
    <Card className={styles.item}>
      <div className={styles.head}>
        <h3 className={styles.title}>{ticket.title}</h3>
        <div className={styles.badges}>
          <Badge tone={ticket.type === 'bug' ? 'bug' : ticket.type === 'modification' ? 'modification' : 'new_request'}>
            {LABELS.ticketType[ticket.type]}
          </Badge>
          <Badge tone={PRIORITY_TONE[ticket.priority]}>Priorité {LABELS.ticketPriority[ticket.priority].toLowerCase()}</Badge>
          <Badge tone={STATUS_TONE[ticket.status]}>{LABELS.ticketStatus[ticket.status]}</Badge>
        </div>
      </div>
      {ticket.description ? <p className={styles.description}>{shortText(ticket.description)}</p> : null}
      {ticket.source_quote ? (
        <figure className={styles.quote}>
          <blockquote className={styles.quoteText}>{ticket.source_quote}</blockquote>
          <figcaption className={styles.quoteSource}>
            {utterance && input ? (
              <>
                {formatTimestamp(utterance.start)} · {speakerLabel(utterance.speaker, input.speaker_names)} ·{' '}
              </>
            ) : null}
            {input ? (
              <Link to={`/projects/${projectId}/inputs/${input.id}`}>{inputLabel(input)}</Link>
            ) : (
              <span>Entrée d'origine introuvable</span>
            )}
          </figcaption>
        </figure>
      ) : input ? (
        <p className={styles.meta}>
          Source : <Link to={`/projects/${projectId}/inputs/${input.id}`}>{inputLabel(input)}</Link> ({formatDate(input.created_at)})
        </p>
      ) : null}
      <div className={styles.footer}>
        <span className={styles.meta}>
          {count === 0 ? 'Aucune tâche' : `${count} ${count > 1 ? 'tâches' : 'tâche'} · ${hours} h estimées`}
        </span>
        {ticket.status === 'proposed' && ticket.input_id ? (
          <Link
            to={`/projects/${projectId}/inputs/${ticket.input_id}/review`}
            aria-label={`À valider : ${ticket.title}`}
            className={styles.review}
          >
            À valider
          </Link>
        ) : null}
      </div>
    </Card>
  )
}
