import { barPercent, chartSummary, type MonthBar } from '../home/homeLogic'
import styles from './finance.module.css'

/** Barres par mois : noir = encaissé, gris = facturé. Le résumé complet est lu à la place du dessin. */
export function FinanceChart({ bars }: { bars: readonly MonthBar[] }) {
  return (
    <div className={styles.chartCard}>
      <div className={styles.chart} role="img" aria-label={chartSummary(bars)}>
        {bars.map((bar) => (
          <div key={bar.key} className={styles.month} aria-hidden="true">
            <div className={styles.bars}>
              <div className={[styles.bar, styles.invoiced].join(' ')} style={{ height: `${barPercent(bar.invoicedCents, bars)}%` }} />
              <div className={[styles.bar, styles.collected].join(' ')} style={{ height: `${barPercent(bar.collectedCents, bars)}%` }} />
            </div>
            <span className={styles.monthLabel}>{bar.label}</span>
          </div>
        ))}
      </div>
      <ul className={styles.legend} aria-hidden="true">
        <li>
          <span className={[styles.swatch, styles.collected].join(' ')} />
          Encaissé (net des avoirs)
        </li>
        <li>
          <span className={[styles.swatch, styles.invoiced].join(' ')} />
          Facturé
        </li>
      </ul>
    </div>
  )
}
