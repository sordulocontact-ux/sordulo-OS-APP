import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, Field, Modal, Textarea, TextInput, useToast } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { normalizeSiret, siretError } from '../../shared/siret'
import type { Client } from '../../shared/types'
import { emailError, findDuplicate, normalizeWebsite, trimOrNull, websiteError } from './clientUtils'
import {
  errorText,
  useClients,
  useCreateClient,
  useCreatePrimaryContact,
  useUpdateClient,
  type ClientFields,
} from './useClients'
import styles from './clients.module.css'

export interface ClientFormModalProps {
  open: boolean
  onClose: () => void
  /** Client à modifier ; absent = création. */
  client?: Client | null
  /** Appelé après l'enregistrement avec le client créé ou modifié. */
  onSaved?: (client: Client) => void
}

interface Draft {
  name: string
  siret: string
  street: string
  postalCode: string
  city: string
  country: string
  website: string
  notes: string
  contactName: string
  contactEmail: string
  contactPhone: string
  contactRole: string
}

function initialDraft(client: Client | null | undefined): Draft {
  return {
    name: client?.name ?? '',
    siret: client?.siret ?? '',
    street: client?.billing_street ?? '',
    postalCode: client?.billing_postal_code ?? '',
    city: client?.billing_city ?? '',
    country: client ? (client.billing_country ?? '') : 'France',
    website: client?.website ?? '',
    notes: client?.notes ?? '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    contactRole: '',
  }
}

