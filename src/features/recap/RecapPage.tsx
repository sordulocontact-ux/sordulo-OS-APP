import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, LoadingState, StatCard } from '../../components/ui'
import { formatDate, formatMoney } from '../../shared/billing'
import { useCurrentMember } from '../auth/useCurrentMember'
import { formatDuration, formatHours, weekLabel, type LoadLevel } from './recapLogic'
import { useWeeklyRecap } from './useRecap'
import table from '../../components/ui/dataTable.module.css'
import styles from './recap.module.css'

const LEVEL: Record<LoadLevel, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  ok: { tone: 'success', text: 'Confortable' },
  tight: { tone: 'warning', text: 'Serrée' },
  over: { tone: 'danger', text: 'Surchargée' },
}

/** Récap du lundi (admin, membre, finance) : la semaine écoulée et la charge de la semaine qui commence. */
export function RecapPage() {
  const { member, organization } = useCurrentMember()
  const { data, isLoading, isError, refetch } = useWeeklyRecap(organization?.id, member?.role)

  return (
    <section className={table.page} aria-labelledby="recap-title">
      <div className={styles.header}>
        <h1 id="recap-title">Récap de la semaine</h1>
        {data ? <p className={styles.subtitle}>Semaine écoulée : {weekLabel(data.previous)}</p> : null}
      </div>

      {isLoading || !member ? (
        <LoadingState />
      ) : isError || !data ? (
        <ErrorState message="Impossible de charger le récap." onRetry={() => void refetch()} />
      ) : (
        <>
          <div className={table.stats}>
            {data.collectedCents !== null ? <StatCard value={formatMoney(data.collectedCents)} label="CA encaissé" hint="HT, net des avoirs" /> : null}
            {data.done !== null ? <StatCard value={data.done.reduce((sum, d) => sum + d.count, 0)} label="Tâches faites" hint="avec du temps saisi" /> : null}
            <StatCard value={data.lateProjects.length} label="Projets en retard" />
            <StatCard value={formatDuration(data.time.reduce((sum, t) => sum + t.minutes, 0))} label="Temps passé" />
          </div>

          {data.done !== null ? (
            <section className={styles.section} aria-labelledby="done-title">
              <h2 id="done-title">Tâches faites</h2>
              {data.done.length === 0 ? (
                <EmptyState title="Aucune tâche terminée" text="Aucune tâche terminée n'a de temps saisi la semaine dernière." />
              ) : (
                <ul className={styles.groups}>
                  {data.done.map((group) => (
                    <li key={group.memberId ?? 'none'} className={styles.group}>
                      <span className={styles.groupName}>
                        {group.name} · {group.count} tâche{group.count > 1 ? 's' : ''}
                      </span>
                      <ul className={styles.titles}>
                        {group.titles.map((title, index) => (
                          <li key={`${title}-${index}`}>{title}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.hint}>La date de fin d'une tâche n'est pas enregistrée : sont comptées les tâches terminées sur lesquelles du temps a été saisi cette semaine-là.</p>
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby="late-title">
            <h2 id="late-title">Projets en retard</h2>
            {data.lateProjects.length === 0 ? (
              <EmptyState title="Aucun projet en retard" text="Tous les projets avec une échéance sont à jour." />
            ) : (
              <div className={table.scroll}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th scope="col">Projet</th>
                      <th scope="col">Échéance</th>
                      <th scope="col">Retard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lateProjects.map((project) => (
                      <tr key={project.id} className={table.row}>
                        <td>
                          <Link to={`/projects/${project.id}`} className={table.rowLink}>
                            {project.name}
                          </Link>
                        </td>
                        <td>{formatDate(project.dueDate)}</td>
                        <td>
                          <Badge tone="danger">
                            {project.daysLate} jour{project.daysLate > 1 ? 's' : ''}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.loads !== null ? (
            <section className={styles.section} aria-labelledby="load-title">
              <h2 id="load-title">Charge de la semaine qui commence</h2>
              {data.loads.length === 0 ? (
                <EmptyState title="Personne à afficher" text="Aucun membre actif sur les projets." />
              ) : (
                <div className={table.scroll}>
                  <table className={table.table}>
                    <thead>
                      <tr>
                        <th scope="col">Membre</th>
                        <th scope="col">Tâches dues</th>
                        <th scope="col">Heures estimées</th>
                        <th scope="col">Capacité</th>
                        <th scope="col">Charge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.loads.map((load) => (
                        <tr key={load.memberId} className={table.row}>
                          <td>{load.name}</td>
                          <td>
                            {load.openTasks}
                            {load.unestimated > 0 ? <span className={styles.hint}> ({load.unestimated} sans estimation)</span> : null}
                          </td>
                          <td className={styles.amount}>{formatHours(load.hours)}</td>
                          <td className={styles.amount}>
                            {formatHours(load.capacityHours)}
                            {load.absentDays > 0 ? <span className={styles.hint}> ({load.absentDays} j d'absence)</span> : null}
                          </td>
                          <td>
                            <Badge tone={LEVEL[load.level].tone}>{LEVEL[load.level].text}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className={styles.hint}>
                Tâches ouvertes dont l'échéance tombe {weekLabel(data.current)}, face à la capacité hebdomadaire moins les absences. Voir <Link to="/my-tasks" className={styles.link}>Mes tâches</Link>.
              </p>
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby="time-title">
            <h2 id="time-title">Temps passé</h2>
            {data.time.length === 0 ? (
              <EmptyState title="Aucun temps saisi" text="Personne n'a saisi de temps la semaine dernière." />
            ) : (
              <div className={table.scroll}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th scope="col">Membre</th>
                      <th scope="col">Temps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.time.map((entry) => (
                      <tr key={entry.memberId} className={table.row}>
                        <td>{entry.name}</td>
                        <td className={styles.amount}>{formatDuration(entry.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
