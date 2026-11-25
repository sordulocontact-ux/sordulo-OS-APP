import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionsMenu, Badge, BackLink, Button, EmptyState, ErrorState, LoadingState, Modal, useToast } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { PROJECT_ROLES, useHasRole } from '../auth/roles'
import { safeHref } from '../clients/clientUtils'
import { ProjectStatus } from '../projects/ProjectStatus'
import { AddPartnerProjectModal } from './AddPartnerProjectModal'
import { formatDayRate, formatRating, partnerSubtitle, totalPartnerAmount } from './partnerLogic'
import { PartnerFormModal } from './PartnerFormModal'
import {
  partnerErrorText,
  useDeletePartner,
  usePartner,
  usePartnerProjects,
  useRemovePartnerProject,
  useSetPartnerArchived,
  type PartnerProjectWithProject,
} from './usePartners'
import table from '../../components/ui/dataTable.module.css'
import styles from './partners.module.css'

function Value({ children, empty = 'Non renseigné' }: { children: string | null | undefined; empty?: string }) {
  return children ? <>{children}</> : <span className={styles.empty}>{empty}</span>
}

/** Fiche d'un partenaire : infos, note interne, projets sur lesquels il a travaillé. */
export function PartnerPage() {
  const { partnerId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const canWrite = useHasRole(PROJECT_ROLES)
  const partnerQuery = usePartner(partnerId)
  const linksQuery = usePartnerProjects(partnerId)
  const setArchived = useSetPartnerArchived()
  const remove = useDeletePartner()
  const removeLink = useRemovePartnerProject(partnerId ?? '')

  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [linkToRemove, setLinkToRemove] = useState<PartnerProjectWithProject | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const { data: partner, isLoading, isError, refetch } = partnerQuery
  if (isLoading) return <LoadingState label="Chargement du partenaire…" />
  if (isError) return <ErrorState message="Impossible de charger le partenaire." onRetry={() => void refetch()} />
  if (!partner) {
    return (
      <EmptyState
        title="Partenaire introuvable"
        text="Ce partenaire n’existe pas ou tu n’y as pas accès."
        action={<Link to="/partners">Retour au réseau</Link>}
      />
    )
  }

  const archived = partner.archived_at !== null
  const links = linksQuery.data ?? []
  const total = totalPartnerAmount(links)
  const website = safeHref(partner.website)

  async function toggleArchived() {
    if (!partner) return
    try {
      await setArchived.mutateAsync({ id: partner.id, archived: !archived })
      toast.success(archived ? 'Partenaire désarchivé' : 'Partenaire archivé')
    } catch (e) {
      toast.error(partnerErrorText(e))
    }
  }

  async function deletePartner() {
    if (!partner) return
    setDeleteError(null)
    try {
      await remove.mutateAsync(partner.id)
      toast.success('Partenaire supprimé')
      void navigate('/partners')
    } catch (e) {
      setDeleteError(partnerErrorText(e))
    }
  }

  async function unlink() {
    if (!linkToRemove) return
    setLinkError(null)
    try {
      await removeLink.mutateAsync(linkToRemove.id)
      toast.success('Projet retiré')
      setLinkToRemove(null)
    } catch (e) {
      setLinkError(partnerErrorText(e))
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/partners" label="Réseau" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{partner.name}</h1>
            {archived ? <Badge>Archivé</Badge> : null}
          </div>
          {canWrite ? (
            <div className={styles.actions}>
              <Button onClick={() => setEditing(true)}>Modifier</Button>
              <Button onClick={() => void toggleArchived()} loading={setArchived.isPending}>
                {archived ? 'Désarchiver' : 'Archiver'}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDeleteError(null)
                  setConfirmDelete(true)
                }}
              >
                Supprimer
              </Button>
            </div>
          ) : null}
        </div>
        <p className={styles.subtitle}>{partnerSubtitle(partner)}</p>
      </header>

      <section className={styles.section} aria-labelledby="partner-infos">
        <h2 id="partner-infos" className={styles.sectionTitle}>
          Infos
        </h2>
        <dl className={styles.infos}>
          <dt>Compétences</dt>
          <dd>
            {partner.skills.length > 0 ? (
              <span className={styles.skills}>
                {partner.skills.map((skill) => (
                  <Badge key={skill}>{skill}</Badge>
                ))}
              </span>
            ) : (
              <Value empty="Aucune">{null}</Value>
            )}
          </dd>
          <dt>Tarif jour indicatif</dt>
          <dd>
            <Value>{formatDayRate(partner.day_rate_cents)}</Value>
          </dd>
          <dt>Évaluation</dt>
          <dd>
            <Value empty="Non évalué">{formatRating(partner.rating)}</Value>
          </dd>
          <dt>Disponibilité</dt>
          <dd>
            <Value empty="Non renseignée">{partner.availability}</Value>
          </dd>
          <dt>Email</dt>
          <dd>
            {partner.email ? (
              <a href={`mailto:${partner.email}`} className={styles.link}>
                {partner.email}
              </a>
            ) : (
              <Value>{null}</Value>
            )}
          </dd>
          <dt>Téléphone</dt>
          <dd>
            {partner.phone ? (
              <a href={`tel:${partner.phone}`} className={styles.link}>
                {partner.phone}
              </a>
            ) : (
              <Value>{null}</Value>
            )}
          </dd>
          <dt>Site ou portfolio</dt>
          <dd>
            {website ? (
              <a href={website} target="_blank" rel="noreferrer" className={styles.link}>
                {partner.website}
              </a>
            ) : (
              <Value>{partner.website}</Value>
            )}
          </dd>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="partner-notes">
        <div className={styles.sectionHeader}>
          <h2 id="partner-notes" className={styles.sectionTitle}>
            Note interne
          </h2>
          {canWrite ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {partner.notes ? 'Modifier la note' : 'Ajouter une note'}
            </Button>
          ) : null}
        </div>
        <p className={styles.multiline}>
          <Value empty="Aucune note pour l’instant.">{partner.notes}</Value>
        </p>
      </section>

      <section className={styles.section} aria-labelledby="partner-projects">
        <div className={styles.sectionHeader}>
          <h2 id="partner-projects" className={styles.sectionTitle}>
            Projets
          </h2>
          {canWrite && links.length > 0 ? (
            <Button size="sm" onClick={() => setLinking(true)}>
              Lier un projet
            </Button>
          ) : null}
        </div>
        {linksQuery.isLoading ? (
          <LoadingState label="Chargement des projets…" />
        ) : linksQuery.isError ? (
          <ErrorState message="Impossible de charger les projets du partenaire." onRetry={() => void linksQuery.refetch()} />
        ) : links.length === 0 ? (
          <EmptyState
            title="Aucun projet lié"
            text={canWrite ? 'Note les projets sur lesquels ce partenaire a travaillé, avec son rôle et ce qu’il a facturé.' : undefined}
            action={
              canWrite ? (
                <Button variant="secondary" onClick={() => setLinking(true)}>
                  Lier un projet
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={table.scroll}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th scope="col">Projet</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Rôle</th>
                    <th scope="col" className={styles.num}>
                      Montant HT
                    </th>
                    {canWrite ? (
                      <th scope="col" className={table.actionsCell}>
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className={table.row}>
                      <td>
                        {link.project && canWrite ? (
                          <Link to={`/projects/${link.project.id}`} className={table.rowLink}>
                            {link.project.name}
                          </Link>
                        ) : (
                          <span className={table.primary}>{link.project?.name ?? 'Projet inaccessible'}</span>
                        )}
                      </td>
                      <td>{link.project ? <ProjectStatus status={link.project.status} /> : null}</td>
                      <td>{link.role ?? <span className={table.muted}>Non renseigné</span>}</td>
                      <td className={styles.num}>
                        {link.amount_cents === null ? <span className={table.muted}>Non renseigné</span> : formatMoney(link.amount_cents)}
                      </td>
                      {canWrite ? (
                        <td className={table.actionsCell}>
                          <ActionsMenu
                            label={`Actions pour ${link.project?.name ?? 'ce projet'}`}
                            items={[
                              {
                                label: 'Retirer du partenaire',
                                tone: 'danger',
                                onSelect: () => {
                                  setLinkError(null)
                                  setLinkToRemove(link)
                                },
                              },
                            ]}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total !== null ? <p className={styles.total}>Total facturé renseigné : {formatMoney(total)} HT</p> : null}
          </>
        )}
      </section>

      <PartnerFormModal open={editing} onClose={() => setEditing(false)} partner={partner} />
      <AddPartnerProjectModal open={linking} onClose={() => setLinking(false)} partnerId={partner.id} links={links} />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        dismissible={!remove.isPending}
        title="Supprimer ce partenaire ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void deletePartner()} loading={remove.isPending}>
              Supprimer
            </Button>
          </>
        }
      >
        <p>
          « {partner.name} » et ses liens aux projets seront supprimés. Cette action est définitive : pour le garder sans
          l’afficher dans le réseau, archive-le plutôt.
        </p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={linkToRemove !== null}
        onClose={() => setLinkToRemove(null)}
        dismissible={!removeLink.isPending}
        title="Retirer ce projet ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setLinkToRemove(null)} disabled={removeLink.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void unlink()} loading={removeLink.isPending}>
              Retirer
            </Button>
          </>
        }
      >
        <p>« {linkToRemove?.project?.name ?? 'Ce projet'} » ne sera plus lié à {partner.name}. Le projet lui-même n’est pas modifié.</p>
        {linkError ? (
          <p className={styles.error} role="alert">
            {linkError}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
