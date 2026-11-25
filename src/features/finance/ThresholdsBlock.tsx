import { Badge } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { ratioPercent, type ThresholdLevel } from '../../shared/thresholds'
import type { IssuerThresholds } from './financeLogic'
import styles from './finance.module.css'

const LEVEL_TEXT: Record<ThresholdLevel, string> = { ok: '', warning: 'Seuil proche', exceeded: 'Seuil dépassé' }

/** CA encaissé de l'année par émetteur, face aux plafonds de la micro-entreprise et de la franchise de TVA. */
export function ThresholdsBlock({ rows, year }: { rows: readonly IssuerThresholds[]; year: number }) {
  const unverified = rows.some((r) => !r.thresholds.verified)
  return (
    <section className={styles.section} aria-labelledby="thresholds-title">
      <h2 id="thresholds-title">Seuils par émetteur</h2>
      {rows.length === 0 ? (
        <p className={styles.hint}>Aucun émetteur configuré. Ajoute les micro-entreprises dans les Paramètres.</p>
      ) : (
        <div className={styles.issuers}>
          {rows.map((row) => (
            <div key={row.issuer.id} className={styles.issuer}>
              <div className={styles.issuerHead}>
                <span className={styles.issuerName}>{row.issuer.display_name}</span>
                <span className={styles.gaugeValue}>{formatMoney(row.collectedCents)} encaissés en {year}</span>
              </div>
              <ul className={styles.gauges}>
                {row.statuses.map((status) => {
                  const percent = ratioPercent(status.ratio)
                  const fillClass = [styles.fill, status.level === 'warning' ? styles.fillWarning : '', status.level === 'exceeded' ? styles.fillExceeded : '']
                  return (
                    <li key={status.kind} className={styles.gauge}>
                      <div className={styles.gaugeLabel}>
                        <span>
                          {status.label}
                          {status.level === 'ok' ? null : (
                            <Badge tone={status.level === 'exceeded' ? 'danger' : 'warning'} className={styles.late}>
                              {LEVEL_TEXT[status.level]}
                            </Badge>
                          )}
                        </span>
                        <span className={styles.gaugeValue}>
                          {percent} % de {formatMoney(status.limitCents)}
                        </span>
                      </div>
                      <div
                        className={styles.track}
                        role="meter"
                        aria-label={`${status.label} : ${percent} % atteint`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.min(percent, 100)}
                      >
                        <div className={fillClass.filter(Boolean).join(' ')} style={{ width: `${Math.min(percent, 100)}%` }} />
                      </div>
                      <span className={styles.hint}>
                        {status.remainingCents > 0 ? `Reste ${formatMoney(status.remainingCents)} avant le seuil.` : 'Seuil atteint.'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className={styles.hint}>
        CA HT encaissé dans l'année civile, net des avoirs.
        {unverified
          ? ` Valeurs ${year} à confirmer sur service-public.fr et impots.gouv.fr avant de s'y fier.`
          : ' Valeurs à revérifier sur service-public.fr et impots.gouv.fr chaque 1er janvier.'}
      </p>
    </section>
  )
}
