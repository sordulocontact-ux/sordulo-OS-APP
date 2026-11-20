import { Badge, Card, LoadingState } from '../../components/ui'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useInputTasks, useInputTickets } from '../review/useReviewData'
import { formatHours } from '../tasks/board'
import { ticketHours } from '../../shared/assignment'
import { LABELS, type Input } from '../../shared/types'
import { LinkButton } from './LinkButton'
import { reviewPath } from './inputUtils'
import styles from './ProposedTicketsPreview.module.css'

/** Aperçu en lecture seule des tickets proposés (un ticket = une tâche), avant l'écran de validation. */
export function ProposedTicketsPreview({ input }: { input: Input }) {
  const tickets = useInputTickets(input.id, input.status === 'ready')
  const proposed = (tickets.data ?? []).filter((t) => t.status === 'proposed')
  const tasks = useInputTasks(
    input.id,
    proposed.map((t) => t.id),
    proposed.length > 0,
  )
  const { data: members = [] } = useOrgMembers(input.organization_id)
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? 'Membre inconnu') : 'Personne')

  if (tickets.isLoading || (proposed.length > 0 && tasks.isLoading)) return <LoadingState label="Chargement des tickets…" />
  if (proposed.length === 0) return null

  return (
    <section className={styles.section} aria-labelledby="proposed-title">
      <div className={styles.header}>
        <h2 id="proposed-title" className={styles.title}>
          Tickets proposés
        </h2>
        <LinkButton to={reviewPath(input.project_id, input.id)} variant="primary" size="sm">
          Modifier et valider
        </LinkButton>
      </div>
      <ul className={styles.list}>
        {proposed.map((ticket) => {
          const ticketTasks = (tasks.data ?? []).filter((task) => task.ticket_id === ticket.id)
          return (
            <li key={ticket.id}>
              <Card className={styles.ticket}>
                <div className={styles.ticketHead}>
                  <h3 className={styles.ticketTitle}>{ticket.title}</h3>
                  <div className={styles.badges}>
                    <Badge tone={ticket.type}>{LABELS.ticketType[ticket.type]}</Badge>
                    {ticket.area ? <Badge>{ticket.area}</Badge> : null}
                  </div>
                </div>
                <p className={styles.meta}>
                  {ticketTasks.length > 0 ? (
                    <>
                      <Badge tone={ticketTasks[0]!.skill}>{LABELS.skill[ticketTasks[0]!.skill]}</Badge>
                      <span>
                        {formatHours(ticketHours(ticketTasks))} · {nameOf(ticketTasks[0]!.assignee_member_id)}
                      </span>
                    </>
                  ) : (
                    <span>Aucune tâche</span>
                  )}
                  {ticket.assignment_note ? <span className={styles.note}>· {ticket.assignment_note}</span> : null}
                </p>
                {ticket.description ? <p className={styles.description}>{ticket.description}</p> : null}
              </Card>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
