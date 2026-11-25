import { useState } from 'react'
import { Button, ErrorState, Field, LoadingState, Select, TextInput, useToast } from '../../components/ui'
import { todayIso } from '../../shared/billing'
import { ABSENCE_KINDS, LABELS, type AbsenceKind } from '../../shared/types'
import { formatPeriod, sortAbsences, validateAbsence, type AbsenceDraft } from './profileLogic'
import { useAddAbsence, useDeleteAbsence, useMemberAbsences } from './useMemberAbsences'
import styles from './ProfileEditors.module.css'

const EMPTY: AbsenceDraft = { start_date: '', end_date: '', kind: 'leave', note: '' }

export interface AbsencesEditorProps {
  memberId: string
  /** Titre de la section. */
  title?: string
  hint?: string
}

/** Liste des absences d'un membre (école, congé, autre) avec ajout et suppression : enregistrés tout de suite. */
export function AbsencesEditor({ memberId, title = 'Absences', hint = 'Jours d’école ou d’alternance, congés : les tâches sont placées les autres jours.' }: AbsencesEditorProps) {
  const toast = useToast()
  const absences = useMemberAbsences(memberId)
  const add = useAddAbsence(memberId)
  const remove = useDeleteAbsence(memberId)
  const [draft, setDraft] = useState<AbsenceDraft>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const problem = validateAbsence(draft)
    setError(problem)
    if (problem) return
    add.mutate(draft, {
      onSuccess: () => {
        setDraft(EMPTY)
        toast.success('Absence ajoutée.')
      },
      onError: () => setError('Impossible d’ajouter l’absence. Réessaie.'),
    })
  }

  const today = todayIso()
  const sorted = absences.data ? sortAbsences(absences.data, today) : []

  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {absences.isLoading ? <LoadingState label="Chargement des absences…" /> : null}
      {absences.isError ? <ErrorState message="Impossible de charger les absences." onRetry={() => void absences.refetch()} /> : null}
      {absences.isSuccess && sorted.length === 0 ? <p className={styles.absenceNote}>Aucune absence enregistrée. {hint}</p> : null}
      {sorted.length > 0 ? (
        <ul className={styles.rows}>
          {sorted.map((a) => (
            <li key={a.id} className={[styles.absence, a.end_date < today ? styles.past : ''].filter(Boolean).join(' ')}>
              <span className={styles.absenceText}>
                <span>
                  {LABELS.absenceKind[a.kind]} : {formatPeriod(a.start_date, a.end_date)}
                </span>
                {a.note ? <span className={styles.absenceNote}>{a.note}</span> : null}
              </span>
              <Button variant="ghost" size="sm" loading={remove.isPending && remove.variables === a.id} onClick={() => remove.mutate(a.id, { onError: () => toast.error('Impossible de supprimer l’absence.') })}>
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.absenceForm}>
        <Field label="Du">
          <TextInput type="date" value={draft.start_date} onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value, end_date: d.end_date || e.target.value }))} />
        </Field>
        <Field label="Au">
          <TextInput type="date" value={draft.end_date} min={draft.start_date || undefined} onChange={(e) => setDraft((d) => ({ ...d, end_date: e.target.value }))} />
        </Field>
        <Field label="Type">
          <Select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as AbsenceKind }))}>
            {ABSENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {LABELS.absenceKind[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (facultatif)">
          <TextInput value={draft.note} maxLength={500} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
        </Field>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={submit} loading={add.isPending}>
          Ajouter l’absence
        </Button>
      </div>
    </section>
  )
}
