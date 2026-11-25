import { Link, useNavigate } from 'react-router-dom'
import { ActionsMenu, Badge } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { formatDate } from '../../shared/billing'
import { LABELS } from '../../shared/types'
import { canDeleteContract, CONTRACT_TONE, type ContractWithLinks } from './contractLogic'
import styles from './contracts.module.css'

export interface ContractsTableProps {
  contracts: readonly ContractWithLinks[]
  showProject: boolean
  onDelete: (contract: ContractWithLinks) => void
}

/** Tableau des contrats (liste globale et onglet du projet). */
export function ContractsTable({ contracts, showProject, onDelete }: ContractsTableProps) {
  const navigate = useNavigate()
  return (
    <div className={table.scroll}>
      <table className={table.table}>
        <thead>
          <tr>
            <th scope="col">Contrat</th>
            <th scope="col">Client</th>
            {showProject ? <th scope="col">Projet</th> : null}
            <th scope="col">Statut</th>
            <th scope="col">Date</th>
            <th scope="col" className={table.actionsCell}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id} className={table.row}>
              <td>
                <span className={styles.titleCell}>
                  <Link to={`/contracts/${c.id}`} className={table.rowLink}>
                    {c.title}
                  </Link>
                </span>
              </td>
              <td>{c.client?.name ?? <span className={table.muted}>Client inconnu</span>}</td>
              {showProject ? <td>{c.project?.name ?? <span className={table.muted}>Sans projet</span>}</td> : null}
              <td>
                <Badge tone={CONTRACT_TONE[c.status]}>{LABELS.contractStatus[c.status]}</Badge>
              </td>
              <td>{formatDate((c.signed_at ?? c.sent_at ?? c.created_at).slice(0, 10))}</td>
              <td className={table.actionsCell}>
                <ActionsMenu
                  label={`Actions pour le contrat ${c.title}`}
                  items={[
                    { label: 'Ouvrir', onSelect: () => void navigate(`/contracts/${c.id}`) },
                    { label: 'Aperçu PDF', onSelect: () => void navigate(`/contracts/${c.id}/print`) },
                    ...(canDeleteContract(c.status) ? [{ label: 'Supprimer', tone: 'danger' as const, onSelect: () => onDelete(c) }] : []),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
