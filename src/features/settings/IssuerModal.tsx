import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, TextInput, Textarea, useToast } from '../../components/ui'
import type { BillingIssuer, Member } from '../../shared/types'
import { buildIssuerValues, issuerErrorText, toIssuerForm, type IssuerForm, type IssuerFormErrors } from './issuerLogic'
import { formatIban, LEGAL_FORMS } from './settingsLogic'
import { useCreateIssuer, useUpdateIssuer } from './useIssuers'
import styles from './IssuersCard.module.css'

export interface IssuerModalProps {
  organizationId: string
  /** null : création. */
  issuer: BillingIssuer | null
  /** Membres actifs proposés pour le lien facultatif. */
  members: readonly Pick<Member, 'id' | 'name'>[]
  onClose: () => void
}

/** Ajout ou modification d'un émetteur. Monté à l'ouverture (le formulaire repart d'un état neuf). */
export function IssuerModal({ organizationId, issuer, members, onClose }: IssuerModalProps) {
  const toast = useToast()
  const create = useCreateIssuer(organizationId)
  const update = useUpdateIssuer(organizationId)
  const [form, setForm] = useState<IssuerForm>(() => toIssuerForm(issuer))
  const [errors, setErrors] = useState<IssuerFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const busy = create.isPending || update.isPending
  const formId = 'issuer-form'

  function set<K extends keyof IssuerForm>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    const result = buildIssuerValues(form)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    try {
      if (issuer) await update.mutateAsync({ id: issuer.id, patch: result.values })
      else await create.mutateAsync(result.values)
      toast.success(issuer ? 'Émetteur modifié' : 'Émetteur ajouté')
      onClose()
    } catch (e) {
      setError(issuerErrorText(e))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={issuer ? 'Modifier l’émetteur' : 'Ajouter un émetteur'}
      dismissible={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {issuer ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Nom affiché" hint="Le nom que tu reconnais dans les listes, par exemple « Sacha Moricet »." error={errors.displayName}>
          <TextInput value={form.displayName} onChange={(e) => set('displayName', e.target.value)} disabled={busy} required />
        </Field>
        <Field label="Membre lié (facultatif)" hint="La personne de l’équipe derrière cette entité.">
          <Select value={form.memberId} onChange={(e) => set('memberId', e.target.value)} disabled={busy}>
            <option value="">Aucun membre</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.pair}>
          <Field label="Raison sociale">
            <TextInput value={form.legalName} onChange={(e) => set('legalName', e.target.value)} disabled={busy} />
          </Field>
          <Field label="Forme juridique">
            <TextInput list="issuer-legal-forms" value={form.legalForm} onChange={(e) => set('legalForm', e.target.value)} disabled={busy} />
          </Field>
        </div>
        <datalist id="issuer-legal-forms">
          {LEGAL_FORMS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <Field label="SIRET" hint="14 chiffres, avec ou sans espaces." error={errors.siret}>
          <TextInput inputMode="numeric" value={form.siret} onChange={(e) => set('siret', e.target.value)} disabled={busy} />
        </Field>
        <Field label="Rue">
          <TextInput value={form.street} onChange={(e) => set('street', e.target.value)} autoComplete="off" disabled={busy} />
        </Field>
        <div className={styles.pair}>
          <Field label="Code postal">
            <TextInput value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
          <Field label="Ville">
            <TextInput value={form.city} onChange={(e) => set('city', e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
        </div>
        <Field label="Pays">
          <TextInput value={form.country} onChange={(e) => set('country', e.target.value)} autoComplete="off" disabled={busy} />
        </Field>
        <Field label="Mention TVA" hint="Par exemple : TVA non applicable, art. 293 B du CGI.">
          <Textarea rows={2} value={form.vatMention} onChange={(e) => set('vatMention', e.target.value)} disabled={busy} />
        </Field>
        <Field label="N° de TVA intracommunautaire" hint="Laisse vide en franchise de TVA : sans lui, il est déduit du SIRET quand la facture porte de la TVA.">
          <TextInput value={form.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} autoComplete="off" disabled={busy} />
        </Field>
        <div className={styles.pair}>
          <Field label="IBAN" error={errors.iban}>
            <TextInput
              value={form.iban}
              onChange={(e) => set('iban', e.target.value)}
              onBlur={() => setForm((current) => ({ ...current, iban: formatIban(current.iban) }))}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
          <Field label="BIC" hint="8 ou 11 caractères." error={errors.bic}>
            <TextInput value={form.bic} onChange={(e) => set('bic', e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
        </div>
        <div className={styles.pair}>
          <Field label="E-mail" error={errors.email}>
            <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
          <Field label="Téléphone">
            <TextInput type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" disabled={busy} />
          </Field>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
