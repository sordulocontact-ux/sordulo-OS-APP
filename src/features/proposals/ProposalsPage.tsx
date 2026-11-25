import { useMemo, useState } from 'react'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Select, useToast } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { LABELS, type AiProposal } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { timeAgo } from '../notifications/notificationLogic'
import { useProjects } from '../projects/useProjects'
import { ProposalActions } from './ProposalActions'
import { decisionMessage, describeOperation, proposalTaskIds, replanMessage, ruleScopeLabel, STATUS_TONE, type DescribeContext } from './proposalLogic'
import {
  HISTORY_LIMIT,
  proposalErrorText,
  useAutonomyRules,
  usePendingProposals,
  useProposalHistory,
  useProposalTasks,
  useReplan,
  useRevokeRule,
} from './useProposals'
import styles from './proposals.module.css'

const fullDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })

/**
 * Page /proposals (admin, membre) : propositions de l'IA à valider (Valider / Toujours / Refuser), règles
 * « Toujours » actives (révocables), historique (Annuler une proposition appliquée), et « Réorganiser le planning ».
 */
export function ProposalsPage() {
  const toast = useToast()
  const { member } = useCurrentMember()
  const organizationId = member?.organization_id
  const pending = usePendingProposals(organizationId)
  const history = useProposalHistory(organizationId)
  const rules = useAutonomyRules(organizationId)
  const members = useOrgMembers(organizationId)
  const projects = useProjects()
  const replan = useReplan()
  const revoke = useRevokeRule()
  const [scope, setScope] = useState('')

  const taskIds = useMemo(() => proposalTaskIds([...(pending.data ?? []), ...(history.data ?? [])]), [pending.data, history.data])
  const tasks = useProposalTasks(taskIds)

  const projectName = useMemo(() => {
    const names = new Map((projects.data ?? []).map((p) => [p.id, p.name]))
    return (id: string | null) => (id ? (names.get(id) ?? null) : null)
  }, [projects.data])
  const memberName = useMemo(() => {
    const names = new Map((members.data ?? []).map((m) => [m.id, m.name]))
    return (id: string | null) => (id ? (names.get(id) ?? null) : null)
  }, [members.data])
  const describe: DescribeContext = useMemo(() => {
    const titles = new Map((tasks.data ?? []).map((t) => [t.id, t.title]))
    return { taskTitle: (id) => titles.get(id) ?? (tasks.isLoading ? '…' : null), memberName }
  }, [tasks.data, tasks.isLoading, memberName])

  const activeProjects = useMemo(() => (projects.data ?? []).filter((p) => p.status !== 'archived'), [projects.data])

  function runReplan() {
    replan.mutate(scope ? { projectId: scope } : {}, {
      onSuccess: (result) => toast.success(replanMessage(result)),
      onError: (error) => toast.error(proposalErrorText(error)),
    })
  }

  function revokeRule(ruleId: string) {
    revoke.mutate(ruleId, {
      onSuccess: () => toast.success('Règle révoquée : ces changements te seront de nouveau proposés.'),
      onError: (error) => toast.error(proposalErrorText(error)),
    })
  }

  const onDone = (proposal: AiProposal) => (_updated: AiProposal, decision: Parameters<typeof decisionMessage>[0]) =>
    toast.success(decisionMessage(decision, proposal.kind))

  const operationLines = (proposal: AiProposal) => (proposal.payload?.operations ?? []).map((op) => describeOperation(op, describe))

  return (
    <section className={styles.page} aria-labelledby="proposals-title">
      <div className={styles.titleRow}>
        <div className={styles.titleText}>
          <h1 id="proposals-title">Propositions de l’IA</h1>
          <p className={styles.lead}>
            L’IA repère les semaines qui débordent, les tâches bloquées et les urgences, puis propose de réattribuer ou de décaler. Rien ne
            change sans ta validation, sauf les règles « Toujours ».
          </p>
        </div>
        <div className={styles.replan}>
          <Select aria-label="Périmètre de la réorganisation" value={scope} onChange={(e) => setScope(e.target.value)} disabled={replan.isPending}>
            <option value="">Tous les projets</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={runReplan} loading={replan.isPending}>
            {replan.isPending ? 'Analyse du planning…' : 'Réorganiser le planning'}
          </Button>
        </div>
      </div>

      <section className={styles.section} aria-labelledby="proposals-pending">
        <h2 id="proposals-pending" className={styles.sectionTitle}>
          À valider{pending.data && pending.data.length > 0 ? ` (${pending.data.length})` : ''}
        </h2>
        {pending.isLoading ? (
          <LoadingState label="Chargement des propositions…" />
        ) : pending.isError ? (
          <ErrorState message="Impossible de charger les propositions." onRetry={() => void pending.refetch()} />
        ) : !pending.data || pending.data.length === 0 ? (
          <EmptyState
            title="Aucune proposition à valider"
            text="Lance « Réorganiser le planning » pour que l’IA vérifie la charge de chacun, les blocages et les urgences."
          />
        ) : (
          <ul className={styles.cards}>
            {pending.data.map((proposal) => (
              <li key={proposal.id}>
                <Card className={styles.card}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{proposal.title}</h3>
                    <div className={styles.badges}>
                      <Badge tone="primary">{LABELS.aiProposalKind[proposal.kind]}</Badge>
                      {projectName(proposal.project_id) ? <Badge>{projectName(proposal.project_id)}</Badge> : null}
                    </div>
                  </div>
                  {proposal.explanation ? <p className={styles.explanation}>{proposal.explanation}</p> : null}
                  <ul className={styles.operations} aria-label="Changements proposés">
                    {operationLines(proposal).map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                  <div className={styles.cardFooter}>
                    <ProposalActions proposal={proposal} onDone={onDone(proposal)} onError={(message) => toast.error(message)} />
                    <time className={styles.meta} dateTime={proposal.created_at} title={fullDate.format(new Date(proposal.created_at))}>
                      {timeAgo(proposal.created_at)}
                    </time>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="proposals-rules">
        <h2 id="proposals-rules" className={styles.sectionTitle}>
          Règles « Toujours »
        </h2>
        {rules.isLoading ? (
          <LoadingState label="Chargement des règles…" />
        ) : rules.isError ? (
          <ErrorState message="Impossible de charger les règles." onRetry={() => void rules.refetch()} />
        ) : !rules.data || rules.data.length === 0 ? (
          <p className={styles.muted}>Aucune règle active : chaque changement te sera proposé avant d’être appliqué.</p>
        ) : (
          <div className={table.scroll}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th scope="col">Changement appliqué seul</th>
                  <th scope="col">Périmètre</th>
                  <th scope="col">Créée par</th>
                  <th scope="col" className={styles.actionCol}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.data.map((rule) => (
                  <tr key={rule.id}>
                    <td className={table.primary}>{LABELS.aiProposalKind[rule.kind]}</td>
                    <td>{ruleScopeLabel(rule.scope, projectName)}</td>
                    <td>
                      {memberName(rule.created_by) ?? <span className={table.muted}>Inconnu</span>}
                      <span className={table.secondLine}>{timeAgo(rule.created_at)}</span>
                    </td>
                    <td className={styles.actionCol}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeRule(rule.id)}
                        loading={revoke.isPending && revoke.variables === rule.id}
                        aria-label={`Révoquer la règle ${LABELS.aiProposalKind[rule.kind]}, ${ruleScopeLabel(rule.scope, projectName)}`}
                      >
                        Révoquer
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="proposals-history">
        <h2 id="proposals-history" className={styles.sectionTitle}>
          Historique
        </h2>
        {history.isLoading ? (
          <LoadingState label="Chargement de l’historique…" />
        ) : history.isError ? (
          <ErrorState message="Impossible de charger l’historique." onRetry={() => void history.refetch()} />
        ) : !history.data || history.data.length === 0 ? (
          <p className={styles.muted}>Aucune proposition traitée pour l’instant.</p>
        ) : (
          <>
            <div className={table.scroll}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th scope="col">Proposition</th>
                    <th scope="col" className={styles.statusCol}>
                      Statut
                    </th>
                    <th scope="col" className={styles.dateCol}>
                      Décidée
                    </th>
                    <th scope="col" className={styles.actionCol}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((proposal) => {
                    const decidedAt = proposal.decided_at ?? proposal.created_at
                    const by = memberName(proposal.decided_by)
                    return (
                      <tr key={proposal.id} className={proposal.status === 'refused' || proposal.status === 'undone' ? table.inactive : undefined}>
                        <td>
                          <span className={table.primary}>{proposal.title}</span>
                          {operationLines(proposal).map((line, index) => (
                            <span key={index} className={table.secondLine}>
                              {line}
                            </span>
                          ))}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[proposal.status]}>{LABELS.aiProposalStatus[proposal.status]}</Badge>
                        </td>
                        <td>
                          <time dateTime={decidedAt} title={fullDate.format(new Date(decidedAt))}>
                            {timeAgo(decidedAt)}
                          </time>
                          {by ? <span className={table.secondLine}>par {by}</span> : null}
                        </td>
                        <td className={styles.actionCol}>
                          <ProposalActions proposal={proposal} onDone={onDone(proposal)} onError={(message) => toast.error(message)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {history.data.length >= HISTORY_LIMIT ? <p className={styles.muted}>Les {HISTORY_LIMIT} dernières propositions sont affichées.</p> : null}
          </>
        )}
      </section>
    </section>
  )
}
