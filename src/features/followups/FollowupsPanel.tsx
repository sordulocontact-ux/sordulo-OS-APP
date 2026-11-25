import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Field, LoadingState, TextInput, Textarea, useToast } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { formatDraft, mailtoLink, parseDraft } from '../../shared/ai/followupDraft'
import { useCurrentMember } from '../auth/useCurrentMember'
import { waitingLabel, type FollowupItem } from './followupLogic'
import { useFollowups, usePrepareFollowup, useUpdateFollowup } from './useFollowups'
import styles from './followups.module.css'

function errorText(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'Une erreur est survenue. Réessaie.'
}

/** Brouillon en cours : texte modifiable, copier, ouvrir dans le mail, marquer envoyée. */
function DraftEditor({ item, organizationId }: { item: FollowupItem; organizationId: string }) {
  const toast = useToast()
  const draft = item.draft
  const initial = parseDraft(draft?.draft ?? '')
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const update = useUpdateFollowup(organizationId)
  if (!draft) return null

  const text = formatDraft({ subject, body })
  const changed = text !== draft.draft

  async function run(change: { draft?: string; status?: 'sent' | 'dismissed' }, success: string) {
    try {
      await update.mutateAsync({ id: draft?.id ?? '', ...change })
      toast.success(success)
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Relance copiée')
    } catch {
      toast.error('Copie impossible : sélectionne le texte à la main.')
    }
  }

  return (
    <div className={styles.editor}>
      <Field label="Objet">
        <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Message">
        <Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} maxLength={9000} />
      </Field>
      {item.email ? null : <p className={styles.noEmail}>Aucun email de contact pour ce client : le destinataire est à saisir dans le mail.</p>}
      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => window.location.assign(mailtoLink(item.email, { subject, body }))}>
          Ouvrir dans le mail
        </Button>
        <Button size="sm" onClick={() => void copy()}>
          Copier
        </Button>
        {changed ? (
          <Button size="sm" loading={update.isPending} onClick={() => void run({ draft: text }, 'Modifications enregistrées')}>
            Enregistrer les modifications
          </Button>
        ) : null}
        <Button size="sm" loading={update.isPending} onClick={() => void run({ draft: text, status: 'sent' }, 'Relance marquée comme envoyée')}>
          Marquer envoyée
        </Button>
        <Button variant="ghost" size="sm" className={styles.actionsEnd} loading={update.isPending} onClick={() => void run({ status: 'dismissed' }, 'Relance ignorée')}>
          Ignorer
        </Button>
      </div>
    </div>
  )
}

function FollowupRow({ item, organizationId }: { item: FollowupItem; organizationId: string }) {
  const toast = useToast()
  const prepare = usePrepareFollowup(organizationId)
  const update = useUpdateFollowup(organizationId)

  async function prepareDraft() {
    try {
      await prepare.mutateAsync({ targetType: item.type, targetId: item.id })
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  async function dismiss() {
    if (!item.draft) return
    try {
      await update.mutateAsync({ id: item.draft.id, status: 'dismissed' })
      toast.success('Relance ignorée')
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  const link = item.type === 'quote' ? `/quotes/${item.id}` : `/invoices/${item.id}`
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <div className={styles.summary}>
          <span className={styles.name}>
            <Link to={link}>
              {item.type === 'quote' ? 'Devis' : 'Facture'} {item.number}
            </Link>{' '}
            · {item.clientName}
          </span>
          <span className={styles.meta}>{waitingLabel(item)}</span>
        </div>
        <Badge tone={item.type === 'invoice' ? 'danger' : 'warning'}>{item.type === 'invoice' ? 'Échue' : 'Sans réponse'}</Badge>
        <span className={styles.amount}>{formatMoney(item.amountTtcCents)}</span>
        {item.draft ? null : (
          <Button size="sm" variant="primary" loading={prepare.isPending} onClick={() => void prepareDraft()}>
            Préparer la relance
          </Button>
        )}
      </div>
      {item.draft ? <DraftEditor key={item.draft.id + item.draft.draft} item={item} organizationId={organizationId} /> : null}
      {item.draft ? (
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" loading={prepare.isPending} onClick={() => void prepareDraft()}>
            Refaire le brouillon
          </Button>
          <Button variant="ghost" size="sm" loading={update.isPending} onClick={() => void dismiss()}>
            Ne pas relancer
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/** Devis sans réponse et factures échues, avec la relance à préparer, relire et envoyer. À monter dans /finance. */
export function FollowupsPanel() {
  const { organization } = useCurrentMember()
  const organizationId = organization?.id
  const { data, isLoading, isError, refetch } = useFollowups(organizationId)

  return (
    <section className={styles.panel} aria-labelledby="followups-title">
      <div className={styles.header}>
        <h2 id="followups-title">Relances</h2>
        {data && data.length > 0 ? <span className={styles.count}>{data.length} à faire</span> : null}
      </div>
      {isLoading || !organizationId ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message="Impossible de charger les relances." onRetry={() => void refetch()} />
      ) : data && data.length > 0 ? (
        <ul className={styles.list}>
          {data.map((item) => (
            <FollowupRow key={item.key} item={item} organizationId={organizationId} />
          ))}
        </ul>
      ) : (
        <EmptyState title="Rien à relancer" text="Aucun devis sans réponse depuis 7 jours, aucune facture échue." />
      )}
    </section>
  )
}
