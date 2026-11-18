import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button, Modal, useToast, type ButtonSize } from '../../components/ui'
import { api, ApiRequestError } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import type { Input } from '../../shared/types'
import { inputTitle } from './inputUtils'
import styles from './DeleteInputButton.module.css'

export interface DeleteInputButtonProps {
  input: Input
  size?: ButtonSize
  /** Après suppression, revenir à la liste des entrées (depuis la page de détail). */
  goBackAfter?: boolean
}

/** Bouton « Supprimer » + fenêtre de confirmation. Les tickets validés restent dans le projet. */
export function DeleteInputButton({ input, size = 'md', goBackAfter = false }: DeleteInputButtonProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = inputTitle(input)

  async function confirm() {
    setDeleting(true)
    setError(null)
    try {
      const result = await api.deleteInput({ inputId: input.id })
      setOpen(false)
      toast.success(
        result.keptTickets > 0
          ? `Entrée supprimée. ${result.keptTickets} ticket${result.keptTickets > 1 ? 's' : ''} validé${result.keptTickets > 1 ? 's' : ''} conservé${result.keptTickets > 1 ? 's' : ''}.`
          : 'Entrée supprimée.',
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inputs(input.project_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets(input.project_id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(input.project_id) }),
      ])
      queryClient.removeQueries({ queryKey: queryKeys.input(input.id) })
      queryClient.removeQueries({ queryKey: queryKeys.inputTickets(input.id) })
      if (goBackAfter) void navigate(`/projects/${input.project_id}/inputs`, { replace: true })
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Impossible de supprimer cette entrée. Réessaie.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)} aria-label={`Supprimer l'entrée « ${name} »`}>
        Supprimer
      </Button>
      <Modal
        open={open}
        onClose={() => !deleting && setOpen(false)}
        dismissible={!deleting}
        title="Supprimer cette entrée ?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={deleting}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void confirm()} loading={deleting}>
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <p>
          « {name} » sera supprimée, avec ses tickets encore proposés
          {input.kind === 'meeting' ? ', sa transcription et son fichier audio' : ''}.
        </p>
        <p>Les tickets déjà validés et leurs tâches restent dans le projet. Cette action est définitive.</p>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  )
}