export function ClientFormModal({ open, onClose, client, onSaved }: ClientFormModalProps) {
  const toast = useToast()
  const { organization } = useCurrentMember()
  const { data: clients } = useClients()
  const create = useCreateClient()
  const update = useUpdateClient(client?.id ?? '')
  const createContact = useCreatePrimaryContact()
  const isEdit = Boolean(client)

  const [draft, setDraft] = useState<Draft>(() => initialDraft(client))
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Doublon pour lequel l'utilisateur a déjà été prévenu : le clic suivant crée quand même.
  const [warnedId, setWarnedId] = useState<string | null>(null)
  // Client déjà créé alors que son contact a échoué : un nouvel essai ne recrée pas le client.
  const [created, setCreated] = useState<Client | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(initialDraft(client))
      setShowErrors(false)
      setError(null)
      setWarnedId(null)
      setCreated(null)
      create.reset()
      update.reset()
      createContact.reset()
    }
  }

  const busy = create.isPending || update.isPending || createContact.isPending

  const duplicate = useMemo(
    () => (isEdit || created || !clients ? null : findDuplicate(clients, { name: draft.name, siret: draft.siret })),
    [isEdit, created, clients, draft.name, draft.siret],
  )
  const warned = duplicate !== null && warnedId === duplicate.client.id

  const nameError = draft.name.trim() === '' ? 'Indique le nom de l’entreprise.' : null
  const siretMessage = siretError(draft.siret)
  const siteMessage = websiteError(draft.website)
  const hasContact = !isEdit && (draft.contactName.trim() !== '' || draft.contactEmail.trim() !== '' ||
    draft.contactPhone.trim() !== '' || draft.contactRole.trim() !== '')
  const contactNameError = hasContact && draft.contactName.trim() === '' ? 'Indique le nom du contact.' : null
  const contactMailError = emailError(draft.contactEmail)
  const invalid = Boolean(nameError || siretMessage || siteMessage || contactNameError || contactMailError)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setShowErrors(true)
    if (invalid) return
    if (duplicate && !warned) {
      setWarnedId(duplicate.client.id)
      return
    }
    const fields: ClientFields = {
      name: draft.name.trim(),
      siret: trimOrNull(normalizeSiret(draft.siret)),
      billing_street: trimOrNull(draft.street),
      billing_postal_code: trimOrNull(draft.postalCode),
      billing_city: trimOrNull(draft.city),
      billing_country: trimOrNull(draft.country),
      website: normalizeWebsite(draft.website),
      notes: trimOrNull(draft.notes),
    }
    try {
      if (client) {
        await update.mutateAsync(fields)
        toast.success('Client modifié')
        onSaved?.({ ...client, ...fields })
        onClose()
        return
      }
      if (!organization) {
        setError('Ton organisation est introuvable. Recharge la page.')
        return
      }
      let saved = created
      if (!saved) {
        saved = await create.mutateAsync({ organizationId: organization.id, fields })
        setCreated(saved)
      }
      if (hasContact) {
        try {
          await createContact.mutateAsync({
            clientId: saved.id,
            fields: {
              name: draft.contactName.trim(),
              email: trimOrNull(draft.contactEmail),
              phone: trimOrNull(draft.contactPhone),
              role: trimOrNull(draft.contactRole),
            },
          })
        } catch (e) {
          setError(`Le client est créé, mais pas son contact. ${errorText(e)} Réessaie.`)
          return
        }
      }
      toast.success('Client créé')
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const submitLabel = isEdit ? 'Enregistrer' : warned ? 'Créer quand même' : 'Créer'

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={isEdit ? 'Modifier le client' : 'Nouveau client'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="client-form" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="client-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Nom de l’entreprise" error={showErrors ? nameError : null}>
          <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={busy} required />
        </Field>
        <Field
          label="SIRET"
          hint="14 chiffres, facultatif. Les espaces sont acceptés."
          error={showErrors || draft.siret.trim().length >= 14 ? siretMessage : null}
        >
          <TextInput
            value={draft.siret}
            onChange={(e) => set('siret', e.target.value)}
            disabled={busy}
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Adresse de facturation</legend>
          <Field label="Rue">
            <TextInput
              value={draft.street}
              onChange={(e) => set('street', e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </Field>
          <div className={styles.row}>
            <Field label="Code postal">
              <TextInput
                value={draft.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            <Field label="Ville">
              <TextInput value={draft.city} onChange={(e) => set('city', e.target.value)} disabled={busy} autoComplete="off" />
            </Field>
          </div>
          <Field label="Pays">
            <TextInput value={draft.country} onChange={(e) => set('country', e.target.value)} disabled={busy} />
          </Field>
        </fieldset>

        <Field label="Site web" hint="https:// est ajouté si tu l’oublies." error={showErrors ? siteMessage : null}>
          <TextInput
            type="text"
            inputMode="url"
            value={draft.website}
            onChange={(e) => set('website', e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
        </Field>
        <Field label="Notes">
          <Textarea rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} disabled={busy} />
        </Field>

        {isEdit ? null : (
          <fieldset className={styles.group}>
            <legend className={styles.groupTitle}>Contact principal (facultatif)</legend>
            <Field label="Nom du contact" error={showErrors ? contactNameError : null}>
              <TextInput
                value={draft.contactName}
                onChange={(e) => set('contactName', e.target.value)}
                disabled={busy || created !== null}
                autoComplete="off"
              />
            </Field>
            <div className={styles.row}>
              <Field label="Email du contact" error={showErrors ? contactMailError : null}>
                <TextInput
                  type="email"
                  value={draft.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                  disabled={busy || created !== null}
                  autoComplete="off"
                />
              </Field>
              <Field label="Téléphone du contact">
                <TextInput
                  type="tel"
                  value={draft.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  disabled={busy || created !== null}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field label="Rôle du contact">
              <TextInput
                value={draft.contactRole}
                onChange={(e) => set('contactRole', e.target.value)}
                disabled={busy || created !== null}
              />
            </Field>
          </fieldset>
        )}

        {warned && duplicate ? (
          <p className={styles.warning} role="alert">
            <span>
              {duplicate.reason === 'siret'
                ? 'Un client a déjà ce SIRET : '
                : 'Un client porte déjà ce nom : '}
              <Link to={`/clients/${duplicate.client.id}`} onClick={onClose}>
                {duplicate.client.name}
              </Link>
              {duplicate.client.archived_at ? ' (archivé)' : ''}.
            </span>
            <span>Si c’est bien un autre client, clique sur « Créer quand même ».</span>
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
