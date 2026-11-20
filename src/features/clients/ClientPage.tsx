import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, BackLink, Button, EmptyState, ErrorState, LoadingState, Modal, useToast } from '../../components/ui'
import type { ClientContact } from '../../shared/types'
import { ProjectFormModal, ProjectStatus } from '../projects'
import { formatDate } from '../tickets/format'
import { ClientFormModal } from './ClientFormModal'
import { ContactFormModal } from './ContactFormModal'
import { formatSiret, safeHref } from './clientUtils'
import {
  errorText,
  useClient,
  useClientContacts,
  useClientProjects,
  useDeleteContact,
  useSetClientArchived,
  useSetPrimaryContact,
} from './useClients'
import table from '../../components/ui/dataTable.module.css'
import styles from './clients.module.css'

function Value({ children }: { children: string | null | undefined }) {
  return children ? <>{children}</> : <span className={styles.empty}>Non renseigné</span>
}

export function ClientPage() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const clientQuery = useClient(clientId)
  const contactsQuery = useClientContacts(clientId)
  const projectsQuery = useClientProjects(clientId)
  const archive = useSetClientArchived(clientId ?? '')
  const setPrimary = useSetPrimaryContact(clientId ?? '')
  const deleteContact = useDeleteContact(clientId ?? '')

  const [editing, setEditing] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [contactModal, setContactModal] = useState<{ contact: ClientContact | null } | null>(null)
  const [contactToDelete, setContactToDelete] = useState<ClientContact | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)

  const { data: client, isLoading, isError, refetch } = clientQuery
  if (isLoading) return <LoadingState label="Chargement du client…" />
  if (isError) return <ErrorState message="Impossible de charger le client." onRetry={() => void refetch()} />
  if (!client) {
    return (
      <EmptyState
        title="Client introuvable"
        text="Ce client n'existe pas ou tu n'y as pas accès."
        action={<Link to="/clients">Retour aux clients</Link>}
      />
    )
  }

  const archived = client.archived_at !== null
  const contacts = contactsQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const website = safeHref(client.website)
  const address = [
    client.billing_street,
    [client.billing_postal_code, client.billing_city].filter(Boolean).join(' '),
    client.billing_country,
  ].filter((line): line is string => Boolean(line))

  async function toggleArchive() {
    setArchiveError(null)
    try {
      await archive.mutateAsync(!archived)
      toast.success(archived ? 'Client désarchivé' : 'Client archivé')
      setConfirmArchive(false)
    } catch (e) {
      setArchiveError(errorText(e))
    }
  }

  async function makePrimary(contact: ClientContact) {
    setContactsError(null)
    try {
      await setPrimary.mutateAsync(contact.id)
      toast.success('Contact principal défini')
    } catch (e) {
      setContactsError(errorText(e))
    }
  }

  async function removeContact() {
    if (!contactToDelete) return
    setDeleteError(null)
    try {
      await deleteContact.mutateAsync(contactToDelete.id)
      toast.success('Contact supprimé')
      setContactToDelete(null)
    } catch (e) {
      setDeleteError(errorText(e))
    }
  }

  const newProjectButton = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} onClick={() => setCreatingProject(true)}>
      Nouveau projet
    </Button>
  )

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/clients" label="Clients" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{client.name}</h1>
            {archived ? <Badge>Archivé</Badge> : null}
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
            <Button
              onClick={() => {
                setArchiveError(null)
                if (archived) void toggleArchive()
                else setConfirmArchive(true)
              }}
              loading={archived && archive.isPending}
            >
              {archived ? 'Désarchiver' : 'Archiver'}
            </Button>
            {newProjectButton('primary')}
          </div>
        </div>
        {archived && archiveError ? (
          <p className={styles.error} role="alert">
            {archiveError}
          </p>
        ) : null}
      </header>

      <section className={styles.section} aria-labelledby="client-infos">
        <h2 id="client-infos" className={styles.sectionTitle}>
          Infos
        </h2>
        <dl className={styles.infos}>
          <dt>SIRET</dt>
          <dd>
            <Value>{formatSiret(client.siret)}</Value>
          </dd>
          <dt>Adresse de facturation</dt>
          <dd className={styles.multiline}>
            <Value>{address.length > 0 ? address.join('\n') : null}</Value>
          </dd>
          <dt>Site web</dt>
          <dd>
            {website ? (
              <a href={website} target="_blank" rel="noreferrer" className={styles.link}>
                {client.website}
              </a>
            ) : (
              <Value>{client.website}</Value>
            )}
          </dd>
          <dt>Notes</dt>
          <dd className={styles.multiline}>
            <Value>{client.notes}</Value>
          </dd>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="client-contacts">
        <div className={styles.sectionHeader}>
          <h2 id="client-contacts" className={styles.sectionTitle}>
            Contacts
          </h2>
          <Button size="sm" onClick={() => setContactModal({ contact: null })}>
            Ajouter un contact
          </Button>
        </div>
        {contactsError ? (
          <p className={styles.error} role="alert">
            {contactsError}
          </p>
        ) : null}
        {contactsQuery.isLoading ? (
          <LoadingState label="Chargement des contacts…" />
        ) : contactsQuery.isError ? (
          <ErrorState message="Impossible de charger les contacts." onRetry={() => void contactsQuery.refetch()} />
        ) : contacts.length === 0 ? (
          <EmptyState title="Aucun contact" text="Ajoute la personne à qui écrire chez ce client." />
        ) : (
          <ul className={styles.contacts}>
            {contacts.map((contact) => (
              <li key={contact.id} className={styles.contact}>
                <div className={styles.contactMain}>
                  <span className={styles.contactName}>
                    {contact.name}
                    {contact.is_primary ? <Badge tone="primary">Principal</Badge> : null}
                  </span>
                  <span className={styles.contactMeta}>
                    {contact.role ? <span>{contact.role}</span> : null}
                    {contact.email ? <a href={`mailto:${contact.email}`} className={styles.link}>{contact.email}</a> : null}
                    {contact.phone ? <a href={`tel:${contact.phone}`} className={styles.link}>{contact.phone}</a> : null}
                  </span>
                </div>
                <div className={styles.actions}>
                  {contact.is_primary ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void makePrimary(contact)}
                      loading={setPrimary.isPending && setPrimary.variables === contact.id}
                      disabled={setPrimary.isPending}
                    >
                      Définir comme principal
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setContactModal({ contact })}>
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleteError(null)
                      setContactToDelete(contact)
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="client-projects">
        <h2 id="client-projects" className={styles.sectionTitle}>
          Projets du client
        </h2>
        {projectsQuery.isLoading ? (
          <LoadingState label="Chargement des projets…" />
        ) : projectsQuery.isError ? (
          <ErrorState message="Impossible de charger les projets." onRetry={() => void projectsQuery.refetch()} />
        ) : projects.length === 0 ? (
          <EmptyState title="Aucun projet pour ce client" action={newProjectButton('secondary')} />
        ) : (
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Projet</th>
                <th scope="col">Statut</th>
                <th scope="col">Échéance</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className={table.row}>
                  <td>
                    <Link to={`/projects/${project.id}`} className={table.rowLink}>
                      {project.name}
                    </Link>
                  </td>
                  <td>
                    <ProjectStatus status={project.status} />
                  </td>
                  <td>
                    {project.due_date ? (
                      formatDate(`${project.due_date}T00:00:00`)
                    ) : (
                      <span className={table.muted}>Non renseignée</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ClientFormModal open={editing} onClose={() => setEditing(false)} client={client} />
      <ContactFormModal
        open={contactModal !== null}
        onClose={() => setContactModal(null)}
        clientId={client.id}
        contact={contactModal?.contact}
        isFirst={contacts.length === 0}
      />
      <ProjectFormModal
        open={creatingProject}
        onClose={() => setCreatingProject(false)}
        defaultClientId={client.id}
        onSaved={(project) => void navigate(`/projects/${project.id}`)}
      />

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        dismissible={!archive.isPending}
        title="Archiver ce client ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmArchive(false)} disabled={archive.isPending}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void toggleArchive()} loading={archive.isPending}>
              Archiver
            </Button>
          </>
        }
      >
        <p>
          « {client.name} » n’apparaîtra plus dans la liste des clients, sauf si tu coches « Afficher les archivés ». Ses
          projets restent visibles et tu peux le désarchiver quand tu veux.
        </p>
        {archiveError ? (
          <p className={styles.error} role="alert">
            {archiveError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={contactToDelete !== null}
        onClose={() => setContactToDelete(null)}
        dismissible={!deleteContact.isPending}
        title="Supprimer ce contact ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setContactToDelete(null)} disabled={deleteContact.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void removeContact()} loading={deleteContact.isPending}>
              Supprimer
            </Button>
          </>
        }
      >
        <p>« {contactToDelete?.name} » sera supprimé de ce client. Cette action est définitive.</p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
