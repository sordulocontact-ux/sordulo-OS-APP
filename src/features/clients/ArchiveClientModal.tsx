import { Button, Modal, useToast } from '../../components/ui'
import { errorText, useToggleClientArchived, type ClientListItem } from './useClients'
import styles from './clients.module.css'

/** Confirmation d'archivage depuis la liste (même texte que la fiche client). */
export function ArchiveClientModal({ client, onClose }: { client: Pick<ClientListItem, 'id' | 'name'>; onClose: () => void }) {
  const toast = useToast()
  const archive = useToggleClientArchived()

  async function confirm() {
    try {
      await archive.mutateAsync({ clientId: client.id, archived: true })
      toast.success('Client archivé')
      onClose()
    } catch {
      // L'erreur est affichée dans la modale (archive.error).
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!archive.isPending}
      title="Archiver ce client ?"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={archive.isPending}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => void confirm()} loading={archive.isPending}>
            Archiver
          </Button>
        </>
      }
    >
      <p>
        « {client.name} » n’apparaîtra plus dans la liste des clients, sauf si tu coches « Afficher les archivés ». Ses
        projets restent visibles et tu peux le désarchiver quand tu veux.
      </p>
      {archive.isError ? (
        <p className={styles.error} role="alert">
          {errorText(archive.error)}
        </p>
      ) : null}
    </Modal>
  )
}
