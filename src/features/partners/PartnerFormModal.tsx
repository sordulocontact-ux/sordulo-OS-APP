import { useState, type FormEvent } from 'react'
import { Badge, Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { PARTNER_RATING_MAX, PARTNER_RATING_MIN, type Partner, type PartnerCategory } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import {
  draftFromPartner,
  emptyPartnerDraft,
  parseSkills,
  partnerPayload,
  PARTNER_CATEGORY_OPTIONS,
  validatePartnerDraft,
  type PartnerDraft,
} from './partnerLogic'
import { partnerErrorText, useSavePartner } from './usePartners'
import styles from './partners.module.css'

export interface PartnerFormModalProps {
  open: boolean
  onClose: () => void
  /** Partenaire à modifier ; absent = création. */
  partner?: Partner | null
  /** Compétences déjà utilisées dans le réseau (suggestions). */
  knownSkills?: string[]
  onSaved?: (partner: Partner) => void
}

const RATINGS = Array.from({ length: PARTNER_RATING_MAX - PARTNER_RATING_MIN + 1 }, (_, i) => PARTNER_RATING_MIN + i)

/** Création et modification d'un partenaire du réseau. */
export function PartnerFormModal({ open, onClose, partner, knownSkills = [], onSaved }: PartnerFormModalProps) {
  const toast = useToast()
  const { organization } = useCurrentMember()
  const save = useSavePartner()
  const isEdit = Boolean(partner)

  const [draft, setDraft] = useState<PartnerDraft>(() => (partner ? draftFromPartner(partner) : emptyPartnerDraft()))
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(partner ? draftFromPartner(partner) : emptyPartnerDraft())
      setShowErrors(false)
      setError(null)
      save.reset()
    }
  }

  const busy = save.isPending
  const errors = validatePartnerDraft(draft)
  const shown = showErrors ? errors : null
  const skills = parseSkills(draft.skills)
  const suggestions = knownSkills.filter((s) => !skills.some((t) => t.toLocaleLowerCase('fr') === s.toLocaleLowerCase('fr'))).slice(0, 8)

  function set<K extends keyof PartnerDraft>(key: K, value: PartnerDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function addSkill(skill: string) {
    set('skills', [...skills, skill].join(', '))
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
    if (errors.any) return
    if (!organization) {
      setError('Ton organisation est introuvable. Recharge la page.')
      return
    }
    try {
      const saved = await save.mutateAsync({ id: partner?.id ?? null, organizationId: organization.id, payload: partnerPayload(draft) })
      toast.success(isEdit ? 'Partenaire modifié' : 'Partenaire ajouté')
      onClose()
      onSaved?.(saved)
    } catch (e) {
      setError(partnerErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={isEdit ? 'Modifier le partenaire' : 'Nouveau partenaire'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="partner-form" loading={busy}>
            {isEdit ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <form id="partner-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.row}>
          <Field label="Nom" error={shown?.name}>
            <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={busy} required autoComplete="off" />
          </Field>
          <Field label="Société" hint="Facultative.">
            <TextInput value={draft.company} onChange={(e) => set('company', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Métier">
            <Select value={draft.category} onChange={(e) => set('category', e.target.value as PartnerCategory)} disabled={busy}>
              {PARTNER_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tarif jour indicatif HT (€)" hint="Ce qu’il nous facture, pas un prix client." error={shown?.dayRate}>
            <TextInput inputMode="decimal" className={styles.number} value={draft.dayRate} onChange={(e) => set('dayRate', e.target.value)} disabled={busy} />
          </Field>
        </div>
        <Field label="Compétences" hint="Sépare-les par des virgules : Motion, Figma, Shopify…" error={shown?.skills}>
          <TextInput value={draft.skills} onChange={(e) => set('skills', e.target.value)} disabled={busy} autoComplete="off" />
        </Field>
        {skills.length > 0 || suggestions.length > 0 ? (
          <div className={styles.skillsPreview}>
            {skills.map((skill) => (
              <Badge key={skill}>{skill}</Badge>
            ))}
            {suggestions.map((skill) => (
              <button key={skill} type="button" className={styles.suggestion} onClick={() => addSkill(skill)} disabled={busy}>
                + {skill}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.row}>
          <Field label="Email" error={shown?.email}>
            <TextInput type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
          <Field label="Téléphone">
            <TextInput type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Site ou portfolio" error={shown?.website}>
            <TextInput inputMode="url" value={draft.website} onChange={(e) => set('website', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
          <Field label="Ville">
            <TextInput value={draft.city} onChange={(e) => set('city', e.target.value)} disabled={busy} autoComplete="off" />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Évaluation" hint="Facultative, visible de l’équipe seulement." error={shown?.rating}>
            <Select value={draft.rating} onChange={(e) => set('rating', e.target.value)} disabled={busy}>
              <option value="">Non évalué</option>
              {RATINGS.map((r) => (
                <option key={r} value={String(r)}>
                  {r} / {PARTNER_RATING_MAX}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Disponibilité" hint="Ex. « Libre à partir de janvier ».">
            <TextInput value={draft.availability} maxLength={200} onChange={(e) => set('availability', e.target.value)} disabled={busy} />
          </Field>
        </div>
        <Field label="Note interne">
          <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} disabled={busy} rows={4} />
        </Field>
      </form>
    </Modal>
  )
}
