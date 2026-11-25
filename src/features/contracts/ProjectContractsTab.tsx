import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState, Icon, LoadingState } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { useProjectContext } from '../projects/useProjectContext'
import { sortContracts, type ContractWithLinks } from './contractLogic'
import { ContractsTable } from './ContractsTable'
import { DeleteContractModal } from './DeleteContractModal'
import { NewContractModal } from './NewContractModal'
import { useContracts } from './useContracts'
import styles from './contracts.module.css'

/** Onglet « Contrats » de la page projet. */
export function ProjectContractsTab() {
  const { project } = useProjectContext()
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useContracts(project.id)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<ContractWithLinks | null>(null)

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouveau contrat
    </Button>
  )

  return (
    <section className={styles.section} aria-label="Contrats du projet">
      {data && data.length > 0 ? <div className={styles.actions}>{newButton}</div> : null}
      {isLoading ? (
        <LoadingState label="Chargement des contrats…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les contrats." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Aucun contrat pour ce projet"
          text={project.client_id ? 'Rédige-le depuis un devis accepté, ou pars d’un contrat vierge.' : 'Rattache d’abord le projet à un client.'}
          action={project.client_id ? newButton : undefined}
        />
      ) : (
        <ContractsTable contracts={sortContracts(data)} showProject={false} onDelete={setToDelete} />
      )}
      {creating ? (
        <NewContractModal
          open
          onClose={() => setCreating(false)}
          projectId={project.id}
          projectClientId={project.client_id}
          onCreated={(id) => void navigate(`/contracts/${id}`)}
        />
      ) : null}
      <DeleteContractModal contract={toDelete} onClose={() => setToDelete(null)} />
    </section>
  )
}
