import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  Textarea,
  TextInput,
  useToast,
} from '../../components/ui'
import { CLIENT_READ_ROLES, useHasRole } from '../auth/roles'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useCurrentMember } from '../auth/useCurrentMember'
import { safeHref } from '../clients/clientUtils'
import { formatDate } from '../tickets/format'
import { LABELS, PROSPECT_STAGES, type ProspectStage } from '../../shared/types'
import { ProspectAuditCard } from './ProspectAuditCard'
import { AuditNotesCard, OfferCard, type OfferChanges } from './ProspectOfferCards'
import { ProspectFormModal } from './ProspectFormModal'
import { ProspectPitchCard } from './ProspectPitchCard'
import {
  allowedStages,
  canConvertProspect,
  canMarkOfferReady,
  formatRegistered,
  isAgencyRole,
  isActiveStage,
  LOST_REASON_MAX,
  lostReasonError,
  relativeAction,
  reminderPresets,
  STAGE_TONES,
} from './prospectLogic'
import {
  prospectErrorText,
  useCatalogServices,
  useConvertProspect,
  useProspect,
  useRunPitch,
  useRunProspectAudit,
  useUpdateProspect,
  type ProspectChanges,
} from './useProspects'
import styles from './prospects.module.css'

function Value({ children }: { children: string | null | undefined }) {
  return children ? <>{children}</> : <span className={styles.empty}>Non renseigné</span>
}

