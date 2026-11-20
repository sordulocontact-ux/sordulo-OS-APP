import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ActionsMenu,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListToolbar,
  LoadingState,
  Modal,
  Select,
  StatCard,
  useToast,
} from '../../components/ui'
import downloadIcon from '../../assets/icons/download.svg'
import { formatDate, formatMoney, invoicesCsv, todayIso } from '../../shared/billing'
import { INVOICE_KINDS, LABELS } from '../../shared/types'
import {
  activeFilterCount,
  countLabel,
  csvFileName,
  DISPLAY_STATUSES,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_TONE,
  EMPTY_FILTERS,
  exportableInvoices,
  filtersFromParams,
  filtersToParams,
  invoiceDisplayStatus,
  invoiceErrorText,
  invoiceNumberLabel,
  invoiceSecondLine,
  invoiceStats,
  matchesInvoice,
  sortInvoices,
  statusBadgeLabel,
  type InvoiceFilters,
  type InvoiceRow,
} from './invoiceLogic'
import { issuerName } from '../settings/issuerLogic'
import { useIssuers } from '../settings/useIssuers'
import { useCurrentMember } from '../auth/useCurrentMember'
import { NewInvoiceModal } from './NewInvoiceModal'
import { useDeleteInvoice, useInvoices, useSetInvoicePaid } from './useInvoices'
import table from '../../components/ui/dataTable.module.css'
import styles from './invoices.module.css'

