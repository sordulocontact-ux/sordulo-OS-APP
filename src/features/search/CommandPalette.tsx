import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import searchIcon from '../../assets/icons/search.svg'
import { ErrorState, Icon, Spinner } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import styles from './CommandPalette.module.css'
import { OPEN_PALETTE_EVENT } from './openEvent'
import { QUICK_ACTIONS } from './quickActions'
import { getSearchSources, subscribeSearchSources } from './registry'
import { filterActionsByRole, flattenGroups, highlightParts, moveIndex } from './searchLogic'
import { installBuiltInSources } from './sources'
import type { SearchGroup, SearchResult } from './types'
import { usePaletteSearch } from './usePaletteSearch'

installBuiltInSources()

export interface CommandPaletteProps {
  /** Emplacement à droite du champ (futur bouton micro des commandes vocales). */
  trailing?: ReactNode
}

/**
 * Palette de recherche globale. Se monte une fois (dans AppLayout) : elle écoute elle-même
 * Cmd+K / Ctrl+K, et s'ouvre aussi par `openCommandPalette()`.
 */
export function CommandPalette({ trailing }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener(OPEN_PALETTE_EVENT, onOpen)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener(OPEN_PALETTE_EVENT, onOpen)
    }
  }, [])

  const close = useCallback(() => setOpen(false), [])
  // Montée seulement ouverte : l'état (saisie, sélection) repart de zéro à chaque ouverture.
  return open ? <PaletteDialog onClose={close} trailing={trailing} /> : null
}

function PaletteDialog({ onClose, trailing }: { onClose: () => void; trailing?: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { member, organization } = useCurrentMember()
  const role = member?.role ?? null
  const uid = useId()
  const listId = `${uid}-list`
  const optionId = (index: number) => `${uid}-option-${index}`

  const [query, setQuery] = useState('')
  const [rawActive, setActive] = useState(0)

  const sources = useSyncExternalStore(subscribeSearchSources, getSearchSources, getSearchSources)
  const search = usePaletteSearch(query, sources, role, organization?.id ?? null)

  const actionGroups = useMemo<SearchGroup[]>(() => {
    const items = filterActionsByRole(QUICK_ACTIONS, role).map<SearchResult>((action) => ({
      id: action.id,
      title: action.title,
      subtitle: action.subtitle,
      to: action.to,
      icon: action.icon,
    }))
    return items.length > 0 ? [{ id: 'quick-actions', label: 'Actions rapides', items }] : []
  }, [role])

  const isQuerying = query.trim() !== ''
  const groups = isQuerying ? search.groups : actionGroups
  const flat = useMemo(() => flattenGroups(groups), [groups])
  const active = flat.length === 0 ? -1 : Math.min(rawActive, flat.length - 1)

  // Ouvre la fenêtre native (focus piégé, Échap, fond inerte) et rend le focus au déclencheur à la fermeture.
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) dialog.showModal()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function go(result: SearchResult) {
    onClose()
    navigate(result.to)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(moveIndex(active, event.key === 'ArrowDown' ? 1 : -1, flat.length))
    } else if (event.key === 'Home' && flat.length > 0 && event.ctrlKey) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'Enter') {
      const result = flat[active]
      if (result) {
        event.preventDefault()
        go(result)
      }
    }
  }

  const showEmpty = isQuerying && search.status === 'ready' && flat.length === 0
  const showLoading = isQuerying && search.status === 'loading' && flat.length === 0
  const showError = isQuerying && search.status === 'error'
  const hasOptions = flat.length > 0 && !showError

  let offset = 0
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Recherche"
      onClose={onClose}
      onMouseDown={(event) => {
        // Clic sur le fond (hors du panneau) : fermer.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.panel}>
        <div className={styles.searchRow}>
          <img src={searchIcon} alt="" width={20} height={20} className={styles.searchIcon} />
          <input
            className={styles.input}
            type="text"
            role="combobox"
            aria-label="Rechercher un client, un devis, un projet"
            aria-expanded={hasOptions}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && hasOptions ? optionId(active) : undefined}
            placeholder="Rechercher un client, un devis, un projet…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          {search.status === 'loading' && isQuerying ? <Spinner label="Recherche en cours…" /> : null}
          {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Résultats" className={styles.results}>
          {showError ? <ErrorState message="La recherche a échoué." onRetry={search.retry} /> : null}
          {showLoading ? <p className={styles.note}>Recherche en cours…</p> : null}
          {showEmpty ? (
            <p className={styles.note} role="status">
              Aucun résultat pour « {query.trim()} »
            </p>
          ) : null}
          {!showError &&
            groups.map((group) => {
              const start = offset
              offset += group.items.length
              const headingId = `${uid}-group-${group.id}`
              return (
                <div key={group.id} role="group" aria-labelledby={headingId} className={styles.group}>
                  <div id={headingId} className={styles.groupLabel}>
                    {group.label}
                  </div>
                  {group.items.map((item, index) => {
                    const position = start + index
                    return (
                      <div
                        key={item.id}
                        id={optionId(position)}
                        role="option"
                        aria-selected={position === active}
                        className={styles.option}
                        data-active={position === active ? 'true' : undefined}
                        onMouseMove={() => position !== active && setActive(position)}
                        onClick={() => go(item)}
                      >
                        {item.icon ? <Icon src={item.icon} className={styles.optionIcon} /> : null}
                        <span className={styles.optionText}>
                          <span className={styles.optionTitle}>
                            <Highlight text={item.title} query={query} />
                          </span>
                          {item.subtitle ? (
                            <span className={styles.optionSubtitle}>
                              <Highlight text={item.subtitle} query={query} />
                            </span>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          {search.failedCount > 0 && search.status === 'ready' ? (
            <p className={styles.note} role="status">
              Certains résultats n'ont pas pu être chargés.
            </p>
          ) : null}
        </div>

        <footer className={styles.footer} aria-hidden="true">
          <span>
            <kbd className={styles.kbd}>↑</kbd> <kbd className={styles.kbd}>↓</kbd> naviguer
          </span>
          <span>
            <kbd className={styles.kbd}>↵</kbd> ouvrir
          </span>
          <span>
            <kbd className={styles.kbd}>Échap</kbd> fermer
          </span>
        </footer>
      </div>
    </dialog>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}
