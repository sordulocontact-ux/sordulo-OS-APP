import { useState } from 'react'
import { Badge, Button, Card, Field, Modal, Textarea, useToast } from '../../components/ui'
import { DeliverableViewer, type NewCommentInput } from '../deliverables/DeliverableViewer'
import { CLIENT_DELIVERABLE_LABEL, DELIVERABLE_STATUS_TONE, canDecide, formatDateTime, latestVersion } from '../deliverables/deliverableLogic'
import type { PortalDeliverable, PortalVersion } from './portalContract'
import type { ClientNameState } from './PortalPage'
import { portalErrorText, usePortalAction } from './usePortal'
import styles from './PortalPage.module.css'

interface Props {
  token: string
  deliverables: readonly PortalDeliverable[]
  nameState: ClientNameState
}

export function PortalDeliverables({ token, deliverables, nameState }: Props) {
  return (
    <section className={styles.section} aria-labelledby="portal-deliverables">
      <h2 id="portal-deliverables" className={styles.sectionTitle}>
        Livrables
      </h2>
      <p className={styles.sectionHint}>
        Cliquez sur une image pour laisser un commentaire à l’endroit précis, puis validez ou demandez des modifications.
      </p>
      {deliverables.map((d) => (
        <DeliverableCard key={d.id} token={token} deliverable={d} nameState={nameState} />
      ))}
    </section>
  )
}

type Decision = 'approve' | 'request_changes'

function DeliverableCard({ token, deliverable, nameState }: { token: string; deliverable: PortalDeliverable; nameState: ClientNameState }) {
  const toast = useToast()
  const action = usePortalAction(token)
  const latest = latestVersion(deliverable.versions)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const version = deliverable.versions.find((v) => v.version === selectedNumber) ?? latest
  const [decision, setDecision] = useState<Decision | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)

  async function comment(input: NewCommentInput): Promise<boolean> {
    if (!version) return false
    const authorName = nameState.requireName()
    if (!authorName) return false
    try {
      await action.mutateAsync({ action: 'comment', versionId: version.id, x: input.x, y: input.y, body: input.body, authorName })
      toast.success('Commentaire envoyé à l’équipe')
      return true
    } catch (error) {
      toast.error(portalErrorText(error))
      return false
    }
  }

  function openDecision(next: Decision) {
    if (!nameState.requireName()) return
    setNote('')
    setNoteError(null)
    setDecision(next)
  }

  function confirmDecision(target: PortalVersion) {
    const authorName = nameState.requireName()
    if (!authorName || !decision) return
    const text = note.trim()
    if (decision === 'request_changes' && !text && target.comments.every((c) => c.resolved || !c.fromClient)) {
      setNoteError('Dites en quelques mots ce qui doit changer (ou laissez des commentaires sur l’image).')
      return
    }
    action.mutate(
      { action: decision, versionId: target.id, authorName, note: text || undefined },
      {
        onSuccess: () => {
          setDecision(null)
          toast.success(decision === 'approve' ? `V${target.version} validée, merci !` : 'Demande de modifications envoyée à l’équipe')
        },
        onError: (error) => toast.error(portalErrorText(error)),
      },
    )
  }

  return (
    <Card className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{deliverable.title}</h3>
        <Badge tone={DELIVERABLE_STATUS_TONE[deliverable.status]}>{CLIENT_DELIVERABLE_LABEL[deliverable.status]}</Badge>
      </div>
      {deliverable.description ? <p className={styles.text}>{deliverable.description}</p> : null}

      {!version ? (
        <p className={styles.text}>La première version arrive bientôt.</p>
      ) : (
        <>
          {deliverable.versions.length > 1 ? (
            <div className={styles.versions} role="group" aria-label={`Versions de ${deliverable.title}`}>
              {deliverable.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`${styles.versionButton} ${v.id === version.id ? styles.versionButtonActive : ''}`}
                  aria-pressed={v.id === version.id}
                  onClick={() => setSelectedNumber(v.version)}
                >
                  V{v.version}
                </button>
              ))}
            </div>
          ) : null}

          <p className={styles.versionInfo}>
            <strong>V{version.version}</strong>, partagée le {formatDateTime(version.createdAt)}
            {version.status !== 'pending' && version.decidedAt
              ? ` · ${version.status === 'approved' ? 'Validée' : 'Modifications demandées'} par ${version.decidedByName ?? 'vous'} le ${formatDateTime(version.decidedAt)}`
              : null}
          </p>
          {version.note ? <p className={styles.note}>{version.note}</p> : null}

          <DeliverableViewer
            key={version.id}
            fileName={version.file.name}
            mimeType={version.file.mimeType}
            url={version.file.url}
            comments={version.comments}
            onAddComment={comment}
            clientLabel="Vous"
            teamLabel="Agence"
          />

          {canDecide(version, deliverable.versions) ? (
            <div className={styles.decision}>
              <p className={styles.decisionText}>Cette version vous convient ?</p>
              <div className={styles.decisionActions}>
                <Button onClick={() => openDecision('request_changes')}>Demander des modifications</Button>
                <Button variant="primary" onClick={() => openDecision('approve')}>
                  Valider la V{version.version}
                </Button>
              </div>
            </div>
          ) : version.version !== latest?.version ? (
            <p className={styles.text}>
              Version précédente.{' '}
              <button type="button" className={styles.linkButton} onClick={() => setSelectedNumber(null)}>
                Voir la V{latest?.version}
              </button>
            </p>
          ) : null}

          <Modal
            open={decision !== null}
            onClose={() => setDecision(null)}
            title={decision === 'approve' ? `Valider la V${version.version} ?` : 'Demander des modifications'}
            actions={
              <>
                <Button onClick={() => setDecision(null)}>Annuler</Button>
                <Button variant="primary" loading={action.isPending} onClick={() => confirmDecision(version)}>
                  {decision === 'approve' ? 'Valider' : 'Envoyer la demande'}
                </Button>
              </>
            }
          >
            <div className={styles.form}>
              <p className={styles.text}>
                {decision === 'approve'
                  ? `L’équipe sera prévenue que « ${deliverable.title} » est validé, au nom de ${nameState.name.trim()}.`
                  : 'L’équipe reçoit votre demande avec vos commentaires et prépare une nouvelle version.'}
              </p>
              <Field
                label={decision === 'approve' ? 'Un mot pour l’équipe (facultatif)' : 'Ce qui doit changer'}
                error={noteError}
              >
                <Textarea rows={4} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              </Field>
            </div>
          </Modal>
        </>
      )}
    </Card>
  )
}
