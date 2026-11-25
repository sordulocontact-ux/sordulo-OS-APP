import { Button, Modal, useToast } from '../../components/ui'
import { contractErrorText } from './contractLogic'
import { useDeleteContract } from './useContracts'

export interface DeleteContractModalProps {
  contract: { id: string; title: string } | null
  onClose: () => void
  onDeleted?: () => void
}

export function DeleteContractModal({ contract, onClose, onDeleted }: DeleteContractModalProps) {
  const toast = useToast()
  const remove = useDeleteContract()

  async function destroy() {
    if (!contract) return
    try {
      await remove.mutateAsync(contract.id)
      toast.success('Contrat supprimé')
      onClose()
      onDeleted?.()
    } catch (e) {
      toast.error(contractErrorText(e))
    }
  }

  return (
    <Modal
      open={contract !== null}
      onClose={onClose}
      title="Supprimer ce contrat ?"
      dismissible={!remove.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            Annuler
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void destroy()}>
            Supprimer
          </Button>
        </>
      }
    >
      <p>Le brouillon « {contract?.title} » sera supprimé définitivement.</p>
    </Modal>
  )
}
