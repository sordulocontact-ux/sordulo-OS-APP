import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, Field, LoadingState, Select, StatCard } from '../../components/ui'
import { daysLate, formatDate, formatMoney, todayIso } from '../../shared/billing'
import { computeRevenueSplit } from '../../shared/revenueSplit'
import { useCurrentMember } from '../auth/useCurrentMember'
import { FollowupsPanel } from '../followups'
import { useIssuers } from '../settings/useIssuers'
import { FinanceChart } from './FinanceChart'
import { SplitBlock } from './SplitBlock'
import { ThresholdsBlock } from './ThresholdsBlock'
import { issuerThresholds, parisDay, recentPayments, totalCents, unpaidInvoices, unpaidSummary, yearBars, yearOptions } from './financeLogic'
import { useFinanceData } from './useFinance'
import table from '../../components/ui/dataTable.module.css'
import styles from './finance.module.css'

/** Finance (admin, finance) : CA encaissé, seuils par émetteur, répartition 50/50, impayés et relances. */
export function FinancePage() {
  const { organization } = useCurrentMember()
  const organizationId = organization?.id
  const years = useMemo(() => yearOptions(), [])
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear())
  const finance = useFinanceData(organizationId, year)
  const issuers = useIssuers(organizationId)
  const today = todayIso()

  const invoices = useMemo(() => finance.data?.invoices ?? [], [finance.data])
  const bars = useMemo(() => yearBars(invoices, year), [invoices, year])
  const unpaid = useMemo(() => unpaidInvoices(invoices, today), [invoices, today])
  const summary = useMemo(() => unpaidSummary(invoices, today), [invoices, today])
  const recent = useMemo(() => recentPayments(invoices.filter((i) => i.paid_at && parisDay(i.paid_at).startsWith(`${year}-`))), [invoices, year])
  const thresholds = useMemo(() => issuerThresholds(invoices, issuers.data ?? [], year), [invoices, issuers.data, year])
  const split = useMemo(
    () =>
      computeRevenueSplit(
        { invoices, issuers: issuers.data ?? [], members: finance.data?.members ?? [], projectMembers: finance.data?.projectMembers ?? {} },
        year,
      ),
    [invoices, issuers.data, finance.data, year],
  )

  const monthKey = today.slice(0, 7)
  const thisMonth = bars.find((bar) => bar.key === monthKey)
  const loading = finance.isLoading || issuers.isLoading || !organizationId

  return (
    <section className={table.page} aria-labelledby="finance-title">
      <div className={styles.header}>
        <h1 id="finance-title">Finance</h1>
        <Field label="Année">
          <Select className={styles.yearSelect} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {loading ? (
        <LoadingState />
      ) : finance.isError || issuers.isError ? (
        <ErrorState message="Impossible de charger les chiffres." onRetry={() => void Promise.all([finance.refetch(), issuers.refetch()])} />
      ) : (
        <>
          <div className={table.stats}>
            <StatCard value={formatMoney(totalCents(bars))} label={`Encaissé en ${year}`} hint="HT, net des avoirs" />
            {thisMonth ? <StatCard value={formatMoney(thisMonth.collectedCents)} label="Encaissé ce mois-ci" hint="HT" /> : null}
            <StatCard value={formatMoney(summary.totalCents)} label="À encaisser" hint={`${summary.count} facture${summary.count > 1 ? 's' : ''} émise${summary.count > 1 ? 's' : ''}, TTC`} />
            <div className={summary.overdueCount > 0 ? styles.dangerStat : undefined}>
              <StatCard value={formatMoney(summary.overdueCents)} label="En retard" hint={`${summary.overdueCount} facture${summary.overdueCount > 1 ? 's' : ''}`} />
            </div>
          </div>

          <section className={styles.section} aria-labelledby="chart-title">
            <h2 id="chart-title">CA encaissé par mois</h2>
            <FinanceChart bars={bars} />
          </section>

          <ThresholdsBlock rows={thresholds} year={year} />
          <SplitBlock split={split} year={year} />

          <section className={styles.section} aria-labelledby="unpaid-title">
            <h2 id="unpaid-title">Factures émises impayées</h2>
            {unpaid.length === 0 ? (
              <EmptyState title="Aucune facture à encaisser" text="Toutes les factures émises sont payées." />
            ) : (
              <div className={table.scroll}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th scope="col">Facture</th>
                      <th scope="col">Client</th>
                      <th scope="col">Échéance</th>
                      <th scope="col">Montant TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaid.map((invoice) => {
                      const late = daysLate(invoice, today)
                      return (
                        <tr key={invoice.id} className={table.row}>
                          <td>
                            <Link to={`/invoices/${invoice.id}`} className={table.rowLink}>
                              {invoice.number ?? 'Sans numéro'}
                            </Link>
                          </td>
                          <td>{invoice.client?.name ?? ''}</td>
                          <td>
                            {invoice.due_date ? formatDate(invoice.due_date) : 'Non précisée'}
                            {late > 0 ? (
                              <Badge tone="danger" className={styles.late}>
                                {late} j de retard
                              </Badge>
                            ) : null}
                          </td>
                          <td className={styles.amount}>{formatMoney(invoice.total_ttc_cents)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.section} aria-labelledby="recent-title">
            <h2 id="recent-title">Encaissements récents</h2>
            {recent.length === 0 ? (
              <EmptyState title="Aucun encaissement" text={`Aucune facture payée en ${year}.`} />
            ) : (
              <div className={table.scroll}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th scope="col">Payée le</th>
                      <th scope="col">Facture</th>
                      <th scope="col">Client</th>
                      <th scope="col">Montant HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((invoice) => (
                      <tr key={invoice.id} className={table.row}>
                        <td>{invoice.paid_at ? formatDate(parisDay(invoice.paid_at)) : ''}</td>
                        <td>
                          <Link to={`/invoices/${invoice.id}`} className={table.rowLink}>
                            {invoice.number ?? 'Sans numéro'}
                          </Link>
                        </td>
                        <td>{invoice.client?.name ?? ''}</td>
                        <td className={styles.amount}>{formatMoney(invoice.total_ht_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <FollowupsPanel />
        </>
      )}
    </section>
  )
}
