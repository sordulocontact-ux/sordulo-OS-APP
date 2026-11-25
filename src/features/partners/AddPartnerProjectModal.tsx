import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, TextInput, useToast } from '../../components/ui'
import { useProjects } from '../projects/useProjects'
import { trimOrNull } from '../clients/clientUtils'
import { linkableProjects, parseOptionalMoney } from './partnerLogic'
import { partnerErrorText, useAddPartnerProject, type PartnerProjectWithProject } from './usePartners'
import styles from './partners.module.css'

export interface AddPartnerProjectModalProps {
  open: boolean
  onClose: () => void
  partnerId: string
  links: readonly PartnerProjectWithProject[]
}

/** Lie un projet à un partenaire, avec son rôle et le montant qu'il a facturé (facultatifs). */
export function AddPartnerProjectModal({ open, onClose, partnerId, links }: AddPartnerProjectModalProps) {
  const toast = useToast()
  const projectsQuery = useProjects()
  const add = useAddPartnerProject(partnerId)
  const [projectId, setProjectId] = useState('')
  const [role, setRole] = useState('')
  const [amount, setAmount] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setProjectId('')
      setRole('')
      setAmount('')
      setShowErrors(false)
      setError(null)
      add.reset()
    }
  }

  const options = linkableProjects(projectsQuery.data ?? [], links)
  const parsedAmount = parseOptionalMoney(amount)
  const projectError = projectId === '' ? 'Choisis un projet.' : null
  const amountError = parsedAmount.ok ? null : parsedAmount.error
  const busy = add.isPending

  function handleClose() {
    if (!busy) onClose()
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setShowErrors(true)
    setError(null)
    if (projectError || !parsedAmount.ok) return
    try {
      await add.mutateAsync({ projectId, role: trimOrNull(role), amountCents: parsedAmount.value })
      toast.success('Projet lié')
      onClose()
    } catch (e) {
      setError(partnerErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title="Lier un projet"
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="partner-project-form" loading={busy} disabled={projectsQuery.isLoading}>
            Lier
          </Button>
        </>
      }
    >
      <form id="partner-project-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {projectsQuery.isError ? (
          <p className={styles.error} role="alert">
            Impossible de charger les projets.
          </p>
        ) : null}
        <Field
          label="Projet"
          error={showErrors ? projectError : null}
          hint={!projectsQuery.isLoading && options.length === 0 ? 'Tous les projets sont déjà liés à ce partenaire.' : undefined}
        >
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy || projectsQuery.isLoading}>
            <option value="">{projectsQuery.isLoading ? 'Chargement…' : 'Choisir un projet'}</option>
            {options.map((project) => (
              <option key={project.id} value={project.id}>
                {project.client ? `${project.name} (${project.client.name})` : project.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.row}>
          <Field label="Rôle" hint="Facultatif : shooting, intégration…">
            <TextInput value={role} maxLength={200} onChange={(e) => setRole(e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
          <Field label="Montant facturé HT (€)" hint="Facultatif." error={showErrors ? amountError : null}>
            <TextInput inputMode="decimal" className={styles.number} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
