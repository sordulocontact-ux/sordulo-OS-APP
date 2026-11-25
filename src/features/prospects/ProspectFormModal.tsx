import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { emailError, websiteError } from '../clients/clientUtils'
import { LABELS, type Prospect } from '../../shared/types'
import { allowedStages, isAgencyRole, normalizeSite, SOURCE_SUGGESTIONS, trimOrNull } from './prospectLogic'
import {
  prospectErrorText,
  useCreateProspect,
  useRunProspectAudit,
  useUpdateProspect,
  type ProspectChanges,
  type ProspectFields,
} from './useProspects'
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
  registeredAt: string
}

function initialDraft(prospect: Prospect | null | undefined, myId: string): Draft {
  return {
    company: prospect?.company ?? '',
    website: prospect?.website ?? '',
    contactName: prospect?.contact_name ?? '',
    contactEmail: prospect?.contact_email ?? '',
    contactPhone: prospect?.contact_phone ?? '',
    source: prospect?.source ?? '',
    stage: prospect?.stage ?? 'to_audit',
    nextActionDate: prospect?.next_action_date ?? '',
    ownerId: prospect ? (prospect.owner_member_id ?? '') : myId,
    notes: prospect?.notes ?? '',
    registeredAt: prospect?.registered_at ?? '',
  }
}

export function ProspectFormModal({ open, onClose, prospect, onSaved }: ProspectFormModalProps) {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const { data: members } = useOrgMembers(organization?.id)
  const create = useCreateProspect()
  const update = useUpdateProspect()
  const audit = useRunProspectAudit()
  const role = member?.role ?? null
  // L'apporteur ne choisit ni l'étape ni le responsable : la base les pose (« À auditer », lui-même).
  const agency = isAgencyRole(role)
  const isAdmin = role === 'admin'
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
    const fields: ProspectFields & ProspectChanges = {
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
    if (isAdmin && !prospect?.client_id && trimOrNull(draft.registeredAt)) fields.registered_at = draft.registeredAt
    if (!agency) {
      // Hors de leurs droits : la base refuserait même une valeur inchangée envoyée par erreur.
      delete (fields as Partial<ProspectFields>).stage
    }
    // Responsable : admin seulement, et figé une fois le prospect converti (commission, migration 0019).
    if (!isAdmin || prospect?.client_id) delete (fields as Partial<ProspectFields>).owner_member_id
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
      const saved = await create.mutateAsync({
        organizationId: organization.id,
        fields: { ...fields, stage: fields.stage ?? 'to_audit' },
      })
      toast.success('Prospect créé')
      // Pré-audit lancé tout de suite : le résultat arrive sur la fiche, sans bloquer la création.
      if (saved.website) {
        audit.mutate(saved.id, {
          onError: (e) => toast.error(`Pré-audit impossible : ${prospectErrorText(e)}`),
        })
      }
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
      title={isEdit ? 'Modifier le prospect' : agency ? 'Nouveau prospect' : 'Ajouter un site'}
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
        {agency ? (
          <div className={styles.row}>
            <Field label="Étape">
              <Select value={draft.stage} onChange={(e) => set('stage', e.target.value as Draft['stage'])} disabled={busy}>
                {allowedStages(role, prospect?.stage ?? 'to_audit').map((s) => (
                  <option key={s} value={s}>
                    {LABELS.prospectStage[s]}
                  </option>
                ))}
              </Select>
            </Field>
            {isAdmin ? (
              <Field label="Responsable">
                <Select
                  value={draft.ownerId}
                  onChange={(e) => set('ownerId', e.target.value)}
                  disabled={busy || Boolean(prospect?.client_id)}
                >
                  <option value="">Non attribué</option>
                  {owners.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
        <div className={styles.row}>
          <Field label="Prochaine action">
            <TextInput type="date" value={draft.nextActionDate} onChange={(e) => set('nextActionDate', e.target.value)} disabled={busy} />
          </Field>
          {isAdmin ? (
            <Field label="Date d’enregistrement" hint="Fait foi pour la commission de l’apporteur.">
              <TextInput type="date" value={draft.registeredAt} onChange={(e) => set('registeredAt', e.target.value)} disabled={busy} />
            </Field>
          ) : null}
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
