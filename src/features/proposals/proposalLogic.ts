/**
 * Propositions de l'IA : textes lisibles des opérations (« Tâche X : Maël → Sacha »), périmètre d'une règle
 * « Toujours », messages de résultat. Pur et testé.
 */
import type { BadgeTone } from '../../components/ui'
import { formatShortDate } from '../../shared/replan'
import { LABELS, type AiProposal, type AiProposalKind, type AiProposalOperation, type AiProposalStatus, type TaskPriority } from '../../shared/types'
import type { ReplanResponse } from '../../shared/ai/replan'

export interface DescribeContext {
  /** Titre d'une tâche, null si elle n'existe plus (ou n'est pas visible). */
  taskTitle: (taskId: string) => string | null
  /** Nom d'un membre (« un ancien membre » s'il est inconnu). */
  memberName: (memberId: string) => string | null
}

const priorityLabel = (value: unknown) =>
  typeof value === 'string' && value in LABELS.taskPriority ? LABELS.taskPriority[value as TaskPriority] : 'aucune'

/** Changements d'une opération, un texte par valeur modifiée. */
export function describeChanges(op: AiProposalOperation, ctx: DescribeContext): string[] {
  const before = op.before ?? {}
  const after = op.after ?? {}
  const person = (id: string | null | undefined) => (id ? (ctx.memberName(id) ?? 'un ancien membre') : 'personne')
  const changes: string[] = []
  if ('assignee_member_id' in after) changes.push(`${person(before.assignee_member_id)} → ${person(after.assignee_member_id)}`)
  if ('due_date' in after) {
    const date = (value: string | null | undefined) => (value ? formatShortDate(value) : 'aucune')
    changes.push(`échéance ${date(before.due_date)} → ${date(after.due_date)}`)
  }
  if ('priority' in after) changes.push(`priorité ${priorityLabel(before.priority).toLowerCase()} → ${priorityLabel(after.priority).toLowerCase()}`)
  if ('position' in after) changes.push('ordre dans la colonne modifié')
  return changes
}

/** « Tâche « Maquette » : Maël → Sacha, échéance 3 déc. → 5 déc. » */
export function describeOperation(op: AiProposalOperation, ctx: DescribeContext): string {
  const title = ctx.taskTitle(op.task_id)
  const task = title ? `Tâche « ${title} »` : 'Tâche supprimée'
  const changes = describeChanges(op, ctx)
  return changes.length > 0 ? `${task} : ${changes.join(', ')}` : task
}

/** Périmètre d'une règle « Toujours ». */
export function ruleScopeLabel(scope: Record<string, unknown> | null | undefined, projectName: (projectId: string) => string | null): string {
  const projectId = scope?.project_id
  if (typeof projectId !== 'string') return 'Toute l’organisation'
  const name = projectName(projectId)
  return name ? `Projet « ${name} »` : 'Projet supprimé'
}

const KIND_NOUNS: Record<AiProposalKind, string> = {
  reassign_task: 'réattributions de tâches',
  move_due_date: 'déplacements d’échéance',
  reorder: 'réorganisations',
  other: 'propositions de ce type',
}

/** Texte d'aide du bouton « Toujours ». */
export function alwaysHint(kind: AiProposalKind): string {
  return `Valide et laisse l’IA appliquer seule les prochaines ${KIND_NOUNS[kind]} de ce périmètre. Tu pourras annuler chacune et révoquer la règle.`
}

export type ProposalDecision = 'apply' | 'always' | 'refuse' | 'undo'

/** Message de confirmation après une décision. */
export function decisionMessage(decision: ProposalDecision, kind: AiProposalKind): string {
  switch (decision) {
    case 'apply':
      return 'Proposition validée'
    case 'always':
      return `Proposition validée. Les prochaines ${KIND_NOUNS[kind]} s’appliqueront seules.`
    case 'refuse':
      return 'Proposition refusée'
    case 'undo':
      return 'Changement annulé'
  }
}

/** Une proposition appliquée (à la main ou par une règle) peut être annulée. */
export function canUndo(proposal: Pick<AiProposal, 'status'>): boolean {
  return proposal.status === 'accepted' || proposal.status === 'auto_applied'
}

export const STATUS_TONE: Record<AiProposalStatus, BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  refused: 'neutral',
  auto_applied: 'info',
  undone: 'neutral',
}

/** Message après « Réorganiser le planning ». */
export function replanMessage(result: ReplanResponse): string {
  const created = result.proposals.length
  if (created === 0) {
    return result.issueCount === 0
      ? 'Rien à réorganiser : le planning tient.'
      : 'Des problèmes ont été repérés, mais aucun changement raisonnable n’a été trouvé (ou il est déjà proposé).'
  }
  const auto = result.proposals.filter((p) => p.status === 'auto_applied').length
  const base = `${created} proposition${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}`
  return auto > 0 ? `${base}, dont ${auto} appliquée${auto > 1 ? 's' : ''} automatiquement.` : `${base}.`
}

/** Ids des tâches citées par des propositions (pour charger leurs titres), sans doublon, triés. */
export function proposalTaskIds(proposals: readonly Pick<AiProposal, 'payload'>[]): string[] {
  return [...new Set(proposals.flatMap((p) => (p.payload?.operations ?? []).map((op) => op.task_id)))].sort()
}
