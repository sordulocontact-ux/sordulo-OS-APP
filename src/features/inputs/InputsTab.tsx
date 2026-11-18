import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Spinner } from '../../components/ui'
import type { Input } from '../../shared/types'
import { useProjectContext } from '../projects/useProjectContext'
import { DeleteInputButton } from './DeleteInputButton'
import { InputStatusBadge } from './InputStatusBadge'
import { LinkButton } from './LinkButton'
import { NewInputModal } from './NewInputModal'
import { countLabel, formatDateTime, inputTitle, kindLabel, reviewPath } from './inputUtils'
import { DOCUMENT_ACCEPT, dragHasFiles, filesFromDrop } from './documentText'
import { useDocumentImport } from './useDocumentImport'
import { useInputs, useProposedTicketCount } from './useInputs'
import styles from './InputsTab.module.css'

function InputRow({ input }: { input: Input }) {
  const ready = input.status === 'ready'
  const { data: proposed } = useProposedTicketCount(input.id, ready)
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
        <div className={styles.rowActions}>
          {ready && proposed && proposed.tickets > 0 ? (
            <LinkButton to={reviewPath(input.project_id, input.id)} variant="primary" size="sm">
              Voir {countLabel(proposed.tickets, 'ticket')} · {countLabel(proposed.tasks, 'tâche')}
            </LinkButton>
          ) : null}
          <DeleteInputButton input={input} size="sm" />
        </div>
      </div>
    </Card>
  )
}

export function InputsTab() {
  const { project } = useProjectContext()
  const { data, isLoading, isError, refetch } = useInputs(project.id)
  const [modalOpen, setModalOpen] = useState(false)
  const { remaining, importFiles } = useDocumentImport(project.id)
  const fileInput = useRef<HTMLInputElement>(null)
  // dragenter/dragleave fire for every child element: count them to know when the drag really leaves.
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)

  function onDragEnter(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragOver(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void filesFromDrop(event.dataTransfer).then(importFiles)
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void importFiles(files)
  }

  const newButton = (
    <Button variant="primary" onClick={() => setModalOpen(true)}>
      Nouvelle entrée
    </Button>
  )

  const importButton = (
    <Button onClick={() => fileInput.current?.click()} disabled={remaining > 0}>
      Importer un document
    </Button>
  )

  return (
    <section
      className={styles.page}
      aria-labelledby="inputs-title"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.header}>
        <h2 id="inputs-title" className={styles.title}>
          Entrées
        </h2>
        <div className={styles.actions}>
          {importButton}
          {newButton}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        className={styles.fileInput}
        onChange={onPick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <p className={styles.hint}>
        Glisse ici un ticket déjà rédigé (PDF, Word, texte ou mail, ou tout un dossier) : une entrée par fichier.
      </p>
      {remaining > 0 ? (
        <p className={styles.importing} aria-live="polite">
          <Spinner label="" />
          Import de {remaining} document{remaining > 1 ? 's' : ''}…
        </p>
      ) : null}
      {isLoading ? (
        <LoadingState label="Chargement des entrées…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les entrées." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Aucune entrée. Ajoute un retour écrit, une réunion ou glisse un document ici."
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
      {dragging ? (
        <div className={styles.dropOverlay} aria-hidden="true">
          Dépose pour créer une entrée par fichier
        </div>
      ) : null}
    </section>
  )
}
