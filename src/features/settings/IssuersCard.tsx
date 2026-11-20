import { useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, useToast } from '../../components/ui'
import type { BillingIssuer } from '../../shared/types'
import { useOrgMembers } from '../auth'
import { IssuerModal } from './IssuerModal'
import { issuerErrorText, issuerSubtitle, maskIban, sortIssuers } from './issuerLogic'
import { useIssuers, useSetDefaultIssuer, useUpdateIssuer } from './useIssuers'
import styles from './IssuersCard.module.css'

/** Carte « Émetteurs » des paramètres : les entités qui facturent (micro-entreprises…), chacune avec sa numérotation. */
export function IssuersCard({ organizationId }: { organizationId: string }) {
  const toast = useToast()
  const { data, isLoading, isError, refetch } = useIssuers(organizationId)
  const members = useOrgMembers(organizationId)
  const update = useUpdateIssuer(organizationId)
  const setDefault = useSetDefaultIssuer(organizationId)
  // undefined : modale fermée ; null : création ; émetteur : modification.
  const [editing, setEditing] = useState<BillingIssuer | null | undefined>(undefined)
  const issuers = sortIssuers(data ?? [])
  const previousDefaultId = issuers.find((i) => i.is_default && !i.archived_at)?.id ?? null
  const activeMembers = (members.data ?? []).filter((m) => !m.removed_at)
  const pending = update.isPending || setDefault.isPending

  async function makeDefault(issuer: BillingIssuer) {
    try {
      await setDefault.mutateAsync({ id: issuer.id, previousDefaultId })
      toast.success(`${issuer.display_name} est l’émetteur par défaut`)
    } catch (e) {
      toast.error(issuerErrorText(e))
    }
  }

  async function toggleArchived(issuer: BillingIssuer) {
    const archiving = issuer.archived_at === null
    try {
      await update.mutateAsync({ id: issuer.id, patch: { archived_at: archiving ? new Date().toISOString() : null } })
      toast.success(archiving ? 'Émetteur archivé' : 'Émetteur réactivé')
    } catch (e) {
      toast.error(issuerErrorText(e))
    }
  }

  return (
    <Card role="group" aria-labelledby="issuers-title" className={styles.card}>
      <div className={styles.head}>
        <div>
          <h2 id="issuers-title">Émetteurs</h2>
          <p className={styles.help}>
            Les entités qui émettent les devis et les factures. Chaque émetteur a sa propre numérotation de factures.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>Ajouter un émetteur</Button>
      </div>
      {isLoading ? (
        <LoadingState label="Chargement des émetteurs…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les émetteurs." onRetry={() => void refetch()} />
      ) : issuers.length === 0 ? (
        <EmptyState
          title="Aucun émetteur"
          text="Sans émetteur, les documents utilisent les informations de l’organisation ci-dessus."
        />
      ) : (
        <ul className={styles.list}>
          {issuers.map((issuer) => {
            const archived = issuer.archived_at !== null
            const detail = [issuerSubtitle(issuer), issuer.bank_iban ? `IBAN ${maskIban(issuer.bank_iban)}` : '']
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={issuer.id} className={[styles.item, archived ? styles.archived : ''].filter(Boolean).join(' ')}>
                <div className={styles.info}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{issuer.display_name}</span>
                    {issuer.is_default && !archived ? <Badge tone="primary">Par défaut</Badge> : null}
                    {archived ? <Badge>Archivé</Badge> : null}
                  </div>
                  {detail ? <span className={styles.detail}>{detail}</span> : null}
                </div>
                <div className={styles.actions}>
                  <Button size="sm" onClick={() => setEditing(issuer)} aria-label={`Modifier ${issuer.display_name}`}>
                    Modifier
                  </Button>
                  {!archived && !issuer.is_default ? (
                    <Button
                      size="sm"
                      onClick={() => void makeDefault(issuer)}
                      disabled={pending}
                      aria-label={`Définir ${issuer.display_name} par défaut`}
                    >
                      Définir par défaut
                    </Button>
                  ) : null}
                  {!issuer.is_default || archived ? (
                    <Button
                      size="sm"
                      variant={archived ? 'secondary' : 'ghost'}
                      onClick={() => void toggleArchived(issuer)}
                      disabled={pending}
                      aria-label={`${archived ? 'Réactiver' : 'Archiver'} ${issuer.display_name}`}
                    >
                      {archived ? 'Réactiver' : 'Archiver'}
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing !== undefined ? (
        <IssuerModal
          key={editing?.id ?? 'new'}
          organizationId={organizationId}
          issuer={editing}
          members={activeMembers}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </Card>
  )
}
