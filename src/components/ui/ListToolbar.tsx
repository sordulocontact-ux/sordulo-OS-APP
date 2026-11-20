import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import filterIcon from '../../assets/icons/filter.svg'
import plusIcon from '../../assets/icons/plus.svg'
import { IconButton } from './IconButton'
import styles from './ListToolbar.module.css'
import { SearchField } from './SearchField'

export interface ListToolbarProps {
  search: {
    value: string
    onChange: (value: string) => void
    /** Nom accessible du champ, par exemple « Rechercher un projet ». */
    label: string
    placeholder?: string
  }
  /** Contenu du panneau de filtres (champs empilés). Absent : pas de bouton filtre. */
  filters?: ReactNode
  /** Nombre de filtres actifs : pastille sur le bouton quand > 0. */
  activeFilterCount?: number
  /** Si fourni, un lien « Réinitialiser » apparaît dans le panneau. */
  onResetFilters?: () => void
  /** Bouton « + ». Absent : pas de bouton (rôle en lecture seule). */
  onAdd?: () => void
  /** Libellé du bouton « + », par exemple « Nouveau client ». */
  addLabel: string
  /** Désactive le bouton « + » (chargement). */
  addDisabled?: boolean
}

/** Barre de liste du Figma : recherche pleine largeur, bouton filtre (panneau) et bouton « + ». */
export function ListToolbar({ search, filters, activeFilterCount = 0, onResetFilters, onAdd, addLabel, addDisabled }: ListToolbarProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  // À l'ouverture, le focus va sur le premier champ du panneau.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('select, input, button, textarea')?.focus()
  }, [open])

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
  }

  // Tab hors du panneau le referme sans voler le focus.
  function onPanelBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null
    if (next && !rootRef.current?.contains(next)) setOpen(false)
  }

  const filterLabel = activeFilterCount > 0 ? `Filtres (${activeFilterCount} ${activeFilterCount > 1 ? 'actifs' : 'actif'})` : 'Filtres'

  return (
    <div className={styles.toolbar}>
      <SearchField
        className={styles.search}
        label={search.label}
        placeholder={search.placeholder}
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
      />
      {filters ? (
        <div className={styles.filterRoot} ref={rootRef}>
          <IconButton
            ref={buttonRef}
            icon={filterIcon}
            label={filterLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((value) => !value)}
          />
          {activeFilterCount > 0 ? (
            <span className={styles.badge} aria-hidden="true">
              {activeFilterCount}
            </span>
          ) : null}
          {open ? (
            <div id={panelId} ref={panelRef} className={styles.panel} role="dialog" aria-label="Filtres" onKeyDown={onPanelKey} onBlur={onPanelBlur}>
              <div className={styles.panelHeader}>
                <span className={styles.panelTitle}>Filtres</span>
                {onResetFilters ? (
                  <button type="button" className={styles.reset} onClick={onResetFilters} disabled={activeFilterCount === 0}>
                    Réinitialiser
                  </button>
                ) : null}
              </div>
              <div className={styles.panelBody}>{filters}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {onAdd ? <IconButton icon={plusIcon} label={addLabel} onClick={onAdd} disabled={addDisabled} /> : null}
    </div>
  )
}
