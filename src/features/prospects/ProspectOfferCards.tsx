import { useState } from 'react'
import { Button, Field, Select, Textarea } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { LABELS, type MemberRole, type Prospect, type Service } from '../../shared/types'
import { formatDate } from '../tickets/format'
import { canMarkOfferReady, isAgencyRole } from './prospectLogic'
import styles from './prospects.module.css'

const AUDIT_NOTES_MAX = 10_000
const OFFER_NOTES_MAX = 4000

export interface AuditNotesCardProps {
  prospect: Prospect
  auditorName: string | null
  /** Admin et membre écrivent ; l'apporteur lit seulement. */
  canEdit: boolean
  saving: boolean
  onSave: (notes: string | null) => void
}

/** Audit humain : notes de l'agence (admin, membre). L'apporteur les lit sans pouvoir les modifier. */
export function AuditNotesCard({ prospect, auditorName, canEdit, saving, onSave }: AuditNotesCardProps) {
  const [draft, setDraft] = useState(prospect.audit_notes ?? '')
  const dirty = draft.trim() !== (prospect.audit_notes ?? '').trim()
  const tooLong = draft.length > AUDIT_NOTES_MAX
  if (!canEdit && !prospect.audit_notes) return null
  return (
    <section className={styles.section} aria-labelledby="prospect-audit-notes">
      <h2 id="prospect-audit-notes" className={styles.sectionTitle}>
        Audit de l’agence
      </h2>
      {canEdit ? (
        <>
          <Field
            label="Notes d’audit"
            hint="Ce que tu as relevé en regardant le site. L’apporteur les lit, l’argumentaire s’en sert."
            error={tooLong ? `${AUDIT_NOTES_MAX} caractères au plus.` : null}
          >
            <Textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving} />
          </Field>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => onSave(draft.trim() === '' ? null : draft.trim())}
              disabled={!dirty || tooLong}
              loading={saving}
            >
              Enregistrer l’audit
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.multiline}>{prospect.audit_notes}</p>
      )}
      {prospect.audited_at ? (
        <p className={styles.muted}>
          Audité{auditorName ? ` par ${auditorName}` : ''} le {formatDate(prospect.audited_at)}.
        </p>
      ) : null}
    </section>
  )
}

export interface OfferChanges {
  recommended_service_id: string | null
  offer_notes: string | null
}

export interface OfferCardProps {
  prospect: Prospect
  services: readonly Service[]
  servicesLoading: boolean
  role: MemberRole
  saving: boolean
  onSave: (changes: OfferChanges) => void
  /** Enregistre l'offre et passe le prospect à « Offre prête » (la base notifie l'apporteur). */
  onOfferReady: (changes: OfferChanges) => void
}

function unitPrice(service: Service): string {
  return `${formatMoney(service.unit_price_cents)} HT par ${LABELS.lineUnit[service.unit]}`
}

/** Offre recommandée du catalogue : choisie par l'agence, lue par l'apporteur. */
export function OfferCard({ prospect, services, servicesLoading, role, saving, onSave, onOfferReady }: OfferCardProps) {
  const [serviceId, setServiceId] = useState(prospect.recommended_service_id ?? '')
  const [notes, setNotes] = useState(prospect.offer_notes ?? '')
  const current = services.find((s) => s.id === prospect.recommended_service_id) ?? null
  const options = services.filter((s) => s.active || s.id === prospect.recommended_service_id)
  const changes: OfferChanges = {
    recommended_service_id: serviceId === '' ? null : serviceId,
    offer_notes: notes.trim() === '' ? null : notes.trim(),
  }
  const dirty = serviceId !== (prospect.recommended_service_id ?? '') || notes.trim() !== (prospect.offer_notes ?? '').trim()
  const tooLong = notes.length > OFFER_NOTES_MAX

  if (!isAgencyRole(role)) {
    return (
      <section className={styles.section} aria-labelledby="prospect-offer">
        <h2 id="prospect-offer" className={styles.sectionTitle}>
          Offre recommandée
        </h2>
        {current ? (
          <>
            <p className={styles.pointLabel}>{current.name}</p>
            {current.description ? <p className={styles.multiline}>{current.description}</p> : null}
            <p className={styles.muted}>{unitPrice(current)}</p>
            {prospect.offer_notes ? <p className={styles.multiline}>{prospect.offer_notes}</p> : null}
          </>
        ) : prospect.recommended_service_id && servicesLoading ? (
          <p className={styles.muted}>Chargement de l’offre…</p>
        ) : (
          <p className={styles.muted}>L’agence prépare l’offre de ce site. Tu seras prévenue quand elle sera prête.</p>
        )}
      </section>
    )
  }

  return (
    <section className={styles.section} aria-labelledby="prospect-offer">
      <h2 id="prospect-offer" className={styles.sectionTitle}>
        Offre recommandée
      </h2>
      <Field label="Prestation du catalogue">
        <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={saving || servicesLoading}>
          <option value="">{servicesLoading ? 'Chargement du catalogue…' : 'Aucune offre choisie'}</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({unitPrice(s)})
            </option>
          ))}
        </Select>
      </Field>
      {!servicesLoading && options.length === 0 ? (
        <p className={styles.muted}>Le catalogue est vide : ajoute d’abord des prestations.</p>
      ) : null}
      <Field
        label="Notes d’offre"
        hint="Ce que l’apporteur doit savoir pour présenter l’offre (périmètre, angle, remise éventuelle)."
        error={tooLong ? `${OFFER_NOTES_MAX} caractères au plus.` : null}
      >
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
      </Field>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => onSave(changes)} disabled={!dirty || tooLong} loading={saving}>
          Enregistrer l’offre
        </Button>
        {canMarkOfferReady(role, prospect, serviceId) ? (
          <Button variant="primary" onClick={() => onOfferReady(changes)} disabled={tooLong} loading={saving}>
            Offre prête
          </Button>
        ) : null}
      </div>
      {prospect.stage === 'to_audit' && serviceId === '' ? (
        <p className={styles.muted}>Choisis une offre pour pouvoir la marquer prête et prévenir l’apporteur.</p>
      ) : null}
    </section>
  )
}
