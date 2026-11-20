import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ActionsMenu,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  ListToolbar,
  LoadingState,
  Select,
  StatCard,
  useToast,
  type ActionsMenuItem,
} from '../../components/ui'
import plusIcon from '../../assets/icons/plus.svg'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { LABELS, PROSPECT_STAGES, type Prospect, type ProspectStage } from '../../shared/types'
import { ProspectFormModal } from './ProspectFormModal'
import {
  CLOSED_FILTER,
  filterProspects,
  parseStageParam,
  prospectStats,
  relativeAction,
  sortProspects,
  STAGE_TONES,
} from './prospectLogic'
import { prospectErrorText, useConvertProspect, useProspects, useUpdateProspect } from './useProspects'
import table from '../../components/ui/dataTable.module.css'
import styles from './prospects.module.css'

export function ProspectsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { organization } = useCurrentMember()
  const { data, isLoading, isError, refetch } = useProspects()
  const { data: members } = useOrgMembers(organization?.id)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Prospect | null>(null)
  const update = useUpdateProspect()
  const convert = useConvertProspect()

  const stage = parseStageParam(params.get('etape'))
  const owner = params.get('responsable') ?? ''
  const hasFilters = stage !== '' || owner !== '' || query.trim() !== ''

  function setParam(key: 'etape' | 'responsable', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setQuery('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const now = new Date()
  const visible = useMemo(
    () => sortProspects(filterProspects(data ?? [], { query, stage, owner })),
    [data, query, stage, owner],
  )
  const stats = useMemo(() => prospectStats(data ?? [], new Date()), [data])
  const memberName = (id: string | null) => (members ?? []).find((m) => m.id === id)?.name ?? null

  async function changeStage(prospect: Prospect, next: ProspectStage) {
    try {
      await update.mutateAsync({ prospectId: prospect.id, fields: { stage: next } })
      toast.success(`Étape : ${LABELS.prospectStage[next]}`)
    } catch (e) {
      toast.error(prospectErrorText(e))
    }
  }

  async function convertToClient(prospect: Prospect) {
    try {
      await convert.mutateAsync(prospect.id)
      toast.success('Client créé')
    } catch (e) {
      toast.error(prospectErrorText(e))
    }
  }

  const actions = (prospect: Prospect): ActionsMenuItem[] => [
    ...PROSPECT_STAGES.filter((s) => s !== prospect.stage).map((s) => ({
      label: `Passer à « ${LABELS.prospectStage[s]} »`,
      onSelect: () => void changeStage(prospect, s),
      disabled: update.isPending,
    })),
    { label: 'Modifier', onSelect: () => setEditing(prospect) },
    {
      label: 'Convertir en client',
      onSelect: () => void convertToClient(prospect),
      disabled: prospect.client_id !== null || convert.isPending,
      hint: prospect.client_id !== null ? 'Déjà converti' : undefined,
    },
  ]

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Icon src={plusIcon} />
      Nouveau prospect
    </Button>
  )

  return (
    <section className={table.page} aria-labelledby="prospects-title">
      <h1 id="prospects-title">Prospection</h1>
      {data && data.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={stats.toFollowUp} label="À relancer" hint="Aujourd’hui ou en retard" />
          <StatCard value={stats.ongoing} label="En cours" />
          <StatCard value={stats.wonThisMonth} label="Gagnés ce mois" />
        </div>
      ) : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un prospect', placeholder: 'Entreprise, contact, site' }}
        activeFilterCount={(stage !== '' ? 1 : 0) + (owner !== '' ? 1 : 0)}
        onResetFilters={() => {
          setParams(new URLSearchParams(), { replace: true })
        }}
        onAdd={() => setCreating(true)}
        addLabel="Nouveau prospect"
        filters={
          <>
            <Field label="Étape">
              <Select value={stage} onChange={(e) => setParam('etape', e.target.value)}>
                <option value="">Toutes les étapes actives</option>
                {PROSPECT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {LABELS.prospectStage[s]}
                  </option>
                ))}
                <option value={CLOSED_FILTER}>Gagnés et perdus</option>
              </Select>
            </Field>
            <Field label="Responsable">
              <Select value={owner} onChange={(e) => setParam('responsable', e.target.value)}>
                <option value="">Tous</option>
                {(members ?? [])
                  .filter((m) => m.removed_at === null || m.id === owner)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des prospects…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les prospects." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucun prospect" text="Ajoute ton premier prospect pour suivre tes relances." action={newButton} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Aucun prospect ne correspond à la recherche ni aux filtres."
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
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
                <th scope="col">Entreprise</th>
                <th scope="col">Contact</th>
                <th scope="col">Étape</th>
                <th scope="col">Prochaine action</th>
                <th scope="col">Responsable</th>
                <th scope="col" className={table.actionsCell}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((prospect) => {
                const next = relativeAction(prospect, now)
                const ownerName = memberName(prospect.owner_member_id)
                return (
                  <tr key={prospect.id} className={table.row}>
                    <td>
                      <Link to={`/prospects/${prospect.id}`} className={table.rowLink}>
                        {prospect.company}
                      </Link>
                      {prospect.website ? <span className={table.secondLine}>{prospect.website}</span> : null}
                    </td>
                    <td>
                      {prospect.contact_name ? (
                        <>
                          <div>{prospect.contact_name}</div>
                          {prospect.contact_email ? <div className={table.muted}>{prospect.contact_email}</div> : null}
                        </>
                      ) : (
                        <span className={table.muted}>Aucun contact</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={STAGE_TONES[prospect.stage]}>{LABELS.prospectStage[prospect.stage]}</Badge>
                    </td>
                    <td>
                      {next ? (
                        <span className={next.overdue ? styles.overdue : undefined}>{next.text}</span>
                      ) : (
                        <span className={table.muted}>Aucune</span>
                      )}
                    </td>
                    <td>
                      {ownerName ? (
                        <span className={styles.nameCell}>
                          <Avatar name={ownerName} size="sm" />
                          {ownerName}
                        </span>
                      ) : (
                        <span className={table.muted}>Non attribué</span>
                      )}
                    </td>
                    <td className={table.actionsCell}>
                      <ActionsMenu label={`Actions pour ${prospect.company}`} items={actions(prospect)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProspectFormModal open={editing !== null} onClose={() => setEditing(null)} prospect={editing} />
      <ProspectFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(prospect) => void navigate(`/prospects/${prospect.id}`)}
      />
    </section>
  )
}
