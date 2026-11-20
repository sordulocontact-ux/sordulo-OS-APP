import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput, useToast } from '../../components/ui'
import type { ClientContact } from '../../shared/types'
import { emailError, trimOrNull } from './clientUtils'
import { errorText, useSaveContact } from './useClients'
import styles from './clients.module.css'

export interface ContactFormModalProps {
  open: boolean
  onClose: () => void
  clientId: string
  /** Contact à modifier ; absent = ajout. */
  contact?: ClientContact | null
  /** Premier contact du client : la case « principal » est cochée d'office. */
  isFirst?: boolean
}

interface Draft {
  name: string
  email: string
  phone: string
  role: string
  isPrimary: boolean
}

function initialDraft(contact: ClientContact | null | undefined, isFirst: boolean): Draft {
  return {
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    role: contact?.role ?? '',
    isPrimary: contact ? contact.is_primary : isFirst,
  }
}

export function ContactFormModal({ open, onClose, clientId, contact, isFirst = false }: ContactFormModalProps) {
  const toast = useToast()
  const save = useSaveContact(clientId)
  const [draft, setDraft] = useState<Draft>(() => initialDraft(contact, isFirst))
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(initialDraft(contact, isFirst))
      setShowErrors(false)
      setError(null)
      save.reset()
    }
  }

  const busy = save.isPending
  const nameError = draft.name.trim() === '' ? 'Indique le nom du contact.' : null
  const mailError = emailError(draft.email)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setShowErrors(true)
    if (nameError || mailError) return
    try {
      await save.mutateAsync({
        contactId: contact?.id,
        fields: {
          name: draft.name.trim(),
          email: trimOrNull(draft.email),
          phone: trimOrNull(draft.phone),
          role: trimOrNull(draft.role),
          is_primary: draft.isPrimary,
        },
      })
      toast.success(contact ? 'Contact modifié' : 'Contact ajouté')
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const submitLabel = contact ? 'Enregistrer' : 'Ajouter'

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={contact ? 'Modifier le contact' : 'Ajouter un contact'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="contact-form" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="contact-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Nom" error={showErrors ? nameError : null}>
          <TextInput
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            disabled={busy}
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Rôle" hint="Par exemple : directrice marketing.">
          <TextInput value={draft.role} onChange={(e) => set('role', e.target.value)} disabled={busy} />
        </Field>
        <div className={styles.row}>
          <Field label="Email" error={showErrors ? mailError : null}>
            <TextInput
              type="email"
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </Field>
          <Field label="Téléphone">
            <TextInput
              type="tel"
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </Field>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.isPrimary}
            onChange={(e) => set('isPrimary', e.target.checked)}
            disabled={busy}
          />
          Contact principal
        </label>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
