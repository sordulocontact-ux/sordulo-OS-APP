import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput } from '../../components/ui'
import { todayIso } from '../../shared/billing'
import { validateSignature } from './contractLogic'
import styles from './contracts.module.css'

export interface SignContractModalProps {
  open: boolean
  onClose: () => void
  busy: boolean
  onSign: (name: string, date: string) => void
}

/** Signature notée à la main : nom du signataire et date. */
export function SignContractModal({ open, onClose, busy, onSign }: SignContractModalProps) {
  const today = todayIso()
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [showErrors, setShowErrors] = useState(false)
  const errors = showErrors ? validateSignature({ name, date }, today) : {}

  function submit(event: FormEvent) {
    event.preventDefault()
    setShowErrors(true)
    const found = validateSignature({ name, date }, today)
    if (found.name || found.date) return
    onSign(name.trim(), date)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Marquer comme signé"
      dismissible={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="sign-contract-form" loading={busy}>
            Marquer signé
          </Button>
        </>
      }
    >
      <form id="sign-contract-form" className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.hint}>Un contrat signé ne se modifie plus. Seule l’annulation reste possible.</p>
        <Field label="Nom du signataire" error={errors.name}>
          <TextInput value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Date de signature" error={errors.date}>
          <TextInput type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
