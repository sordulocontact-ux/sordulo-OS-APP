import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BackLink, Badge, Button, EmptyState, ErrorState, LoadingState, Modal, useToast } from '../../components/ui'
import { CLIENT_READ_ROLES, useHasRole } from '../auth/roles'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useCurrentMember } from '../auth/useCurrentMember'
import { safeHref } from '../clients/clientUtils'
import { formatDate } from '../tickets/format'
import { LABELS, PROSPECT_STAGES, type ProspectStage } from '../../shared/types'
import { ProspectFormModal } from './ProspectFormModal'
import { relativeAction, STAGE_TONES } from './prospectLogic'
import { prospectErrorText, useConvertProspect, useProspect, useUpdateProspect } from './useProspects'
import styles from './prospects.module.css'

function Value({ children }: { children: string | null | undefined }) {
  return children ? <>{children}</> : <span className={styles.empty}>Non renseigné</span>
}

export function ProspectPage() {
  const { prospectId } = useParams()
  const toast = useToast()
  const { organization } = useCurrentMember()
  const { data: members } = useOrgMembers(organization?.id)
  const canSeeClient = useHasRole(CLIENT_READ_ROLES)
  const { data: prospect, isLoading, isError, refetch } = useProspect(prospectId)
  const update = useUpdateProspect()
  const convert = useConvertProspect()

  const [editing, setEditing] = useState(false)
  const [confirmLost, setConfirmLost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Client créé pendant cette visite (le prospect rechargé porte ensuite son client_id).
  const [createdClientId, setCreatedClientId] = useState<string | null>(null)

  if (isLoading) return <LoadingState label="Chargement du prospect…" />
  if (isError) return <ErrorState message="Impossible de charger le prospect." onRetry={() => void refetch()} />
  if (!prospect) {
    return (
      <EmptyState
        title="Prospect introuvable"
        text="Ce prospect n'existe pas ou tu n'y as pas accès."
        action={<Link to="/prospects">Retour à la prospection</Link>}
      />
    )
  }

  const clientId = prospect.client_id ?? createdClientId
  const website = safeHref(prospect.website)
  const owner = (members ?? []).find((m) => m.id === prospect.owner_member_id)?.name ?? null
  const next = relativeAction(prospect, new Date())

  async function changeStage(stage: ProspectStage) {
    if (!prospect || stage === prospect.stage) return
    setError(null)
    try {
      await update.mutateAsync({ prospectId: prospect.id, fields: { stage } })
      setConfirmLost(false)
      toast.success(`Étape : ${LABELS.prospectStage[stage]}`)
    } catch (e) {
      setError(prospectErrorText(e))
      setConfirmLost(false)
    }
  }

  async function convertToClient() {
    if (!prospect) return
    setError(null)
    try {
      const id = await convert.mutateAsync(prospect.id)
      setCreatedClientId(id)
      toast.success('Client créé')
    } catch (e) {
      setError(prospectErrorText(e))
    }
  }

  const clientLink = canSeeClient && clientId ? <Link to={`/clients/${clientId}`}>Voir le client</Link> : null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/prospects" label="Prospection" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{prospect.company}</h1>
            <Badge tone={STAGE_TONES[prospect.stage]}>{LABELS.prospectStage[prospect.stage]}</Badge>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
            {prospect.stage !== 'lost' ? (
              <Button variant="danger" onClick={() => setConfirmLost(true)} disabled={update.isPending}>
                Perdu
              </Button>
            ) : null}
            {clientId ? null : (
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
          {PROSPECT_STAGES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === prospect.stage ? 'primary' : 'secondary'}
              aria-pressed={s === prospect.stage}
              disabled={update.isPending}
              onClick={() => (s === 'lost' ? setConfirmLost(true) : void changeStage(s))}
            >
              {LABELS.prospectStage[s]}
            </Button>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="prospect-infos">
        <h2 id="prospect-infos" className={styles.sectionTitle}>
          Infos
        </h2>
        <dl className={styles.infos}>
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
            {prospect.contact_email ? (
              <a href={`mailto:${prospect.contact_email}`} className={styles.link}>
                {prospect.contact_email}
              </a>
            ) : (
              <Value>{null}</Value>
            )}
          </dd>
          <dt>Téléphone</dt>
          <dd>
            {prospect.contact_phone ? (
              <a href={`tel:${prospect.contact_phone}`} className={styles.link}>
                {prospect.contact_phone}
              </a>
            ) : (
              <Value>{null}</Value>
            )}
          </dd>
        </dl>
      </section>

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
        open={confirmLost}
        onClose={() => setConfirmLost(false)}
        dismissible={!update.isPending}
        title="Marquer ce prospect comme perdu ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmLost(false)} disabled={update.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void changeStage('lost')} loading={update.isPending}>
              Marquer comme perdu
            </Button>
          </>
        }
      >
        <p>
          « {prospect.company} » passera à l’étape « Perdu » et quittera les prospects en cours. Il reste consultable et tu
          peux le remettre en cours quand tu veux.
        </p>
      </Modal>
    </div>
  )
}
