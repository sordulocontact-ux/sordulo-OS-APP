import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import moreIcon from '../../assets/icons/more.svg'
import styles from './ActionsMenu.module.css'

export interface ActionsMenuItem {
  label: string
  onSelect: () => void
  tone?: 'danger'
  /** Désactivé : reste focusable (le `hint` explique pourquoi) mais ne fait rien. */
  disabled?: boolean
  /** Texte d'aide sous le libellé (raison d'une désactivation). */
  hint?: string
}

export interface ActionsMenuProps {
  /** Nom accessible du bouton, par exemple « Actions pour App Ibé ». */
  label: string
  items: ActionsMenuItem[]
}

/** Bouton « … » qui ouvre un menu d'actions de ligne. Flèches, Entrée, Échap ; fermeture au clic extérieur. */
export function ActionsMenu({ label, items }: ActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  // À l'ouverture, le focus va sur le premier élément.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  function close(restoreFocus: boolean) {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  function move(delta: number, from: number) {
    const count = items.length
    if (count === 0) return
    itemRefs.current[(from + delta + count) % count]?.focus()
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1, current)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1, current === -1 ? 0 : current)
        break
      case 'Home':
        event.preventDefault()
        itemRefs.current[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        itemRefs.current[items.length - 1]?.focus()
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close(true)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      setOpen(true)
    }
  }

  function select(item: ActionsMenuItem) {
    if (item.disabled) return
    close(true)
    item.onSelect()
  }

  return (
    <span className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKey}
      >
        <img src={moreIcon} alt="" width={20} height={20} />
      </button>
      {open ? (
        <div id={menuId} className={styles.menu} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map((item, index) => {
            const hintId = item.hint ? `${menuId}-hint-${index}` : undefined
            return (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                aria-describedby={hintId}
                className={[styles.item, item.tone === 'danger' ? styles.danger : '', item.disabled ? styles.disabled : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => select(item)}
              >
                <span>{item.label}</span>
                {item.hint ? (
                  <span id={hintId} className={styles.hint}>
                    {item.hint}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}
