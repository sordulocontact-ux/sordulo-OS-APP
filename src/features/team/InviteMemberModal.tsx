import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, Modal, Select, TextInput } from '../../components/ui'
import { api, ApiRequestError } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import { LABELS, MEMBER_ROLES, type MemberRole } from '../../shared/types'
import { LoginLinkModal } from './LoginLinkModal'
import { ROLE_HELP } from './teamLogic'
import styles from './TeamPage.module.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface InviteMemberModalProps {
  organizationId: string
  onClose: () => void
}

export function InviteMemberModal({ organizationId, onClose }: InviteMemberModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('membre')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({})
  const [result, setResult] = useState<{ name: string; link: string | null } | null>(null)

  if (result && result.link === null) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Membre ajouté"
        actions={
          <Button variant="primary" onClick={onClose}>
            Terminé
          </Button>
        }
      >
        <p>
          {result.name} a déjà un compte Sordulo OS : il ou elle se connecte comme d’habitude et verra l’organisation dès sa
          prochaine connexion.
        </p>
      </Modal>
    )
  }
  if (result?.link) return <LoginLinkModal name={result.name} link={result.link} onClose={onClose} />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const errors: { name?: string; email?: string } = {}
    if (!trimmedName) errors.name = 'Indique le nom du membre.'
    if (!trimmedEmail) errors.email = 'Indique son adresse email.'
    else if (!EMAIL_PATTERN.test(trimmedEmail)) errors.email = 'Cette adresse email n’est pas valide.'
    setFieldErrors(errors)
    setError(null)
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    try {
      const response = await api.inviteMember({ organizationId, name: trimmedName, email: trimmedEmail, role })
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(organizationId) })
      setResult({ name: response.member.name, link: response.link })
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Impossible d’inviter ce membre. Réessaie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title="Inviter un membre"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="invite-member-form" loading={busy}>
            Inviter
          </Button>
        </>
      }
    >
      <form id="invite-member-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Nom" error={fieldErrors.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" disabled={busy} required />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" disabled={busy} required />
        </Field>
        <Field label="Rôle" hint={ROLE_HELP[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} disabled={busy}>
            {MEMBER_ROLES.map((value) => (
              <option key={value} value={value}>
                {LABELS.memberRole[value]}
              </option>
            ))}
          </Select>
        </Field>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
