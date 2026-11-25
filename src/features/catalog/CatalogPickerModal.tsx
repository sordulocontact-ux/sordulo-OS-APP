import { useMemo, useState, type FormEvent } from 'react'
import { Button, EmptyState, ErrorState, LoadingState, Modal, TextInput } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { LABELS, type Service } from '../../shared/types'
import { filterServices } from './catalogLogic'
import { useActiveServices } from './useCatalog'
import styles from './catalog.module.css'

export interface CatalogPickerModalProps {
  open: boolean
  onClose: () => void
  /** Prestations choisies, dans l'ordre de la liste. */
  onPick: (services: Service[]) => void
}

/** Choix d'une ou plusieurs prestations actives du catalogue, pour en ajouter les lignes à un devis. */
export function CatalogPickerModal({ open, onClose, onPick }: CatalogPickerModalProps) {
  const { data, isLoading, isError, refetch } = useActiveServices()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setChosen(new Set())
    }
  }

  const visible = useMemo(() => filterServices(data ?? [], { query, category: '', status: 'active' }), [data, query])

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const picked = (data ?? []).filter((s) => chosen.has(s.id))
    if (picked.length === 0) return
    onPick(picked)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter depuis le catalogue"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="catalog-picker" disabled={chosen.size === 0}>
            {chosen.size > 1 ? `Ajouter ${chosen.size} prestations` : 'Ajouter'}
          </Button>
        </>
      }
    >
      <form id="catalog-picker" className={styles.picker} onSubmit={submit}>
        {isLoading ? (
          <LoadingState label="Chargement du catalogue…" />
        ) : isError ? (
          <ErrorState message="Impossible de charger le catalogue." onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState title="Aucune prestation active" text="Crée tes prestations dans le Catalogue pour les retrouver ici." />
        ) : (
          <>
            <TextInput
              type="search"
              aria-label="Rechercher une prestation"
              placeholder="Rechercher une prestation"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {visible.length === 0 ? (
              <EmptyState title="Aucune prestation ne correspond à la recherche." />
            ) : (
              <ul className={styles.pickList}>
                {visible.map((service) => {
                  const id = `pick-${service.id}`
                  return (
                    <li key={service.id} className={styles.pickItem}>
                      <input id={id} type="checkbox" checked={chosen.has(service.id)} onChange={() => toggle(service.id)} />
                      <label htmlFor={id} className={styles.pickBody}>
                        <span className={styles.pickName}>{service.name}</span>
                        <span className={styles.pickMeta}>
                          {[service.category, service.lines.length > 1 ? `${service.lines.length} lignes` : null, service.task_templates.length > 0 ? `${service.task_templates.length} tâches types` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </label>
                      <span className={styles.pickPrice}>
                        {formatMoney(service.unit_price_cents)} / {LABELS.lineUnit[service.unit]}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </form>
    </Modal>
  )
}
