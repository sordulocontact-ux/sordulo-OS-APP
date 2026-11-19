import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, TextInput, useToast } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import styles from './SetPasswordButton.module.css'

const MIN_LENGTH = 8

/** Menu du compte : définir ou changer son mot de passe (connexion sans email ensuite). */
export function SetPasswordButton() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && confirm !== password
  const canSave = password.length >= MIN_LENGTH && confirm === password

  function close() {
    if (saving) return
    setOpen(false)
    setPassword('')
    setConfirm('')
    setError(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) {
      setError(
        /different from the old/i.test(updateError.message)
          ? 'C’est déjà ton mot de passe actuel.'
          : /weak|short|characters/i.test(updateError.message)
            ? 'Mot de passe trop faible : allonge-le ou mélange lettres et chiffres.'
            : `Impossible d’enregistrer le mot de passe : ${updateError.message}`,
      )
      return
    }
    toast.success('Mot de passe enregistré. Tu pourras te connecter avec ton email et ce mot de passe.')
    close()
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        role="menuitem"
        onClick={() => setOpen(true)}
      >
        Mot de passe
      </Button>
      <Modal open={open} onClose={close} dismissible={!saving} title="Définir mon mot de passe">
        <form className={styles.form} onSubmit={(e) => void save(e)}>
          <p>Ensuite, tu te connectes avec ton email et ce mot de passe, sans attendre de lien par email.</p>
          <Field label="Nouveau mot de passe" hint={`${MIN_LENGTH} caractères minimum.`} error={tooShort ? `${MIN_LENGTH} caractères minimum.` : null}>
            <TextInput
              type="password"
              name="new-password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Field label="Confirmer le mot de passe" error={mismatch ? 'Les deux mots de passe sont différents.' : null}>
            <TextInput
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={saving}
            />
          </Field>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
              Enregistrer
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
