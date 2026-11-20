import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, LoadingState, SearchField } from '../../components/ui'
import { formatDate } from '../tickets/format'
import { ClientFormModal } from './ClientFormModal'
import { matchesQuery, primaryContact } from './clientUtils'
import { useClients } from './useClients'
import table from '../../components/ui/dataTable.module.css'
import styles from './clients.module.css'

export function ClientsPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useClients()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const visible = useMemo(
    () => (data ?? []).filter((c) => (showArchived || !c.archived_at) && matchesQuery(c, c.contacts, query)),
    [data, query, showArchived],
  )
  const hasActive = (data ?? []).some((c) => !c.archived_at)

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      Nouveau client
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="clients-title">
      <h1 id="clients-title">Clients</h1>
      <div className={table.toolbar}>
        <SearchField
          label="Rechercher un client"
          placeholder="Nom, ville, SIRET, contact"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Afficher les archivés
        </label>
        {newButton}
      </div>
      {isLoading ? (
        <LoadingState label="Chargement des clients…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les clients." onRetry={() => void refetch()} />
      ) : !data || (!hasActive && !showArchived) ? (
        <EmptyState
          title="Aucun client"
          text={
            data && data.length > 0
              ? 'Tous tes clients sont archivés. Coche « Afficher les archivés » pour les voir.'
              : 'Ajoute ton premier client pour lui créer des projets.'
          }
          action={newButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun client ne correspond à la recherche." />
      ) : (
        <table className={table.table}>
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Contact principal</th>
              <th scope="col">Ville</th>
              <th scope="col">Projets</th>
              <th scope="col">Créé le</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((client) => {
              const contact = primaryContact(client.contacts)
              return (
                <tr key={client.id} className={[table.row, client.archived_at ? table.inactive : ''].join(' ')}>
                  <td>
                    <Link to={`/clients/${client.id}`} className={table.rowLink}>
                      {client.name}
                    </Link>
                    {client.archived_at ? (
                      <>
                        {' '}
                        <Badge>Archivé</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {contact ? (
                      <>
                        <div>{contact.name}</div>
                        {contact.email ? <div className={table.muted}>{contact.email}</div> : null}
                      </>
                    ) : (
                      <span className={table.muted}>Aucun contact</span>
                    )}
                  </td>
                  <td>{client.billing_city ?? <span className={table.muted}>Non renseignée</span>}</td>
                  <td>{client.projects[0]?.count ?? 0}</td>
                  <td>{formatDate(client.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <ClientFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(client) => void navigate(`/clients/${client.id}`)}
      />
    </section>
  )
}
