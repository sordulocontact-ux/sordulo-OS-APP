import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ActionsMenu,
  Badge,
  EmptyState,
  ErrorState,
  Field,
  ListToolbar,
  LoadingState,
  Select,
  StatCard,
  useToast,
  Button,
  Icon,
  Modal,
} from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { formatDate, formatMoney, quoteDisplayStatus, todayIso } from '../../shared/billing'
import { issuerName } from '../settings/issuerLogic'
import { useIssuers } from '../settings/useIssuers'
import { NewQuoteModal } from './NewQuoteModal'
import {
  canDeleteQuote,
  countLabel,
  filterQuotes,
  parseStatusParam,
  QUOTE_DISPLAY_LABELS,
  QUOTE_DISPLAY_STATUSES,
  QUOTE_DISPLAY_TONE,
  quoteErrorText,
  quoteStats,
  sortQuotes,
} from './quoteLogic'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useDeleteQuote, useDuplicateQuote, useQuoteClients, useQuotes } from './useQuotes'
import table from '../../components/ui/dataTable.module.css'
import styles from './quotes.module.css'

export function QuotesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const { data, isLoading, isError, refetch } = useQuotes()
  const clients = useQuoteClients()
  const issuers = useIssuers(organization?.id).data ?? []
  const duplicate = useDuplicateQuote()
  const remove = useDeleteQuote()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<{ id: string; number: string } | null>(null)

  const status = parseStatusParam(params.get('statut'))
  const clientId = params.get('client') ?? ''
  const issuerId = params.get('emetteur') ?? ''
  // `?nouveau=1` ou `?project=` : ouvre la modale de création (client et projet pré-remplis).
  const creating = params.has('nouveau') || params.has('project')
  const today = todayIso()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  function openCreate() {
    setParam('nouveau', '1')
  }

  function closeCreate() {
    const next = new URLSearchParams(params)
    next.delete('nouveau')
    next.delete('project')
    setParams(next, { replace: true })
  }

  const visible = useMemo(
    () => sortQuotes(filterQuotes(data ?? [], { query, status, clientId, issuerId }, today)),
    [data, query, status, clientId, issuerId, today],
  )
  const stats = useMemo(() => quoteStats(data ?? [], today), [data, today])

  async function copy(id: string) {
    const quote = (data ?? []).find((q) => q.id === id)
    if (!quote || !organization) return
    try {
      const created = await duplicate.mutateAsync({ quote, organizationId: organization.id, memberId: member?.id ?? null })
      toast.success('Devis dupliqué')
      void navigate(`/quotes/${created.id}`)
    } catch (e) {
      toast.error(quoteErrorText(e))
    }
  }

  async function destroy(id: string) {
    try {
      await remove.mutateAsync(id)
      toast.success('Devis supprimé')
      setToDelete(null)
    } catch (e) {
      toast.error(quoteErrorText(e))
    }
  }

  const newButton = (
    <Button variant="primary" onClick={openCreate}>
      <Icon src={plusIcon} />
      Nouveau devis
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="quotes-title">
      <h1 id="quotes-title">Devis</h1>
      {data && data.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={formatMoney(stats.pending.cents)} label="En attente" hint={countLabel(stats.pending.count)} />
          <StatCard value={formatMoney(stats.accepted.cents)} label={`Acceptés en ${stats.year}`} hint={countLabel(stats.accepted.count)} />
          <StatCard value={formatMoney(stats.lost.cents)} label="Refusés ou expirés" hint={countLabel(stats.lost.count)} />
        </div>
      ) : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un devis', placeholder: 'Numéro, titre, client' }}
        activeFilterCount={(status !== '' ? 1 : 0) + (clientId !== '' ? 1 : 0) + (issuerId !== '' ? 1 : 0)}
        onResetFilters={() => {
          const next = new URLSearchParams(params)
          next.delete('statut')
          next.delete('client')
          next.delete('emetteur')
          setParams(next, { replace: true })
        }}
        onAdd={openCreate}
        addLabel="Nouveau devis"
        filters={
          <>
            <Field label="Statut">
              <Select value={status} onChange={(e) => setParam('statut', e.target.value)}>
                <option value="">Tous les statuts</option>
                {QUOTE_DISPLAY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {QUOTE_DISPLAY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            {issuers.length > 1 ? (
              <Field label="Émetteur">
                <Select value={issuerId} onChange={(e) => setParam('emetteur', e.target.value)}>
                  <option value="">Tous les émetteurs</option>
                  {issuers.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.display_name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Client">
              <Select value={clientId} onChange={(e) => setParam('client', e.target.value)}>
                <option value="">Tous les clients</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des devis…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les devis." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucun devis" text="Crée ton premier devis pour un client." action={newButton} />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun devis ne correspond à la recherche ni aux filtres." />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Devis</th>
                <th scope="col">Client</th>
                <th scope="col" className={styles.amount}>
                  Montant TTC
                </th>
                <th scope="col">Statut</th>
                <th scope="col">Date</th>
                <th scope="col" className={table.actionsCell}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((quote) => {
                const shown = quoteDisplayStatus(quote, today)
                return (
                  <tr key={quote.id} className={table.row}>
                    <td>
                      <span className={styles.titleCell}>
                        <Link to={`/quotes/${quote.id}`} className={table.rowLink}>
                          {quote.title}
                        </Link>
                        <span className={table.secondLine}>
                          {quote.number}
                          {issuers.length > 1 && issuerName(issuers, quote.issuer_id) ? ` · ${issuerName(issuers, quote.issuer_id)}` : ''}
                        </span>
                      </span>
                    </td>
                    <td>{quote.client?.name ?? <span className={table.muted}>Client inconnu</span>}</td>
                    <td className={styles.amount}>{formatMoney(quote.total_ttc_cents)}</td>
                    <td>
                      <Badge tone={QUOTE_DISPLAY_TONE[shown]}>{QUOTE_DISPLAY_LABELS[shown]}</Badge>
                    </td>
                    <td>{formatDate(quote.issue_date)}</td>
                    <td className={table.actionsCell}>
                      <ActionsMenu
                        label={`Actions pour le devis ${quote.number}`}
                        items={[
                          { label: 'Ouvrir', onSelect: () => void navigate(`/quotes/${quote.id}`) },
                          { label: 'Aperçu PDF', onSelect: () => void navigate(`/quotes/${quote.id}/print`) },
                          { label: 'Dupliquer', onSelect: () => void copy(quote.id), disabled: duplicate.isPending },
                          ...(canDeleteQuote(quote.status)
                            ? [{ label: 'Supprimer', tone: 'danger' as const, onSelect: () => setToDelete({ id: quote.id, number: quote.number }) }]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Supprimer ce devis ?"
        dismissible={!remove.isPending}
        actions={
          <>
            <Button onClick={() => setToDelete(null)} disabled={remove.isPending}>
              Annuler
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => toDelete && void destroy(toDelete.id)}>
              Supprimer
            </Button>
          </>
        }
      >
        <p>Le brouillon {toDelete?.number} sera supprimé définitivement.</p>
      </Modal>
      {creating ? (
        <NewQuoteModal
          open
          onClose={closeCreate}
          initialClientId={clientId}
          initialProjectId={params.get('project') ?? ''}
          onCreated={(id) => void navigate(`/quotes/${id}`)}
        />
      ) : null}
    </section>
  )
}
