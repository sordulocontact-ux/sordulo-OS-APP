import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, Textarea, TextInput, useToast } from '../../components/ui'
import { LABELS, LINE_UNITS, type LineUnit, type Service } from '../../shared/types'
import { LinesEditor } from '../billing'
import { useCurrentMember } from '../auth/useCurrentMember'
import {
  draftFromService,
  emptyServiceDraft,
  servicePayload,
  validateServiceDraft,
  type OrgDefaults,
  type ServiceDraft,
} from './catalogLogic'
import { TaskTemplatesEditor } from './TaskTemplatesEditor'
import { catalogErrorText, useSaveService } from './useCatalog'
import styles from './catalog.module.css'

export interface ServiceFormModalProps {
  open: boolean
  onClose: () => void
  /** Prestation à modifier ; absent = création. */
  service?: Service | null
  /** Ordre proposé pour une nouvelle prestation. */
  nextPosition: number
  /** Catégories déjà utilisées (suggestions). */
  categories: string[]
}

const FALLBACK_ORG: OrgDefaults = { default_daily_rate: null, default_hourly_rate: null, default_vat_rate: 20 }

export function ServiceFormModal({ open, onClose, service, nextPosition, categories }: ServiceFormModalProps) {
  const toast = useToast()
  const { organization } = useCurrentMember()
  const save = useSaveService()
  const org: OrgDefaults = organization ?? FALLBACK_ORG
  const isEdit = Boolean(service)

  const [draft, setDraft] = useState<ServiceDraft>(() => (service ? draftFromService(service) : emptyServiceDraft(org, nextPosition)))
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(service ? draftFromService(service) : emptyServiceDraft(org, nextPosition))
      setShowErrors(false)
      setError(null)
      save.reset()
    }
  }

  const busy = save.isPending
  const errors = validateServiceDraft(draft)
  const shown = showErrors ? errors : null

  function set<K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) {
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
    if (errors.any) return
    if (!organization) {
      setError('Ton organisation est introuvable. Recharge la page.')
      return
    }
    try {
      await save.mutateAsync({ id: service?.id ?? null, organizationId: organization.id, payload: servicePayload(draft) })
      toast.success(isEdit ? 'Prestation modifiée' : 'Prestation créée')
      onClose()
    } catch (e) {
      setError(catalogErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!busy}
      title={isEdit ? 'Modifier la prestation' : 'Nouvelle prestation'}
      actions={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="service-form" loading={busy}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form id="service-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Nom" error={shown?.name}>
          <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={busy} required />
        </Field>
        <div className={styles.row}>
          <Field label="Catégorie" hint="Facultative : Branding, Site web, App…" error={shown?.category}>
            <TextInput list="catalog-categories" value={draft.category} onChange={(e) => set('category', e.target.value)} disabled={busy} />
            <datalist id="catalog-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Ordre d’affichage" hint="Les plus petits d’abord." error={shown?.position}>
            <TextInput inputMode="numeric" value={draft.position} onChange={(e) => set('position', e.target.value)} disabled={busy} />
          </Field>
        </div>
        <Field label="Description" error={shown?.description}>
          <Textarea value={draft.description} onChange={(e) => set('description', e.target.value)} disabled={busy} rows={3} />
        </Field>
        <div className={styles.row}>
          <Field label="Unité">
            <Select value={draft.unit} onChange={(e) => set('unit', e.target.value as LineUnit)} disabled={busy}>
              {LINE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {LABELS.lineUnit[unit]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prix unitaire HT (€)" error={shown?.price}>
            <TextInput inputMode="decimal" className={styles.number} value={draft.price} onChange={(e) => set('price', e.target.value)} disabled={busy} />
          </Field>
          <Field label="TVA (%)" error={shown?.vat}>
            <TextInput inputMode="decimal" className={styles.number} value={draft.vat} onChange={(e) => set('vat', e.target.value)} disabled={busy} />
          </Field>
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Lignes de devis types</legend>
          <p className={styles.hint}>
            Ajoutées au devis quand on choisit la prestation. Sans ligne type, une seule ligne est créée avec l’unité, le prix et la TVA ci-dessus.
          </p>
          <LinesEditor
            lines={draft.lines}
            onChange={(lines) => set('lines', lines)}
            org={org}
            showErrors={showErrors}
          />
          {shown?.lines ? <p className={styles.fieldError}>{shown.lines}</p> : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Tâches types</legend>
          <p className={styles.hint}>
            Proposées comme tickets à valider quand un devis contenant la prestation est accepté. Durée en heures, par pas de 0,25.
          </p>
          <TaskTemplatesEditor tasks={draft.tasks} onChange={(tasks) => set('tasks', tasks)} errors={shown?.tasks} disabled={busy} />
        </fieldset>

        <label className={styles.check}>
          <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} disabled={busy} />
          Active (proposée dans les devis)
        </label>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