function downloadCsv(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const { data, isLoading, isError, refetch } = useInvoices()
  const { organization } = useCurrentMember()
  const issuers = useIssuers(organization?.id).data ?? []
  const setPaid = useSetInvoicePaid()
  const deleteInvoice = useDeleteInvoice()
  const filters = filtersFromParams(params)
  // `?project=` (depuis la fiche projet) ouvre directement la création, client et projet pré-remplis.
  const [creating, setCreating] = useState(params.has('project'))
  const [toDelete, setToDelete] = useState<InvoiceRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const today = todayIso()

  function updateFilters(next: InvoiceFilters) {
    setParams(filtersToParams(next, params), { replace: true })
  }

  const all = useMemo(() => data ?? [], [data])
  const visible = useMemo(
    () => sortInvoices(all.filter((inv) => matchesInvoice(inv, filters, today))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, filters.query, filters.status, filters.kind, filters.clientId, filters.issuerId, today],
  )
  const stats = useMemo(() => invoiceStats(all, today), [all, today])
  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const inv of all) if (inv.client) byId.set(inv.client.id, inv.client.name)
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [all])
  const exportable = exportableInvoices(visible)

  function exportCsv() {
    const clientsById: Record<string, { name: string; siret: string | null }> = {}
    for (const inv of all) if (inv.client) clientsById[inv.client.id] = inv.client
    downloadCsv(invoicesCsv(exportable, clientsById), csvFileName(today))
  }

  async function togglePaid(invoice: InvoiceRow, paid: boolean) {
    try {
      await setPaid.mutateAsync({ invoice, paid })
      toast.success(paid ? 'Facture marquée comme payée' : 'Paiement annulé')
    } catch (e) {
      toast.error(invoiceErrorText(e))
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleteError(null)
    try {
      await deleteInvoice.mutateAsync(toDelete)
      toast.success('Brouillon supprimé')
      setToDelete(null)
    } catch (e) {
      setDeleteError(invoiceErrorText(e))
    }
  }

  const openCreate = () => setCreating(true)
  const closeCreate = () => {
    setCreating(false)
    if (params.has('project')) {
      const next = new URLSearchParams(params)
      next.delete('project')
      setParams(next, { replace: true })
    }
  }

  const newButton = (
    <Button variant="primary" onClick={openCreate}>
      Nouvelle facture
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="invoices-title">
      <div className={styles.listHeader}>
        <h1 id="invoices-title">Factures</h1>
        <IconButton icon={downloadIcon} label="Exporter en CSV" onClick={exportCsv} disabled={exportable.length === 0} />
      </div>
      {all.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={formatMoney(stats.toCollectCents)} label="À encaisser" hint={countLabel(stats.toCollectCount)} />
          <div className={stats.overdueCount > 0 ? styles.dangerStat : undefined}>
            <StatCard value={formatMoney(stats.overdueCents)} label="En retard" hint={countLabel(stats.overdueCount)} />
          </div>
          <StatCard value={formatMoney(stats.collectedThisMonthCents)} label="Encaissé ce mois" />
        </div>
      ) : null}
      <ListToolbar
        search={{
          value: filters.query,
          onChange: (query) => updateFilters({ ...filters, query }),
          label: 'Rechercher une facture',
          placeholder: 'Numéro, titre, client',
        }}
        activeFilterCount={activeFilterCount(filters)}
        onResetFilters={() => updateFilters({ ...EMPTY_FILTERS, query: filters.query })}
        onAdd={openCreate}
        addLabel="Nouvelle facture"
        filters={
          <>
            <Field label="Statut">
              <Select
                value={filters.status}
                onChange={(e) => updateFilters({ ...filters, status: e.target.value as InvoiceFilters['status'] })}
              >
                <option value="">Tous les statuts</option>
                {DISPLAY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DISPLAY_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select
                value={filters.kind}
                onChange={(e) => updateFilters({ ...filters, kind: e.target.value as InvoiceFilters['kind'] })}
              >
                <option value="">Tous les types</option>
                {INVOICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LABELS.invoiceKind[k]}
                  </option>
                ))}
              </Select>
            </Field>
            {issuers.length > 1 ? (
              <Field label="Émetteur">
                <Select value={filters.issuerId} onChange={(e) => updateFilters({ ...filters, issuerId: e.target.value })}>
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
              <Select value={filters.clientId} onChange={(e) => updateFilters({ ...filters, clientId: e.target.value })}>
                <option value="">Tous les clients</option>
                {clientOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des factures…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les factures." onRetry={() => void refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title="Aucune facture" text="Crée ta première facture pour un client." action={newButton} />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucune facture ne correspond à la recherche ni aux filtres." />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Facture</th>
                <th scope="col">Client</th>
                <th scope="col" className={styles.amount}>
                  Montant TTC
                </th>
                <th scope="col">Statut</th>
                <th scope="col">Échéance</th>
                <th scope="col" className={table.actionsCell}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((invoice) => {
                const status = invoiceDisplayStatus(invoice, today)
                const canTogglePaid = invoice.kind !== 'credit_note' && (invoice.status === 'issued' || invoice.status === 'paid')
                return (
                  <tr key={invoice.id} className={[table.row, invoice.status === 'cancelled' ? styles.cancelled : ''].join(' ')}>
                    <td>
                      <span className={styles.numberCell}>
                        <Link to={`/invoices/${invoice.id}`} className={table.rowLink}>
                          {invoiceNumberLabel(invoice)}
                        </Link>
                        <span className={table.secondLine}>
                          {invoiceSecondLine(invoice)}
                          {issuers.length > 1 && issuerName(issuers, invoice.issuer_id)
                            ? ` · ${issuerName(issuers, invoice.issuer_id)}`
                            : ''}
                        </span>
                      </span>
                    </td>
                    <td>{invoice.client?.name ?? <span className={table.muted}>Client inconnu</span>}</td>
                    <td className={styles.amount}>{formatMoney(invoice.total_ttc_cents)}</td>
                    <td>
                      <Badge tone={DISPLAY_STATUS_TONE[status]}>{statusBadgeLabel(invoice, today)}</Badge>
                    </td>
                    <td>{invoice.due_date ? formatDate(invoice.due_date) : <span className={table.muted}>Aucune</span>}</td>
                    <td className={table.actionsCell}>
                      <ActionsMenu
                        label={`Actions pour ${invoiceNumberLabel(invoice)} ${invoice.title}`}
                        items={[
                          { label: 'Ouvrir', onSelect: () => void navigate(`/invoices/${invoice.id}`) },
                          { label: 'Aperçu PDF', onSelect: () => void navigate(`/invoices/${invoice.id}/print`) },
                          ...(canTogglePaid
                            ? [
                                invoice.status === 'paid'
                                  ? { label: 'Marquer non payée', onSelect: () => void togglePaid(invoice, false), disabled: setPaid.isPending }
                                  : { label: 'Marquer payée', onSelect: () => void togglePaid(invoice, true), disabled: setPaid.isPending },
                              ]
                            : []),
                          ...(invoice.status === 'draft'
                            ? [
                                {
                                  label: 'Supprimer',
                                  tone: 'danger' as const,
                                  onSelect: () => {
                                    setDeleteError(null)
                                    setToDelete(invoice)
                                  },
                                },
                              ]
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
      <NewInvoiceModal
        open={creating}
        onClose={closeCreate}
        initialClientId={filters.clientId}
        initialProjectId={params.get('project') ?? ''}
        onCreated={(invoice) => void navigate(`/invoices/${invoice.id}`)}
      />
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Supprimer ce brouillon ?"
        dismissible={!deleteInvoice.isPending}
        actions={
          <>
            <Button onClick={() => setToDelete(null)} disabled={deleteInvoice.isPending}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleteInvoice.isPending}>
              Supprimer le brouillon
            </Button>
          </>
        }
      >
        <p>Le brouillon « {toDelete?.title} » sera supprimé définitivement.</p>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
      </Modal>
    </section>
  )
}
