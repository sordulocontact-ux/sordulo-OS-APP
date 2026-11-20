import { useRef, useState } from 'react'
import { Button, Field, Modal, TextInput, useToast } from '../../components/ui'
import styles from './TeamPage.module.css'

export interface LoginLinkModalProps {
  name: string
  link: string
  onClose: () => void
}

/** Étape « Lien de connexion » : l'admin copie le lien et l'envoie lui-même, aucun email n'est envoyé. */
export function LoginLinkModal({ name, link, onClose }: LoginLinkModalProps) {
  const toast = useToast()
  const inputRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setFeedback('Lien copié.')
      toast.success('Lien copié.')
    } catch {
      // Presse-papiers indisponible : on sélectionne le texte pour que l'admin le copie lui-même.
      const input = inputRef.current?.querySelector('input')
      input?.focus()
      input?.select()
      setFeedback('Copie impossible ici : le lien est sélectionné, copie-le avec Ctrl+C (ou Cmd+C).')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Lien de connexion"
      actions={
        <Button variant="primary" onClick={onClose}>
          Terminé
        </Button>
      }
    >
      <Field label={`Lien de connexion de ${name}`}>
        <div className={styles.linkRow} ref={inputRef}>
          <TextInput readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="secondary" onClick={() => void copy()}>
            Copier le lien
          </Button>
        </div>
      </Field>
      <p className={styles.help}>
        Ce lien est à usage unique et expire dans 1 heure. Envoie-le toi-même à {name} : aucun email n’est envoyé.
      </p>
      <p className={styles.copied} role="status">
        {feedback}
      </p>
    </Modal>
  )
}
