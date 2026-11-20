import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, Field, ListToolbar, LoadingState, Select, StatCard } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { useIsDesktop } from '../../lib/desktop'
import { DesktopRecordButton } from '../desktop/DesktopRecordButton'
import { InputStatusBadge } from '../inputs/InputStatusBadge'
import {
  PERIOD_FILTER_LABELS,
  STATUS_FILTER_LABELS,
  callStats,
  callTitle,
  clientOptions,
  filterCalls,
  formatCallDate,
  formatCallDuration,
  parsePeriodParam,
  parseStatusParam,
  participants,
  projectOptions,
  ticketCount,
  type PeriodFilter,
  type StatusFilter,
} from './callsLogic'
import { useCalls } from './useCalls'
import styles from './CallsPage.module.css'

type ParamKey = 'projet' | 'client' | 'statut' | 'periode'

export function CallsPage() {
  const { data, isLoading, isError, refetch } = useCalls()
  const isDesktop = useIsDesktop()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')

  const project = params.get('projet') ?? ''
  const client = params.get('client') ?? ''
  const status = parseStatusParam(params.get('statut'))
  const period = parsePeriodParam(params.get('periode'))

  function setParam(key: ParamKey, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const now = new Date()
  const calls = useMemo(() => data ?? [], [data])
  const visible = useMemo(
    () => filterCalls(calls, { query, project, client, status, period }, new Date()),
    [calls, query, project, client, status, period],
  )
  const stats = useMemo(() => callStats(calls, new Date()), [calls])
  const projects = useMemo(() => projectOptions(calls), [calls])
  const clients = useMemo(() => clientOptions(calls), [calls])

  return (
    <section className={table.page} aria-labelledby="calls-title">
      <div className={styles.header}>
        <div className={styles.titles}>
          <h1 id="calls-title">Appels</h1>
          <p className={styles.subtitle}>Tous les appels enregistrés et transcrits avec Sordulo OS.</p>
        </div>
        {isDesktop ? <DesktopRecordButton variant="button" /> : null}
      </div>
      {data && data.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={stats.count} label="Appels ce mois" />
          <StatCard value={formatCallDuration(stats.seconds)} label="Durée transcrite ce mois" />
          <StatCard value={stats.tickets} label="Tickets tirés des appels" hint="Ce mois" />
        </div>
      ) : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un appel', placeholder: 'Titre, projet, client, participants' }}
        activeFilterCount={[project, client, status, period].filter((v) => v !== '').length}
        onResetFilters={() => setParams(new URLSearchParams(), { replace: true })}
        addLabel="Nouvel appel"
        filters={
          <>
            <Field label="Projet">
              <Select value={project} onChange={(e) => setParam('projet', e.target.value)}>
                <option value="">Tous les projets</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client">
              <Select value={client} onChange={(e) => setParam('client', e.target.value)}>
                <option value="">Tous les clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Statut">
              <Select value={status} onChange={(e) => setParam('statut', e.target.value)}>
                {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {STATUS_FILTER_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Période">
              <Select value={period} onChange={(e) => setParam('periode', e.target.value)}>
                {(Object.keys(PERIOD_FILTER_LABELS) as PeriodFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {PERIOD_FILTER_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des appels…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les appels." onRetry={() => void refetch()} />
      ) : calls.length === 0 ? (
        <EmptyState
          title="Aucun appel pour l'instant"
          text="Un appel arrive ici dès qu'il est transcrit : avec l'app de bureau, qui détecte le micro et propose de l'enregistrer, ou depuis un projet, avec « Nouvelle entrée » puis « Réunion »."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Aucun appel ne correspond à la recherche ni aux filtres." />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Appel</th>
                <th scope="col">Projet</th>
                <th scope="col">Date</th>
                <th scope="col">Durée</th>
                <th scope="col">Tickets</th>
                <th scope="col">Statut</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((call) => {
                const people = participants(call)
                return (
                  <tr key={call.id} className={table.row}>
                    <td>
                      <Link to={`/projects/${call.project_id}/inputs/${call.id}`} className={table.rowLink}>
                        {callTitle(call)}
                      </Link>
                      {people ? <span className={table.secondLine}>{people}</span> : null}
                    </td>
                    <td>
                      {call.project ? (
                        <>
                          <Link to={`/projects/${call.project.id}`} className={styles.projectLink}>
                            {call.project.name}
                          </Link>
                          {call.project.client ? <span className={table.secondLine}>{call.project.client.name}</span> : null}
                        </>
                      ) : (
                        <span className={table.muted}>Projet inconnu</span>
                      )}
                    </td>
                    <td>{formatCallDate(call.created_at, now)}</td>
                    <td className={styles.duration}>{formatCallDuration(call.duration)}</td>
                    <td>{ticketCount(call)}</td>
                    <td>
                      <InputStatusBadge status={call.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
