import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import type { TimeEntry } from '../../shared/types'
import { localDay, manualStart, parseDuration } from './timeLogic'
import { useEntryMutations } from './useTimeEntries'
import styles from './TimeEntryModal.module.css'

export interface TimeEntryModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  /** Tâches proposées dans la liste ; absent avec `taskId` = la tâche est imposée. */
  tasks?: { id: string; title: string }[]
  /** Tâche imposée (saisie depuis une tâche). */
  taskId?: string | null
  /** Entrée à modifier ; absente = nouvelle saisie. */
  entry?: TimeEntry | null
}

/** Remonte l'état à chaque ouverture. */
export function TimeEntryModal(props: TimeEntryModalProps) {
  return <TimeEntryForm key={`${props.open}-${props.entry?.id ?? 'new'}`} {...props} />
}

function todayLocal(): string {
  return localDay(new Date().toISOString())
}

function TimeEntryForm({ open, onClose, projectId, tasks, taskId, entry }: TimeEntryModalProps) {
  const toast = useToast()
  const { create, update, remove } = useEntryMutations()
  const [duration, setDuration] = useState(entry?.duration_minutes != null ? String(entry.duration_minutes) : '')
  const [day, setDay] = useState(entry ? localDay(entry.started_at) : todayLocal())
  const [task, setTask] = useState(entry?.task_id ?? taskId ?? '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [durationError, setDurationError] = useState<string | null>(null)
  const [dayError, setDayError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = create.isPending || update.isPending || remove.isPending
  const editing = Boolean(entry)
  const formId = 'time-entry-form'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const minutes = parseDuration(duration)
    const sameDay = entry && day === localDay(entry.started_at)
    // Une date inchangée garde l'heure de début d'origine.
    const startedAt = sameDay && entry ? entry.started_at : manualStart(day)
    setDurationError(minutes === null ? 'Durée illisible. Exemples : 90, 1h30, 45min.' : null)
    setDayError(startedAt === null ? 'Choisis une date.' : null)
    if (minutes === null || startedAt === null) return
    const input = { task_id: task || null, started_at: startedAt, duration_minutes: minutes, note: note.trim() || null }
    try {
      if (entry) await update.mutateAsync({ id: entry.id, input })
      else await create.mutateAsync({ ...input, project_id: projectId })
      toast.success(editing ? 'Temps modifié' : 'Temps ajouté')
      onClose()
    } catch {
      setError("Impossible d'enregistrer ce temps. Réessaie.")
    }
  }

  async function onDelete() {
    if (!entry) return
    try {
      await remove.mutateAsync(entry.id)
      toast.success('Temps supprimé')
      onClose()
    } catch {
      setError('Impossible de supprimer ce temps. Réessaie.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title={editing ? 'Modifier le temps' : 'Ajouter du temps'}
      actions={
        <>
          {editing ? (
            confirmDelete ? (
              <Button variant="danger" onClick={() => void onDelete()} loading={remove.isPending}>
                Confirmer la suppression
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Supprimer
              </Button>
            )
          ) : null}
          <Button variant="ghost" onClick={() => !busy && onClose()} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={create.isPending || update.isPending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className={styles.row}>
          <Field label="Durée" hint="90, 1h30, 45min" error={durationError}>
            <TextInput value={duration} onChange={(e) => setDuration(e.target.value)} disabled={busy} autoFocus />
          </Field>
          <Field label="Date" error={dayError}>
            <TextInput type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
          </Field>
        </div>
        {tasks ? (
          <Field label="Tâche">
            <Select value={task} onChange={(e) => setTask(e.target.value)} disabled={busy}>
              <option value="">Aucune tâche (temps du projet)</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Note">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </Field>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
