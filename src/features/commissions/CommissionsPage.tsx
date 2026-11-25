import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ActionsMenu,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  ListToolbar,
  LoadingState,
  Select,
  StatCard,
  useToast,
  type ActionsMenuItem,
} from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { formatDate } from '../tickets/format'
import { COMMISSION_STATUSES, LABELS, type CommissionStatus } from '../../shared/types'
import {
  canChangeCommissionStatus,
  COMMISSION_STATUS_TONES,
  commissionCompany,
  commissionTotals,
  filterCommissions,
  formatAmount,
  GENERAL_RULES,
  parseStatusParam,
  statusActions,
  describeTiers,
  planRules,
  type CommissionRow,
} from './commissionLogic'
import { commissionErrorText, useCommissionPlans, useCommissions, useUpdateCommissionStatus } from './useCommissions'
import table from '../../components/ui/dataTable.module.css'
import styles from './commissions.module.css'

function dateCell(iso: string | null): string {
  return iso ? formatDate(iso) : 'Non renseigné'
}

/** Commissions des apporteurs : l'apporteur voit les siennes et son barème, admin et finance toutes et changent le statut. */
export function CommissionsPage() {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const role = member?.role ?? null
  const canEdit = canChangeCommissionStatus(role)
  const isApporteur = role === 'prospection'
  const { data, isLoading, isError, refetch } = useCommissions()
  const { data: plans } = useCommissionPlans()
  const { data: members } = useOrgMembers(organization?.id)
  const update = useUpdateCommissionStatus()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')

  const status = parseStatusParam(params.get('statut'))
  const memberFilter = isApporteur ? '' : (params.get('apporteur') ?? '')
  const hasFilters = status !== '' || memberFilter !== '' || query.trim() !== ''

  function setParam(key: 'statut' | 'apporteur', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => data ?? [], [data])
  const visible = useMemo(() => filterCommissions(rows, { query, status, member: memberFilter }), [rows, query, status, memberFilter])
  const totals = useMemo(() => commissionTotals(visible), [visible])
  const nameOf = (id: string) => (members ?? []).find((m) => m.id === id)?.name ?? 'Inconnu'
  const apporteurIds = [...new Set(rows.map((r) => r.member_id))]

  async function changeStatus(row: CommissionRow, next: CommissionStatus) {
    try {
      await update.mutateAsync({ id: row.id, status: next })
      toast.success(`Commission : ${LABELS.commissionStatus[next].toLowerCase()}`)
    } catch (e) {
      toast.error(commissionErrorText(e))
    }
  }

  const actions = (row: CommissionRow): ActionsMenuItem[] =>
    statusActions(row.status).map((a) => ({
      label: a.label,
      onSelect: () => void changeStatus(row, a.status),
      disabled: update.isPending,
    }))

  const ownPlan = isApporteur ? (plans ?? []).find((p) => p.member_id === member?.id) : undefined

  return (
    <section className={table.page} aria-labelledby="commissions-title">
      <h1 id="commissions-title">{isApporteur ? 'Mes commissions' : 'Commissions'}</h1>

      <div className={table.stats}>
        <StatCard value={formatAmount(totals.due)} label="Dues" hint="À facturer ou à payer" />
        <StatCard value={formatAmount(totals.invoiced)} label="Facturées" hint="En attente de paiement" />
        <StatCard value={formatAmount(totals.paid)} label="Payées" />
      </div>

      <ListToolbar
        search={{
          value: query,
          onChange: setQuery,
          label: 'Rechercher une commission',
          placeholder: 'Société',
        }}
        activeFilterCount={(status !== '' ? 1 : 0) + (memberFilter !== '' ? 1 : 0)}
        onResetFilters={() => setParams(new URLSearchParams(), { replace: true })}
        addLabel="Nouvelle commission"
        filters={
          <>
            <Field label="Statut">
              <Select value={status} onChange={(e) => setParam('statut', e.target.value)}>
                <option value="">Tous</option>
                {COMMISSION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LABELS.commissionStatus[s]}
                  </option>
                ))}
              </Select>
            </Field>
            {!isApporteur ? (
              <Field label="Apporteur">
                <Select value={memberFilter} onChange={(e) => setParam('apporteur', e.target.value)}>
                  <option value="">Tous</option>
                  {apporteurIds.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <LoadingState label="Chargement des commissions…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les commissions." onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucune commission pour le moment"
          text={
            isApporteur
              ? 'Elle apparaît quand un client que tu as apporté règle une facture.'
              : 'Une commission est calculée quand un client apporté règle une facture.'
          }
          action={isApporteur ? <Link to="/prospects">Voir mes sites</Link> : undefined}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Aucune commission ne correspond à la recherche ni aux filtres."
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('')
                  setParams(new URLSearchParams(), { replace: true })
                }}
              >
                Effacer les filtres
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Prospect / société</th>
                {!isApporteur ? <th scope="col">Apporteur</th> : null}
                <th scope="col">Type</th>
                <th scope="col">Base HT</th>
                <th scope="col">Montant</th>
                <th scope="col">Statut</th>
                <th scope="col">Dates</th>
                {canEdit ? (
                  <th scope="col" className={table.actionsCell}>
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={table.row}>
                  <td>
                    {row.prospect_id && row.prospect ? (
                      <Link to={`/prospects/${row.prospect_id}`} className={table.rowLink}>
                        {commissionCompany(row)}
                      </Link>
                    ) : (
                      commissionCompany(row)
                    )}
                    {row.note ? <span className={table.secondLine}>{row.note}</span> : null}
                  </td>
                  {!isApporteur ? <td>{nameOf(row.member_id)}</td> : null}
                  <td>{LABELS.commissionKind[row.kind]}</td>
                  <td className={styles.amount}>{formatAmount(row.base_cents)}</td>
                  <td className={[styles.amount, row.amount_cents < 0 ? styles.negative : ''].join(' ')}>
                    {formatAmount(row.amount_cents)}
                  </td>
                  <td>
                    <Badge tone={COMMISSION_STATUS_TONES[row.status]}>{LABELS.commissionStatus[row.status]}</Badge>
                  </td>
                  <td>
                    <div>Créée le {dateCell(row.created_at)}</div>
                    {row.invoiced_at ? <div className={table.muted}>Facturée le {dateCell(row.invoiced_at)}</div> : null}
                    {row.paid_at ? <div className={table.muted}>Payée le {dateCell(row.paid_at)}</div> : null}
                  </td>
                  {canEdit ? (
                    <td className={table.actionsCell}>
                      <ActionsMenu label={`Changer le statut de la commission de ${commissionCompany(row)}`} items={actions(row)} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className={styles.rules} aria-labelledby="commission-rules">
        <h2 id="commission-rules" className={styles.rulesTitle}>
          {isApporteur ? 'Mon barème' : 'Barèmes et règles'}
        </h2>
        {isApporteur ? (
          ownPlan ? (
            <ul className={styles.list}>
              {planRules(ownPlan).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Ton barème n’est pas encore saisi : l’agence le renseigne dans l’équipe.</p>
          )
        ) : (plans ?? []).length > 0 ? (
          <ul className={styles.list}>
            {(plans ?? []).map((plan) => (
              <li key={plan.member_id}>
                <strong>{nameOf(plan.member_id)}</strong>
                {plan.active ? '' : ' (inactif)'} : {describeTiers(plan.tiers).join(', ')} ; devis suivants {plan.followup_rate} % ;
                signature sous {plan.sign_window_months} mois, devis suivants sous {plan.followup_window_months} mois.
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Aucun barème saisi : sans barème actif, aucune commission n’est calculée.</p>
        )}
        <ul className={styles.list}>
          {GENERAL_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </section>
  )
}
