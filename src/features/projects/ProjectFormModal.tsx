import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { useCurrentMember, useOrgMembers } from '../auth'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { AI_INSTRUCTIONS_MAX_LENGTH, LABELS, PROJECT_STATUSES, type Project, type ProjectStatus } from '../../shared/types'
import { diffMembers, TONE_TEMPLATES, validateDates } from './projectLogic'
import { useClientOptions } from './useClientOptions'
import { useProjectMembers } from './useProjectMembers'
import styles from './ProjectFormModal.module.css'

export interface ProjectFormModalProps {
  open: boolean
  onClose: () => void
  /** Projet à modifier ; absent = création. */
  project?: Project | null
  /** Client présélectionné à la création (depuis la fiche client). */
  defaultClientId?: string | null
  /** Appelé après l'enregistrement avec le projet créé ou modifié. */
  onSaved?: (project: Project) => void
}

/** Remonte l'état à chaque ouverture : le formulaire repart des valeurs du projet. */
export function ProjectFormModal(props: ProjectFormModalProps) {
  return <ProjectForm key={`${props.open}-${props.project?.id ?? 'new'}`} {...props} />
}

function ProjectForm({ open, onClose, project, defaultClientId, onSaved }: ProjectFormModalProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { member } = useCurrentMember()
  const organizationId = member?.organization_id
  const { data: orgMembers } = useOrgMembers(open ? organizationId : undefined)
  const { data: clients } = useClientOptions(open ? (project?.client_id ?? defaultClientId ?? null) : undefined)
  const { data: currentMembers, isLoading: membersLoading, isError: membersError } = useProjectMembers(
    open ? project?.id : undefined,
  )

  const [name, setName] = useState(project?.name ?? '')
  const [clientId, setClientId] = useState(project?.client_id ?? defaultClientId ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'in_progress')
  const [startDate, setStartDate] = useState(project?.start_date ?? '')
  const [dueDate, setDueDate] = useState(project?.due_date ?? '')
  const [tone, setTone] = useState(project?.tone_of_voice ?? '')
  const [aiInstructions, setAiInstructions] = useState(project?.ai_instructions ?? '')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [pendingTone, setPendingTone] = useState<number | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Projet déjà créé si l'enregistrement des membres échoue : un nouvel essai le met à jour sans le recréer.
  const [created, setCreated] = useState<Project | null>(null)

  const target = project ?? created
  const selected = picked ?? new Set((currentMembers ?? []).map((m) => m.member_id))
  const activeMembers = (orgMembers ?? []).filter((m) => m.removed_at === null)
  const dateError = validateDates(startDate, dueDate)

  function toggleMember(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  function applyTone(index: number) {
    const template = TONE_TEMPLATES[index]
    if (template) setTone(template.text)
    setPendingTone(null)
  }

  /** Un texte vide ou déjà égal à un modèle se remplace sans risque ; un texte écrit à la main demande confirmation. */
  function chooseTone(index: number) {
    const text = tone.trim()
    if (text === '' || TONE_TEMPLATES.some((t) => t.text === text)) applyTone(index)
    else setPendingTone(index)
  }

  async function syncMembers(projectId: string) {
    const { data, error: readError } = await supabase.from('project_members').select('member_id').eq('project_id', projectId)
    if (readError) throw readError
    const { toAdd, toRemove } = diffMembers(
      (data ?? []).map((r: { member_id: string }) => r.member_id),
      [...selected],
    )
    if (toAdd.length > 0) {
      const { error: insertError } = await supabase
        .from('project_members')
        .insert(toAdd.map((member_id) => ({ project_id: projectId, member_id })))
      if (insertError) throw insertError
    }
    if (toRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from('project_members')
        .delete()
        .eq('project_id', projectId)
        .in('member_id', toRemove)
      if (deleteError) throw deleteError
    }
  }

  async function save() {
    const values = {
      client_id: clientId || null,
      name: name.trim(),
      status,
      start_date: startDate || null,
      due_date: dueDate || null,
      tone_of_voice: tone.trim() || null,
      ai_instructions: aiInstructions.trim() || null,
    }
    let saved: Project
    if (target) {
      const { data, error: updateError } = await supabase
        .from('projects')
        .update(values)
        .eq('id', target.id)
        .select()
        .single()
      if (updateError) throw updateError
      saved = data as Project
    } else {
      const { data, error: insertError } = await supabase
        .from('projects')
        .insert({ ...values, organization_id: organizationId })
        .select()
        .single()
      if (insertError) throw insertError
      saved = data as Project
      setCreated(saved)
    }
    await syncMembers(saved.id)
    return saved
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (!name.trim()) {
      setNameError('Donne un nom au projet.')
      return
    }
    setNameError(null)
    if (dateError) return
    if (!organizationId) {
      setError('Ton profil n\'est pas chargé. Réessaie dans un instant.')
      return
    }
    setBusy(true)
    try {
      const saved = await save()
      const wasEdit = Boolean(project)
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(saved.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(saved.id) })
      for (const id of new Set([saved.client_id, project?.client_id])) {
        if (id) void queryClient.invalidateQueries({ queryKey: queryKeys.client(id) })
      }
      toast.success(wasEdit ? 'Projet modifié' : 'Projet créé')
      onSaved?.(saved)
      onClose()
    } catch (e) {
      const detail = e instanceof Error && e.message ? ` (${e.message})` : ''
      setError(`Impossible d'enregistrer le projet${detail}. Réessaie.`)
      setBusy(false)
    }
  }

  function handleClose() {
    if (!busy) onClose()
  }

  const formId = 'project-form'

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={project ? 'Modifier le projet' : 'Nouveau projet'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy} disabled={Boolean(project) && membersLoading}>
            {project ? 'Enregistrer' : 'Créer le projet'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Nom du projet" error={nameError}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy} required autoFocus />
        </Field>

        <Field label="Client">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={busy}>
            <option value="">Sans client</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.archived_at ? `${c.name} (archivé)` : c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Statut">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} disabled={busy}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LABELS.projectStatus[s]}
              </option>
            ))}
          </Select>
        </Field>

        <div className={styles.dates}>
          <Field label="Date de début">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
          </Field>
          <Field label="Date d'échéance" error={dateError}>
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
          </Field>
        </div>

        <fieldset className={styles.members} disabled={busy}>
          <legend className={styles.legend}>Membres du projet</legend>
          <p className={styles.hint}>L'attribution automatique se limite à eux. Aucun coché = toute l'équipe.</p>
          {membersError ? <p className={styles.error}>Impossible de charger les membres du projet.</p> : null}
          <ul className={styles.memberList}>
            {activeMembers.map((m) => (
              <li key={m.id}>
                <label className={styles.member}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selected.has(m.id)}
                    onChange={() => toggleMember(m.id)}
                  />
                  <span>{m.name}</span>
                  <span className={styles.role}>{LABELS.memberRole[m.role]}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <Field label="Tone of voice" hint="L'IA s'en sert pour rédiger les tickets de ce projet.">
          <Textarea rows={4} value={tone} onChange={(e) => setTone(e.target.value)} disabled={busy} />
        </Field>
        <div className={styles.tones} role="group" aria-label="Modèles de tone of voice">
          {TONE_TEMPLATES.map((t, i) => (
            <Button key={t.label} size="sm" onClick={() => chooseTone(i)} disabled={busy}>
              {t.label}
            </Button>
          ))}
        </div>
        {pendingTone !== null ? (
          <div className={styles.confirm} role="alert">
            <p>Remplacer ton texte par le modèle « {TONE_TEMPLATES[pendingTone]?.label} » ?</p>
            <div className={styles.confirmActions}>
              <Button size="sm" onClick={() => applyTone(pendingTone)}>
                Remplacer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingTone(null)}>
                Garder mon texte
              </Button>
            </div>
          </div>
        ) : null}

        <Field
          label="Consignes pour l'IA"
          hint="Ce que l'IA doit savoir pour rédiger et attribuer les tickets : qui fait quelles pages, préférences de l'équipe. Complété automatiquement par les notes à l'IA."
        >
          <Textarea
            rows={5}
            value={aiInstructions}
            maxLength={AI_INSTRUCTIONS_MAX_LENGTH}
            onChange={(e) => setAiInstructions(e.target.value)}
            disabled={busy}
          />
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
