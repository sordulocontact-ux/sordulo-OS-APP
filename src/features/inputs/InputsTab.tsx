import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import type { Input } from '../../shared/types'
import { useProjectContext } from '../projects/useProjectContext'
import { InputStatusBadge } from './InputStatusBadge'
import { LinkButton } from './LinkButton'
import { NewInputModal } from './NewInputModal'
import { formatDateTime, inputTitle, kindLabel, reviewPath } from './inputUtils'
import { useInputs, useProposedTicketCount } from './useInputs'
import styles from './InputsTab.module.css'

function InputRow({ input }: { input: Input }) {
  const ready = input.status === 'ready'
  const { data: proposed = 0 } = useProposedTicketCount(input.id, ready)
  const detailPath = `/projects/${input.project_id}/inputs/${input.id}`

  return (
    <Card interactive className={styles.item}>
      <div className={styles.info}>
        <div className={styles.meta}>
          <Badge tone={input.kind === 'meeting' ? 'primary' : 'neutral'}>{kindLabel(input.kind)}</Badge>
          <span className={styles.date}>{formatDateTime(input.created_at)}</span>
        </div>
        <Link to={detailPath} className={styles.name}>
          {inputTitle(input)}
        </Link>
        {input.status === 'error' && input.error_message ? (
          <p className={styles.error}>{input.error_message}</p>
        ) : null}
      </div>
      <div className={styles.side}>
        <span aria-live="polite">
          <InputStatusBadge status={input.status} />
        </span>
        {ready && proposed > 0 ? (
          <LinkButton to={reviewPath(input.project_id, input.id)} variant="primary" size="sm">
            Valider {proposed} ticket{proposed > 1 ? 's' : ''}
          </LinkButton>
        ) : null}
      </div>
    </Card>
  )
}

export function InputsTab() {
  const { project } = useProjectContext()
  const { data, isLoading, isError, refetch } = useInputs(project.id)
  const [modalOpen, setModalOpen] = useState(false)

  const newButton = (
    <Button variant="primary" onClick={() => setModalOpen(true)}>
      Nouvelle entrée
    </Button>
  )

  return (
    <section className={styles.page} aria-labelledby="inputs-title">
      <div className={styles.header}>
        <h2 id="inputs-title" className={styles.title}>
          Entrées
        </h2>
        {newButton}
      </div>
      {isLoading ? (
        <LoadingState label="Chargement des entrées…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les entrées." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Aucune entrée. Ajoute un retour écrit ou une réunion."
          action={newButton}
        />
      ) : (
        <ul className={styles.list}>
          {data.map((input) => (
            <li key={input.id}>
              <InputRow input={input} />
            </li>
          ))}
        </ul>
      )}
      <NewInputModal projectId={project.id} open={modalOpen} onClose={() => setModalOpen(false)} />
    </section>
  )
}
