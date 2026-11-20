import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionsMenu, Avatar, Icon, Badge, Button, EmptyState, ErrorState, LoadingState, SearchField, StatCard, useToast } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { formatDate } from '../tickets/format'
import { ArchiveClientModal } from './ArchiveClientModal'
import { ClientFormModal } from './ClientFormModal'
import { clientStats, matchesQuery, primaryContact } from './clientUtils'
import { errorText, useClients, useToggleClientArchived, type ClientListItem } from './useClients'
import table from '../../components/ui/dataTable.module.css'
import styles from './clients.module.css'

export function ClientsPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useClients()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ClientListItem | null>(null)
  const [archiving, setArchiving] = useState<ClientListItem | null>(null)
  const toast = useToast()
  const toggleArchived = useToggleClientArchived()

  const visible = useMemo(
    () => (data ?? []).filter((c) => (showArchived || !c.archived_at) && matchesQuery(c, c.contacts, query)),
    [data, query, showArchived],
  )
  const stats = useMemo(() => clientStats(data ?? []), [data])
  const hasActive = (data ?? []).some((c) => !c.archived_at)

  async function unarchive(client: ClientListItem) {
    try {
      await toggleArchived.mutateAsync({ clientId: client.id, archived: false })
      toast.success('Client désarchivé')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouveau client
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="clients-title">
      <h1 id="clients-title">Clients</h1>
      {data && data.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={stats.active} label="Clients actifs" />
          <StatCard value={stats.withOngoingProject} label="Avec un projet en cours" />
          <StatCard value={stats.withoutPrimaryContact} label="Sans contact principal" />
          <StatCard value={stats.toComplete} label="Fiches à compléter" hint="SIRET ou adresse manquants" />
        </div>
      ) : null}
      <div className={table.toolbar}>
        <SearchField
          className={table.search}
          label="Rechercher un client"
          placeholder="Nom, ville, SIRET, contact"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className={styles.check}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Afficher les archivés
        </label>
        <div className={table.toolbarEnd}>{newButton}</div>
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
              <th scope="col" className={table.actionsCell}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((client) => {
              const contact = primaryContact(client.contacts)
              return (
                <tr key={client.id} className={[table.row, client.archived_at ? table.inactive : ''].join(' ')}>
                  <td>
                    <span className={styles.nameCell}>
                      <Avatar name={client.name} size="sm" />
                      <Link to={`/clients/${client.id}`} className={table.rowLink}>
                        {client.name}
                      </Link>
                      {client.archived_at ? <Badge>Archivé</Badge> : null}
                    </span>
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
                  <td className={table.actionsCell}>
                    <ActionsMenu
                      label={`Actions pour ${client.name}`}
                      items={[
                        { label: 'Modifier', onSelect: () => setEditing(client) },
                        client.archived_at
                          ? { label: 'Désarchiver', onSelect: () => void unarchive(client), disabled: toggleArchived.isPending }
                          : { label: 'Archiver', onSelect: () => setArchiving(client) },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <ClientFormModal open={editing !== null} onClose={() => setEditing(null)} client={editing} />
      {archiving ? <ArchiveClientModal client={archiving} onClose={() => setArchiving(null)} /> : null}
      <ClientFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(client) => void navigate(`/clients/${client.id}`)}
      />
    </section>
  )
}
