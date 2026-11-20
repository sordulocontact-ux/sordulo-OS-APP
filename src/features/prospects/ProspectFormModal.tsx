import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { emailError, websiteError } from '../clients/clientUtils'
import { LABELS, PROSPECT_STAGES, type Prospect } from '../../shared/types'
import { normalizeSite, SOURCE_SUGGESTIONS, trimOrNull } from './prospectLogic'
import { prospectErrorText, useCreateProspect, useUpdateProspect, type ProspectFields } from './useProspects'
import styles from './prospects.module.css'

export interface ProspectFormModalProps {
  open: boolean
  onClose: () => void
  /** Prospect à modifier ; absent = création. */
  prospect?: Prospect | null
  onSaved?: (prospect: Prospect) => void
}

interface Draft {
  company: string
  website: string
  contactName: string
  contactEmail: string
  contactPhone: string
  source: string
  stage: Prospect['stage']
  nextActionDate: string
  ownerId: string
  notes: string
}

function initialDraft(prospect: Prospect | null | undefined, myId: string): Draft {
  return {
    company: prospect?.company ?? '',
    website: prospect?.website ?? '',
    contactName: prospect?.contact_name ?? '',
    contactEmail: prospect?.contact_email ?? '',
    contactPhone: prospect?.contact_phone ?? '',
    source: prospect?.source ?? '',
    stage: prospect?.stage ?? 'to_contact',
    nextActionDate: prospect?.next_action_date ?? '',
    ownerId: prospect ? (prospect.owner_member_id ?? '') : myId,
    notes: prospect?.notes ?? '',
  }
}

export function ProspectFormModal({ open, onClose, prospect, onSaved }: ProspectFormModalProps) {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const { data: members } = useOrgMembers(organization?.id)
  const create = useCreateProspect()
  const update = useUpdateProspect()
  const isEdit = Boolean(prospect)
  const myId = member?.id ?? ''

  const [draft, setDraft] = useState<Draft>(() => initialDraft(prospect, myId))
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(initialDraft(prospect, myId))
      setShowErrors(false)
      setError(null)
      create.reset()
      update.reset()
    }
  }

  const busy = create.isPending || update.isPending
  // Membres actifs, plus le responsable actuel s'il a été retiré (pour ne pas perdre la valeur).
  const owners = (members ?? []).filter((m) => m.removed_at === null || m.id === prospect?.owner_member_id)

  const companyError = draft.company.trim() === '' ? 'Indique le nom de l’entreprise.' : null
  const siteMessage = websiteError(draft.website)
  const mailMessage = emailError(draft.contactEmail)
  const invalid = Boolean(companyError || siteMessage || mailMessage)

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
    const fields: ProspectFields = {
      company: draft.company.trim(),
      website: normalizeSite(draft.website),
      contact_name: trimOrNull(draft.contactName),
      contact_email: trimOrNull(draft.contactEmail),
      contact_phone: trimOrNull(draft.contactPhone),
      source: trimOrNull(draft.source),
      stage: draft.stage,
      next_action_date: trimOrNull(draft.nextActionDate),
      notes: trimOrNull(draft.notes),
      owner_member_id: trimOrNull(draft.ownerId),
    }
    try {
      if (prospect) {
        await update.mutateAsync({ prospectId: prospect.id, fields })
        toast.success('Prospect modifié')
        onSaved?.({ ...prospect, ...fields })
        onClose()
        return
      }
      if (!organization) {
        setError('Ton organisation est introuvable. Recharge la page.')
        return
      }
      const saved = await create.mutateAsync({ organizationId: organization.id, fields })
      toast.success('Prospect créé')
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(prospectErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={isEdit ? 'Modifier le prospect' : 'Nouveau prospect'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="prospect-form" loading={busy}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form id="prospect-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Entreprise" error={showErrors ? companyError : null}>
          <TextInput value={draft.company} onChange={(e) => set('company', e.target.value)} disabled={busy} required />
        </Field>
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

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Contact</legend>
          <Field label="Nom du contact">
            <TextInput value={draft.contactName} onChange={(e) => set('contactName', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
          <div className={styles.row}>
            <Field label="Email" error={showErrors ? mailMessage : null}>
              <TextInput
                type="email"
                value={draft.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            <Field label="Téléphone">
              <TextInput
                type="tel"
                value={draft.contactPhone}
                onChange={(e) => set('contactPhone', e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
          </div>
        </fieldset>

        <div className={styles.row}>
          <Field label="Source">
            <TextInput
              value={draft.source}
              onChange={(e) => set('source', e.target.value)}
              disabled={busy}
              list="prospect-sources"
              autoComplete="off"
            />
            <datalist id="prospect-sources">
              {SOURCE_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Étape">
            <Select value={draft.stage} onChange={(e) => set('stage', e.target.value as Draft['stage'])} disabled={busy}>
              {PROSPECT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {LABELS.prospectStage[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Prochaine action">
            <TextInput type="date" value={draft.nextActionDate} onChange={(e) => set('nextActionDate', e.target.value)} disabled={busy} />
          </Field>
          <Field label="Responsable">
            <Select value={draft.ownerId} onChange={(e) => set('ownerId', e.target.value)} disabled={busy}>
              <option value="">Non attribué</option>
              {owners.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} disabled={busy} />
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
