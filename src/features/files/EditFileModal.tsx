import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput } from '../../components/ui'
import type { ProjectFile } from '../../shared/types'
import { cleanFileName, cleanFolderName } from './fileLogic'
import styles from './files.module.css'

export interface EditFileModalProps {
  file: ProjectFile | null
  folders: readonly string[]
  busy: boolean
  onSave: (file: ProjectFile, changes: { name: string; folder: string }) => void
  onClose: () => void
}

/** Renommer un fichier et/ou le changer de dossier (dossier libre accepté). */
export function EditFileModal({ file, folders, busy, onSave, onClose }: EditFileModalProps) {
  return (
    <Modal open={file !== null} onClose={onClose} title="Renommer ou déplacer" dismissible={!busy}>
      {file ? <EditForm key={file.id} file={file} folders={folders} busy={busy} onSave={onSave} onClose={onClose} /> : null}
    </Modal>
  )
}

function EditForm({ file, folders, busy, onSave, onClose }: Omit<EditFileModalProps, 'file'> & { file: ProjectFile }) {
  const [name, setName] = useState(file.name)
  const [folder, setFolder] = useState(file.folder)
  const [error, setError] = useState<string | null>(null)
  const listId = `folders-${file.id}`

  function submit(event: FormEvent) {
    event.preventDefault()
    const cleanName = cleanFileName(name)
    if (!cleanName.ok) return setError(cleanName.error)
    const cleanFolder = cleanFolderName(folder)
    if (!cleanFolder.ok) return setError(cleanFolder.error)
    setError(null)
    onSave(file, { name: cleanName.value, folder: cleanFolder.value })
  }

  return (
    <form onSubmit={submit} noValidate className={styles.form}>
      <Field label="Nom" error={error}>
        <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required />
      </Field>
      <Field label="Dossier" hint="Choisis un dossier existant ou écris-en un nouveau.">
        <TextInput value={folder} onChange={(event) => setFolder(event.target.value)} list={listId} maxLength={80} required />
        <datalist id={listId}>
          {folders.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" loading={busy}>
          Enregistrer
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Annuler
        </Button>
      </div>
    </form>
  )
}
