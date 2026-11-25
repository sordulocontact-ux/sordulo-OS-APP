import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionsMenu, Badge, Button, EmptyState, ErrorState, Field, Icon, ListToolbar, LoadingState, Select, useToast } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { LABELS, type Partner, type PartnerCategory } from '../../shared/types'
import { PROJECT_ROLES, useHasRole } from '../auth/roles'
import {
  activePartnerFilterCount,
  EMPTY_PARTNER_FILTERS,
  filterPartners,
  formatDayRate,
  formatRating,
  PARTNER_CATEGORY_OPTIONS,
  partnerSkills,
  type PartnerFilters,
} from './partnerLogic'
import { PartnerFormModal } from './PartnerFormModal'
import { partnerErrorText, usePartners, useSetPartnerArchived } from './usePartners'
import table from '../../components/ui/dataTable.module.css'
import styles from './partners.module.css'

/** Nombre d'étiquettes montrées dans une ligne avant « +N ». */
const SKILLS_IN_ROW = 3

/** Réseau de partenaires : freelances, sous-traitants, imprimeurs, photographes, apporteurs… */
export function PartnersPage() {
  const { data, isLoading, isError, refetch } = usePartners()
  const toast = useToast()
  const navigate = useNavigate()
  // Écriture : admin, membre ; finance lit seulement (la RLS le refuse aussi).
  const canWrite = useHasRole(PROJECT_ROLES)
  const [filters, setFilters] = useState<PartnerFilters>(EMPTY_PARTNER_FILTERS)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const setArchived = useSetPartnerArchived()

  const partners = useMemo(() => data ?? [], [data])
  const skills = useMemo(() => partnerSkills(partners), [partners])
  const visible = useMemo(() => filterPartners(partners, filters), [partners, filters])

  function setFilter<K extends keyof PartnerFilters>(key: K, value: PartnerFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  async function toggleArchived(partner: Partner) {
    const archived = partner.archived_at === null
    try {
      await setArchived.mutateAsync({ id: partner.id, archived })
      toast.success(archived ? 'Partenaire archivé' : 'Partenaire désarchivé')
    } catch (e) {
      toast.error(partnerErrorText(e))
    }
  }

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouveau partenaire
    </Button>
  ) : undefined

  return (
    <section className={table.page} aria-labelledby="partners-title">
      <h1 id="partners-title">Réseau</h1>
      <ListToolbar
        search={{
          value: filters.query,
          onChange: (value) => setFilter('query', value),
          label: 'Rechercher un partenaire',
          placeholder: 'Nom, société, ville, compétence',
        }}
        activeFilterCount={activePartnerFilterCount(filters)}
        onResetFilters={() => setFilters((f) => ({ ...EMPTY_PARTNER_FILTERS, query: f.query }))}
        onAdd={canWrite ? () => setCreating(true) : undefined}
        addLabel="Nouveau partenaire"
        filters={
          <>
            <Field label="Métier">
              <Select value={filters.category} onChange={(e) => setFilter('category', e.target.value as PartnerCategory | '')}>
                <option value="">Tous</option>
                {PARTNER_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Compétence">
              <Select value={filters.skill} onChange={(e) => setFilter('skill', e.target.value)}>
                <option value="">Toutes</option>
                {skills.map((skill) => (
                  <option key={skill} value={skill}>
                    {skill}
                  </option>
                ))}
              </Select>
            </Field>
            <label className={styles.check}>
              <input type="checkbox" checked={filters.showArchived} onChange={(e) => setFilter('showArchived', e.target.checked)} />
              Afficher les archivés
            </label>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement du réseau…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger le réseau." onRetry={() => void refetch()} />
      ) : partners.length === 0 ? (
        <EmptyState
          title="Aucun partenaire"
          text={canWrite ? 'Ajoute les freelances, sous-traitants, imprimeurs ou photographes avec qui l’agence travaille.' : undefined}
          action={newButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun partenaire ne correspond à la recherche ni aux filtres." />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Partenaire</th>
                <th scope="col">Métier</th>
                <th scope="col">Compétences</th>
                <th scope="col" className={styles.num}>
                  Tarif jour
                </th>
                <th scope="col">Évaluation</th>
                <th scope="col">Disponibilité</th>
                {canWrite ? (
                  <th scope="col" className={table.actionsCell}>
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((partner) => {
                const archived = partner.archived_at !== null
                const extra = partner.skills.length - SKILLS_IN_ROW
                return (
                  <tr key={partner.id} className={[table.row, archived ? table.inactive : ''].join(' ')}>
                    <td>
                      <span className={styles.nameCell}>
                        <Link to={`/partners/${partner.id}`} className={table.rowLink}>
                          {partner.name}
                        </Link>
                        {partner.company || partner.city ? (
                          <span className={table.secondLine}>{[partner.company, partner.city].filter(Boolean).join(' · ')}</span>
                        ) : null}
                        {archived ? <Badge>Archivé</Badge> : null}
                      </span>
                    </td>
                    <td>{LABELS.partnerCategory[partner.category]}</td>
                    <td>
                      {partner.skills.length === 0 ? (
                        <span className={table.muted}>Aucune</span>
                      ) : (
                        <span className={styles.skills}>
                          {partner.skills.slice(0, SKILLS_IN_ROW).map((skill) => (
                            <Badge key={skill}>{skill}</Badge>
                          ))}
                          {extra > 0 ? <Badge aria-label={`et ${extra} autres`}>+{extra}</Badge> : null}
                        </span>
                      )}
                    </td>
                    <td className={styles.num}>{formatDayRate(partner.day_rate_cents) ?? <span className={table.muted}>Non renseigné</span>}</td>
                    <td>{formatRating(partner.rating) ?? <span className={table.muted}>Non évalué</span>}</td>
                    <td>{partner.availability ?? <span className={table.muted}>Non renseignée</span>}</td>
                    {canWrite ? (
                      <td className={table.actionsCell}>
                        <ActionsMenu
                          label={`Actions pour ${partner.name}`}
                          items={[
                            { label: 'Ouvrir la fiche', onSelect: () => void navigate(`/partners/${partner.id}`) },
                            { label: 'Modifier', onSelect: () => setEditing(partner) },
                            {
                              label: archived ? 'Désarchiver' : 'Archiver',
                              onSelect: () => void toggleArchived(partner),
                              disabled: setArchived.isPending,
                            },
                          ]}
                        />
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <PartnerFormModal
        open={creating}
        onClose={() => setCreating(false)}
        knownSkills={skills}
        onSaved={(partner) => void navigate(`/partners/${partner.id}`)}
      />
      <PartnerFormModal key={editing?.id ?? 'none'} open={editing !== null} onClose={() => setEditing(null)} partner={editing} knownSkills={skills} />
    </section>
  )
}