export function ProspectPage() {
  const { prospectId } = useParams()
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const role = member?.role ?? null
  const agency = isAgencyRole(role)
  const { data: members } = useOrgMembers(organization?.id)
  const canSeeClient = useHasRole(CLIENT_READ_ROLES)
  const { data: prospect, isLoading, isError, refetch } = useProspect(prospectId)
  const { data: services, isLoading: servicesLoading } = useCatalogServices()
  const update = useUpdateProspect()
  const convert = useConvertProspect()
  const audit = useRunProspectAudit()
  const pitch = useRunPitch()

  const [editing, setEditing] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [lostError, setLostError] = useState<string | null>(null)
  const [reminder, setReminder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [pitchError, setPitchError] = useState<string | null>(null)
  // Client créé pendant cette visite (le prospect rechargé porte ensuite son client_id).
  const [createdClientId, setCreatedClientId] = useState<string | null>(null)

  if (isLoading) return <LoadingState label="Chargement du prospect…" />
  if (isError) return <ErrorState message="Impossible de charger le prospect." onRetry={() => void refetch()} />
  if (!prospect) {
    return (
      <EmptyState
        title="Prospect introuvable"
        text="Ce prospect n'existe pas ou tu n'y as pas accès."
        action={<Link to="/prospects">{agency ? 'Retour à la prospection' : 'Retour à mes sites'}</Link>}
      />
    )
  }

  const clientId = prospect.client_id ?? createdClientId
  const website = safeHref(prospect.website)
  const nameOf = (id: string | null) => (members ?? []).find((m) => m.id === id)?.name ?? null
  const owner = nameOf(prospect.owner_member_id)
  const next = relativeAction(prospect, new Date())
  const stages = allowedStages(role, prospect.stage)
  const canLose = prospect.stage !== 'lost' && stages.includes('lost')
  const nextDate = reminder ?? prospect.next_action_date ?? ''
  const contactOk = !prospect.do_not_contact

  async function save(fields: ProspectChanges, success: string): Promise<boolean> {
    if (!prospect) return false
    setError(null)
    try {
      await update.mutateAsync({ prospectId: prospect.id, fields })
      toast.success(success)
      return true
    } catch (e) {
      setError(prospectErrorText(e))
      return false
    }
  }

  async function changeStage(stage: ProspectStage) {
    if (!prospect || stage === prospect.stage) return
    // Sortir de « Perdu » efface la raison du refus.
    await save(prospect.stage === 'lost' ? { stage, lost_reason: null } : { stage }, `Étape : ${LABELS.prospectStage[stage]}`)
  }

  async function confirmLost() {
    const problem = lostReasonError(lostReason)
    setLostError(problem)
    if (problem) return
    if (await save({ stage: 'lost', lost_reason: lostReason.trim() }, 'Prospect marqué comme perdu')) {
      setLostOpen(false)
      setLostReason('')
    }
  }

  async function offerReady(changes: OfferChanges) {
    if (!prospect || !canMarkOfferReady(role, prospect, changes.recommended_service_id ?? '')) return
    await save({ ...changes, stage: 'offer_ready' }, 'Offre prête : l’apporteur est prévenu')
  }

  async function setDoNotContact(value: boolean) {
    // Un prospect qui refuse tout contact n'a plus de rappel.
    await save(
      value ? { do_not_contact: true, next_action_date: null } : { do_not_contact: false },
      value ? 'Noté : ne plus contacter' : 'Contact de nouveau possible',
    )
    setReminder(null)
  }

  async function saveReminder(date: string | null) {
    if (await save({ next_action_date: date }, date ? 'Rappel enregistré' : 'Rappel retiré')) setReminder(null)
  }

  async function convertToClient() {
    if (!prospect) return
    setError(null)
    try {
      const id = await convert.mutateAsync(prospect.id)
      setCreatedClientId(id)
      toast.success('Client et projet créés')
    } catch (e) {
      setError(prospectErrorText(e))
    }
  }

  function runAudit() {
    if (!prospect) return
    setAuditError(null)
    audit.mutate(prospect.id, {
      onError: (e) => setAuditError(prospectErrorText(e)),
    })
  }

  function runPitch() {
    if (!prospect) return
    setPitchError(null)
    pitch.mutate(prospect.id, {
      onSuccess: () => toast.success('Argumentaire généré'),
      onError: (e) => setPitchError(prospectErrorText(e)),
    })
  }

  const clientLink = canSeeClient && clientId ? <Link to={`/clients/${clientId}`}>Voir le client</Link> : null
  const lostElsewhere = prospect.stage === 'lost'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/prospects" label={agency ? 'Prospection' : 'Mes sites'} />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{prospect.company}</h1>
            <Badge tone={STAGE_TONES[prospect.stage]}>{LABELS.prospectStage[prospect.stage]}</Badge>
            {prospect.do_not_contact ? <Badge tone="danger">Ne plus contacter</Badge> : null}
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
            {canLose ? (
              <Button variant="danger" onClick={() => setLostOpen(true)} disabled={update.isPending}>
                Perdu
              </Button>
            ) : null}
            {clientId || !canConvertProspect(role) || lostElsewhere ? null : (
              <Button variant="primary" onClick={() => void convertToClient()} loading={convert.isPending}>
                Convertir en client
              </Button>
            )}
          </div>
        </div>
        {clientId ? (
          <p className={styles.banner} role="status">
            <span>Converti en client</span>
            {clientLink}
          </p>
        ) : prospect.stage === 'won' ? (
          <p className={styles.notice} role="status">
            Gagné, mais pas encore converti en client : la commission n’est calculée qu’une fois le client créé.
          </p>
        ) : null}
        {prospect.do_not_contact ? (
          <p className={styles.warning} role="status">
            Ce prospect s’oppose à tout nouveau contact. Aucune relance, aucun mail, aucun appel.
          </p>
        ) : null}
        {lostElsewhere && prospect.lost_reason ? (
          <p className={styles.notice} role="status">
            Raison du refus : {prospect.lost_reason}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </header>

      <section className={styles.section} aria-labelledby="prospect-stage">
        <h2 id="prospect-stage" className={styles.sectionTitle}>
          Étape
        </h2>
        <div className={styles.stages} role="group" aria-label="Changer l’étape">
          {PROSPECT_STAGES.filter((s) => stages.includes(s)).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === prospect.stage ? 'primary' : 'secondary'}
              aria-pressed={s === prospect.stage}
              disabled={update.isPending}
              onClick={() => (s === 'lost' ? setLostOpen(true) : void changeStage(s))}
            >
              {LABELS.prospectStage[s]}
            </Button>
          ))}
        </div>
        {!agency && prospect.stage === 'to_audit' ? (
          <p className={styles.muted}>L’agence audite le site et choisit l’offre. Tu seras prévenue quand elle sera prête.</p>
        ) : null}
      </section>

      <ProspectAuditCard prospect={prospect} canRun running={audit.isPending} onRun={runAudit} error={auditError} />

      <AuditNotesCard
        key={`notes-${prospect.audit_notes ?? ''}`}
        prospect={prospect}
        auditorName={nameOf(prospect.audited_by)}
        canEdit={agency}
        saving={update.isPending}
        onSave={(notes) => void save({ audit_notes: notes }, 'Audit enregistré')}
      />

      {agency || prospect.recommended_service_id ? (
        <OfferCard
          key={`offer-${prospect.recommended_service_id ?? ''}-${prospect.offer_notes ?? ''}-${prospect.stage}`}
          prospect={prospect}
          services={services ?? []}
          servicesLoading={servicesLoading}
          role={role ?? 'prospection'}
          saving={update.isPending}
          onSave={(changes) => void save(changes, 'Offre enregistrée')}
          onOfferReady={(changes) => void offerReady(changes)}
        />
      ) : null}

      {agency || prospect.stage !== 'to_audit' ? (
        <ProspectPitchCard
          key={`pitch-${prospect.pitch ?? ''}`}
          prospect={prospect}
          generating={pitch.isPending}
          saving={update.isPending}
          error={pitchError}
          onGenerate={runPitch}
          onSave={(text) => void save({ pitch: text }, 'Argumentaire enregistré')}
        />
      ) : null}

      <section className={styles.section} aria-labelledby="prospect-infos">
        <h2 id="prospect-infos" className={styles.sectionTitle}>
          Infos
        </h2>
        <dl className={styles.infos}>
          <dt>Enregistré le</dt>
          <dd>
            <Value>{formatRegistered(prospect.registered_at)}</Value>
          </dd>
          <dt>Prochaine action</dt>
          <dd>
            {prospect.next_action_date ? (
              <span className={next?.overdue ? styles.overdue : undefined}>
                {formatDate(`${prospect.next_action_date}T00:00:00`)}
                {next ? ` (${next.text.toLowerCase()})` : ''}
              </span>
            ) : (
              <Value>{null}</Value>
            )}
          </dd>
          <dt>Responsable</dt>
          <dd>
            <Value>{owner}</Value>
          </dd>
          <dt>Source</dt>
          <dd>
            <Value>{prospect.source}</Value>
          </dd>
          <dt>Site web</dt>
          <dd>
            {website ? (
              <a href={website} target="_blank" rel="noreferrer" className={styles.link}>
                {prospect.website}
              </a>
            ) : (
              <Value>{prospect.website}</Value>
            )}
          </dd>
          <dt>Contact</dt>
          <dd>
            <Value>{prospect.contact_name}</Value>
          </dd>
          <dt>Email</dt>
          <dd>
            {prospect.contact_email && contactOk ? (
              <a href={`mailto:${prospect.contact_email}`} className={styles.link}>
                {prospect.contact_email}
              </a>
            ) : (
              <Value>{contactOk ? null : 'Masqué : ne plus contacter'}</Value>
            )}
          </dd>
          <dt>Téléphone</dt>
          <dd>
            {prospect.contact_phone && contactOk ? (
              <a href={`tel:${prospect.contact_phone}`} className={styles.link}>
                {prospect.contact_phone}
              </a>
            ) : (
              <Value>{contactOk ? null : 'Masqué : ne plus contacter'}</Value>
            )}
          </dd>
        </dl>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={prospect.do_not_contact}
            disabled={update.isPending}
            onChange={(e) => void setDoNotContact(e.target.checked)}
          />
          <span>
            <span className={styles.pointLabel}>Ne plus contacter</span>
            <span className={styles.muted}>
              {' '}
              Le prospect s’oppose à tout nouveau contact. Les actions de contact sont masquées et le rappel est retiré.
            </span>
          </span>
        </label>
      </section>

      {isActiveStage(prospect.stage) && contactOk ? (
        <section className={styles.section} aria-labelledby="prospect-reminder">
          <h2 id="prospect-reminder" className={styles.sectionTitle}>
            Prochaine action
          </h2>
          <div className={styles.reminder}>
            <Field label="Rappel à la date du">
              <TextInput type="date" value={nextDate} onChange={(e) => setReminder(e.target.value)} disabled={update.isPending} />
            </Field>
            <Button
              variant="secondary"
              onClick={() => void saveReminder(nextDate === '' ? null : nextDate)}
              disabled={nextDate === (prospect.next_action_date ?? '')}
              loading={update.isPending}
            >
              Enregistrer le rappel
            </Button>
          </div>
          <div className={styles.stages} role="group" aria-label="Raccourcis de rappel">
            {reminderPresets(new Date()).map((preset) => (
              <Button
                key={preset.date}
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => void saveReminder(preset.date)}
              >
                {preset.label}
              </Button>
            ))}
            {prospect.next_action_date ? (
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => void saveReminder(null)}>
                Retirer le rappel
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="prospect-notes">
        <h2 id="prospect-notes" className={styles.sectionTitle}>
          Notes
        </h2>
        <p className={styles.multiline}>
          <Value>{prospect.notes}</Value>
        </p>
      </section>

      <ProspectFormModal open={editing} onClose={() => setEditing(false)} prospect={prospect} />

      <Modal
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        dismissible={!update.isPending}
        title="Marquer ce prospect comme perdu ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setLostOpen(false)} disabled={update.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void confirmLost()} loading={update.isPending}>
              Marquer comme perdu
            </Button>
          </>
        }
      >
        <p>
          « {prospect.company} » passera à l’étape « Perdu » et quittera les prospects en cours. Il reste consultable et peut être remis en
          cours plus tard.
        </p>
        <Field label="Raison du refus" error={lostError} hint="Elle reste sur la fiche, pour l’équipe et pour l’apporteur.">
          <Textarea
            rows={3}
            maxLength={LOST_REASON_MAX}
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            disabled={update.isPending}
          />
        </Field>
      </Modal>
    </div>
  )
}
