import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Footer slot, typically the action buttons. */
  actions?: ReactNode
  /** false while something is in flight: Escape and the close button are ignored. Defaults to true. */
  dismissible?: boolean
}

/** Native <dialog> opened with showModal(): Escape closes it, focus is trapped by the browser. */
export function Modal({ open, onClose, title, children, actions, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  function handleNativeClose() {
    // The browser may close the dialog on its own (repeated Escape): reopen it while not dismissible.
    if (open && !dismissible) {
      ref.current?.showModal()
      return
    }
    if (open) onClose()
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault()
      }}
      onClose={handleNativeClose}
    >
      {open ? (
        <div className={styles.panel}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={!dismissible} aria-label="Fermer la fenêtre">
              Fermer
            </Button>
          </header>
          <div className={styles.body}>{children}</div>
          {actions ? <footer className={styles.footer}>{actions}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}
