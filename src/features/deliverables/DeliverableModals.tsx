import { useId, useState, type FormEvent } from 'react'
import { Button, Field, Modal, Textarea, TextInput } from '../../components/ui'
import { DELIVERABLE_ACCEPT, validateDeliverableFile } from './deliverableLogic'
import styles from './ProjectDeliverablesTab.module.css'

export interface DeliverableFormValues {
  title: string
  description: string | null
}

interface DeliverableFormModalProps {
  open: boolean
  onClose: () => void
  /** Valeurs de départ (modification) ; absent = création. */
  initial?: DeliverableFormValues
  saving: boolean
  onSubmit: (values: DeliverableFormValues) => void
}

/** Création ou modification d'un livrable : titre et description (visibles par le client). */
export function DeliverableFormModal({ open, onClose, initial, saving, onSubmit }: DeliverableFormModalProps) {
  const formId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Modifier le livrable' : 'Nouveau livrable'}
      actions={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" form={formId} loading={saving}>
            {initial ? 'Enregistrer' : 'Créer le livrable'}
          </Button>
        </>
      }
    >
      {/* Le contenu n'est monté qu'à l'ouverture : le formulaire repart des valeurs de départ. */}
      <DeliverableForm formId={formId} initial={initial} onSubmit={onSubmit} />
    </Modal>
  )
}

function DeliverableForm({
  formId,
  initial,
  onSubmit,
}: {
  formId: string
  initial?: DeliverableFormValues
  onSubmit: (values: DeliverableFormValues) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const clean = title.trim()
    if (!clean) {
      setError('Donne un titre au livrable.')
      return
    }
    onSubmit({ title: clean, description: description.trim() || null })
  }

  return (
    <form id={formId} className={styles.form} onSubmit={submit}>
      <Field label="Titre" error={error} hint="Par exemple « Maquettes de l’accueil » ou « Logo ».">
        <TextInput value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} autoFocus />
      </Field>
      <Field label="Description" hint="Facultative. Visible par le client sur le portail.">
        <Textarea rows={3} value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} />
      </Field>
    </form>
  )
}

interface VersionUploadModalProps {
  open: boolean
  onClose: () => void
  /** Numéro de la version qui sera créée. */
  nextVersion: number
  deliverableTitle: string
  saving: boolean
  onSubmit: (values: { file: File; note: string | null }) => void
}

/** Envoi d'une nouvelle version : une image ou un PDF, et une note pour le client. */
export function VersionUploadModal({ open, onClose, nextVersion, deliverableTitle, saving, onSubmit }: VersionUploadModalProps) {
  const formId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={`Envoyer la V${nextVersion} de « ${deliverableTitle} »`}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving}>
            Envoyer la V{nextVersion}
          </Button>
        </>
      }
    >
      <VersionForm formId={formId} onSubmit={onSubmit} />
    </Modal>
  )
}

function VersionForm({ formId, onSubmit }: { formId: string; onSubmit: (values: { file: File; note: string | null }) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choisis le fichier de cette version.')
      return
    }
    const invalid = validateDeliverableFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    onSubmit({ file, note: note.trim() || null })
  }

  return (
    <form id={formId} className={styles.form} onSubmit={submit}>
      <Field label="Fichier" error={error} hint="Image (PNG, JPG, WebP…) ou PDF, 100 Mo au plus. Rangé dans Fichiers › Livrables.">
        <TextInput
          type="file"
          accept={DELIVERABLE_ACCEPT}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null
            setFile(chosen)
            setError(chosen ? validateDeliverableFile(chosen) : null)
          }}
        />
      </Field>
      <Field label="Note pour le client" hint="Facultative. Ce qui a changé, ce qu’il doit regarder. Visible sur le portail.">
        <Textarea rows={3} value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </form>
  )
}
