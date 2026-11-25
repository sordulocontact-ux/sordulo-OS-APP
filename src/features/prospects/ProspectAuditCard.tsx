import { Badge, Button, Spinner } from '../../components/ui'
import { auditOfferHint } from '../../shared/ai/prospectAudit'
import { LABELS, type Prospect } from '../../shared/types'
import { formatDate } from '../tickets/format'
import { AUDIT_TONES, scoreTone, SEVERITY_LABELS, SEVERITY_TONES } from './prospectLogic'
import styles from './prospects.module.css'

export interface ProspectAuditCardProps {
  prospect: Prospect
  /** L'utilisateur peut lancer l'audit (la fonction serveur vérifie les droits). */
  canRun: boolean
  running: boolean
  onRun: () => void
  error: string | null
}

function Score({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className={styles.score} data-tone={scoreTone(value)}>
      <span className={styles.scoreValue}>{typeof value === 'number' ? value : 'n.d.'}</span>
      <span className={styles.scoreLabel}>{label}</span>
    </div>
  )
}

/** Pré-audit IA du site : lancé à la création, relançable ; scores, points par gravité, piste d'offre. */
export function ProspectAuditCard({ prospect, canRun, running, onRun, error }: ProspectAuditCardProps) {
  const { audit } = prospect
  const inProgress = running || prospect.audit_status === 'running'
  const hasWebsite = Boolean(prospect.website?.trim())
  const hint = auditOfferHint(audit)

  return (
    <section className={styles.section} aria-labelledby="prospect-audit">
      <div className={styles.sectionHead}>
        <h2 id="prospect-audit" className={styles.sectionTitle}>
          Pré-audit du site
        </h2>
        <Badge tone={AUDIT_TONES[inProgress ? 'running' : prospect.audit_status]}>
          {LABELS.prospectAuditStatus[inProgress ? 'running' : prospect.audit_status]}
        </Badge>
        {canRun && hasWebsite ? (
          <Button size="sm" variant="secondary" onClick={onRun} loading={inProgress}>
            {audit ? 'Relancer l’audit' : 'Lancer l’audit'}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {!hasWebsite ? (
        <p className={styles.muted}>Ajoute l’adresse du site (bouton Modifier) pour lancer l’audit.</p>
      ) : inProgress ? (
        <p className={styles.progress} role="status">
          <Spinner />
          Analyse du site en cours (mobile, vitesse, référencement, design). Cela peut prendre une minute.
        </p>
      ) : null}

      {prospect.audit_status === 'error' && !inProgress ? (
        <p className={styles.muted}>
          Le dernier audit a échoué
          {audit ? ' : le précédent est conservé ci-dessous' : ''}. Relance-le.
        </p>
      ) : null}

      {audit ? (
        <>
          <div className={styles.scores} role="list" aria-label="Scores du site sur 100">
            <div role="listitem">
              <Score label="Mobile" value={audit.scores['mobile']} />
            </div>
            <div role="listitem">
              <Score label="Vitesse" value={audit.speed_score} />
            </div>
            <div role="listitem">
              <Score label="Référencement" value={audit.seo_score} />
            </div>
            <div role="listitem">
              <Score label="Design" value={audit.scores['design']} />
            </div>
          </div>
          <p className={styles.muted}>
            {audit.mobile_friendly === null ? null : audit.mobile_friendly ? 'Adapté au mobile. ' : 'Non adapté au mobile. '}
            {audit.dated_design ? 'Design daté. ' : null}
            Audit du {formatDate(audit.audited_at)}
            {audit.source === 'pagespeed' ? ' (mesures PageSpeed)' : ' (analyse de la page seule)'}.
          </p>
          {audit.summary ? <p className={styles.multiline}>{audit.summary}</p> : null}
          {audit.points.length > 0 ? (
            <ul className={styles.points}>
              {audit.points.map((point, index) => (
                <li key={`${index}-${point.label}`} className={styles.point}>
                  <Badge tone={SEVERITY_TONES[point.severity]}>{SEVERITY_LABELS[point.severity]}</Badge>
                  <span>
                    <span className={styles.pointLabel}>{point.label}</span>
                    {point.detail ? <span className={styles.muted}> {point.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {hint ? (
            <p className={styles.hint}>
              <strong>Piste d’offre :</strong> {hint}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
