import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, ErrorState, Field, Icon, ListToolbar, LoadingState, Select } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import table from '../../components/ui/dataTable.module.css'
import { CONTRACT_STATUSES, LABELS } from '../../shared/types'
import { filterContracts, parseContractStatus, sortContracts, type ContractWithLinks } from './contractLogic'
import { ContractsTable } from './ContractsTable'
import { DeleteContractModal } from './DeleteContractModal'
import { NewContractModal } from './NewContractModal'
import { useContracts } from './useContracts'

/** Liste globale des contrats, filtre par statut (`?statut=`). */
export function ContractsPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useContracts()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<ContractWithLinks | null>(null)
  const status = parseContractStatus(params.get('statut'))
  const visible = useMemo(() => sortContracts(filterContracts(data ?? [], { query, status })), [data, query, status])

  function setStatus(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('statut', value)
    else next.delete('statut')
    setParams(next, { replace: true })
  }

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouveau contrat
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="contracts-title">
      <h1 id="contracts-title">Contrats</h1>
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un contrat', placeholder: 'Titre, client, projet' }}
        activeFilterCount={status !== '' ? 1 : 0}
        onResetFilters={() => setStatus('')}
        onAdd={() => setCreating(true)}
        addLabel="Nouveau contrat"
        filters={
          <Field label="Statut">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous les statuts</option>
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABELS.contractStatus[s]}
                </option>
              ))}
            </Select>
          </Field>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des contrats…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les contrats." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucun contrat" text="Un contrat se rédige à partir d’un devis accepté." action={newButton} />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun contrat ne correspond à la recherche ni aux filtres." />
      ) : (
        <ContractsTable contracts={visible} showProject onDelete={setToDelete} />
      )}
      {creating ? <NewContractModal open onClose={() => setCreating(false)} onCreated={(id) => void navigate(`/contracts/${id}`)} /> : null}
      <DeleteContractModal contract={toDelete} onClose={() => setToDelete(null)} />
    </section>
  )
}
