import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ActionsMenu, Badge, Button, EmptyState, ErrorState, Field, Icon, ListToolbar, LoadingState, Select, useToast } from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { formatMoney } from '../../shared/billing'
import { LABELS, type Service } from '../../shared/types'
import { PROJECT_ROLES, FINANCE_ROLES, useHasRole } from '../auth/roles'
import { filterServices, nextServicePosition, serviceCategories, STATUS_FILTER_LABELS, type ServiceStatusFilter } from './catalogLogic'
import { ServiceFormModal } from './ServiceFormModal'
import { catalogErrorText, useRemoveService, useServices, useSetServiceActive } from './useCatalog'
import table from '../../components/ui/dataTable.module.css'
import styles from './catalog.module.css'

/** Catalogue de prestations : offres types avec prix, lignes de devis et tâches types. */
export function CatalogPage() {
  const { data, isLoading, isError, refetch } = useServices()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<ServiceStatusFilter>('active')
  // Écriture : admin, membre, finance. Les autres rôles lisent seulement (la RLS le refuse aussi).
  const canWrite = useHasRole([...PROJECT_ROLES, ...FINANCE_ROLES])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const setActive = useSetServiceActive()
  const remove = useRemoveService()

  const services = useMemo(() => data ?? [], [data])
  const categories = useMemo(() => serviceCategories(services), [services])
  const visible = useMemo(() => filterServices(services, { query, category, status }), [services, query, category, status])
  const position = nextServicePosition(services)

  // Lien profond (recherche Cmd+K) : /catalog?service=<id> ouvre la fiche, tant qu'on ne l'a pas fermée.
  const deepId = params.get('service')
  const [closedDeepId, setClosedDeepId] = useState<string | null>(null)
  const deepService = deepId && deepId !== closedDeepId ? (services.find((s) => s.id === deepId) ?? null) : null
  const shownEditing = editing ?? deepService

  function closeEditing() {
    setEditing(null)
    if (deepId) {
      setClosedDeepId(deepId)
      const next = new URLSearchParams(params)
      next.delete('service')
      setParams(next, { replace: true })
    }
  }

  async function toggleActive(service: Service) {
    try {
      await setActive.mutateAsync({ id: service.id, active: !service.active })
      toast.success(service.active ? 'Prestation archivée' : 'Prestation réactivée')
    } catch (e) {
      toast.error(catalogErrorText(e))
    }
  }

  async function removeService(service: Service) {
    if (!window.confirm(`Supprimer « ${service.name} » ? Si elle sert déjà dans un devis ou une facture, elle sera archivée à la place.`)) return
    try {
      const result = await remove.mutateAsync(service)
      toast.success(result === 'archived' ? 'Prestation utilisée : archivée à la place' : 'Prestation supprimée')
    } catch (e) {
      toast.error(catalogErrorText(e))
    }
  }

  const newButton = canWrite ? (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouvelle prestation
    </Button>
  ) : undefined

  return (
    <section className={table.page} aria-labelledby="catalog-title">
      <h1 id="catalog-title">Catalogue</h1>
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher une prestation', placeholder: 'Nom, catégorie, description' }}
        activeFilterCount={(category !== '' ? 1 : 0) + (status !== 'active' ? 1 : 0)}
        onResetFilters={() => {
          setCategory('')
          setStatus('active')
        }}
        onAdd={canWrite ? () => setCreating(true) : undefined}
        addLabel="Nouvelle prestation"
        filters={
          <>
            <Field label="Catégorie">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Toutes</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Statut">
              <Select value={status} onChange={(e) => setStatus(e.target.value as ServiceStatusFilter)}>
                {(Object.keys(STATUS_FILTER_LABELS) as ServiceStatusFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {STATUS_FILTER_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement du catalogue…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger le catalogue." onRetry={() => void refetch()} />
      ) : services.length === 0 ? (
        <EmptyState
          title="Aucune prestation"
          text={canWrite ? 'Ajoute tes offres types : elles pré-remplissent les devis et proposent les tâches à l’acceptation.' : undefined}
          action={newButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucune prestation ne correspond à la recherche ni aux filtres." />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Prestation</th>
                <th scope="col">Catégorie</th>
                <th scope="col" className={styles.num}>
                  Prix HT
                </th>
                <th scope="col" className={styles.num}>
                  Lignes
                </th>
                <th scope="col" className={styles.num}>
                  Tâches types
                </th>
                {canWrite ? (
                  <th scope="col" className={table.actionsCell}>
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((service) => (
                <tr key={service.id} className={[table.row, service.active ? '' : table.inactive].join(' ')}>
                  <td>
                    <span className={styles.nameCell}>
                      {canWrite ? (
                        <button type="button" className={[styles.nameButton, table.rowLink].join(' ')} onClick={() => setEditing(service)}>
                          {service.name}
                        </button>
                      ) : (
                        <span className={styles.nameButton}>{service.name}</span>
                      )}
                      {service.description ? <span className={table.muted}>{service.description}</span> : null}
                      {service.active ? null : <Badge>Archivée</Badge>}
                    </span>
                  </td>
                  <td>{service.category ?? <span className={table.muted}>Sans catégorie</span>}</td>
                  <td className={styles.num}>
                    {formatMoney(service.unit_price_cents)} <span className={table.muted}>/ {LABELS.lineUnit[service.unit]}</span>
                  </td>
                  <td className={styles.num}>{service.lines.length}</td>
                  <td className={styles.num}>{service.task_templates.length}</td>
                  {canWrite ? (
                    <td className={table.actionsCell}>
                      <ActionsMenu
                        label={`Actions pour ${service.name}`}
                        items={[
                          { label: 'Modifier', onSelect: () => setEditing(service) },
                          {
                            label: service.active ? 'Archiver' : 'Réactiver',
                            onSelect: () => void toggleActive(service),
                            disabled: setActive.isPending,
                          },
                          { label: 'Supprimer', tone: 'danger', onSelect: () => void removeService(service), disabled: remove.isPending },
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ServiceFormModal open={creating} onClose={() => setCreating(false)} nextPosition={position} categories={categories} />
      <ServiceFormModal
        key={shownEditing?.id ?? 'none'}
        open={shownEditing !== null}
        onClose={closeEditing}
        service={shownEditing}
        nextPosition={position}
        categories={categories}
      />
    </section>
  )
}
