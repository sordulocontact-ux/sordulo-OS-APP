import { EmptyState } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { balanceSentence, partnerName, type RevenueSplit } from '../../shared/revenueSplit'
import { shortMonth } from '../home/homeLogic'
import table from '../../components/ui/dataTable.module.css'
import styles from './finance.module.css'

/** Répartition 50/50 des missions communes : qui doit quoi à l'autre associé, par mois et sur l'année. */
export function SplitBlock({ split, year }: { split: RevenueSplit; year: number }) {
  const partners = split.partners
  return (
    <section className={styles.section} aria-labelledby="split-title">
      <h2 id="split-title">Répartition entre associés</h2>
      {!split.applicable || !partners ? (
        <EmptyState title="Répartition indisponible" text="Elle suppose deux émetteurs actifs : les micro-entreprises des deux associés (Paramètres)." />
      ) : (
        <>
          <p className={styles.balance}>{balanceSentence(split.firstOwesSecondCents, partners)} sur {year}</p>
          <p className={styles.hint}>
            50/50 sur les missions communes (projet sans membre déclaré ou avec les deux associés) : l'émetteur qui encaisse doit la moitié du HT à l'autre,
            les avoirs se déduisent. {formatMoney(split.commonHtCents)} HT encaissés sur ces missions.
          </p>
          {split.months.length === 0 ? (
            <p className={styles.hint}>Aucun encaissement sur une mission commune cette année.</p>
          ) : (
            <div className={table.scroll}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th scope="col">Mois</th>
                    <th scope="col">Factures et avoirs</th>
                    <th scope="col">Solde du mois</th>
                  </tr>
                </thead>
                <tbody>
                  {split.months.map((month) => (
                    <tr key={month.month}>
                      <td>{shortMonth(month.month)}</td>
                      <td>{month.invoiceCount}</td>
                      <td className={styles.amount}>{balanceSentence(month.firstOwesSecondCents, partners).replace(/^Comptes équilibrés$/, 'Équilibré')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>
            {partnerName(partners[0])} et {partnerName(partners[1])} : le solde est un montant HT à régler entre vous, hors TVA.
          </p>
        </>
      )}
    </section>
  )
}
