import type { DocumentLine, Quote, Service } from '../../shared/types'
import { countTaskTemplates, ticketsToValidateText } from '../catalog/catalogLogic'

/** Pourquoi on ne peut (ou n'a pas besoin de) proposer des tâches pour un devis. */
export type TasksProposal =
  | { kind: 'ready'; tickets: number; tasks: number }
  /** Aucune ligne ne porte une prestation du catalogue ayant des tâches types. */
  | { kind: 'no-templates' }
  /** Devis pas encore accepté. */
  | { kind: 'not-accepted' }
  /** Devis sans projet : le serveur refuse, les tickets ont besoin d'un projet. */
  | { kind: 'no-project' }

/** Ce que « Proposer les tâches » ferait pour ce devis (même règle que `propose_tasks_from_quote`). */
export function tasksProposal(
  quote: Pick<Quote, 'status' | 'project_id'> & { lines: readonly DocumentLine[] },
  services: readonly Pick<Service, 'id' | 'task_templates'>[],
): TasksProposal {
  if (quote.status !== 'accepted') return { kind: 'not-accepted' }
  const count = countTaskTemplates(quote.lines, services)
  if (count.tickets === 0) return { kind: 'no-templates' }
  if (!quote.project_id) return { kind: 'no-project' }
  return { kind: 'ready', tickets: count.tickets, tasks: count.tasks }
}

/** Écran de validation des tickets proposés pour l'entrée créée depuis le devis. */
export function reviewPath(projectId: string, inputId: string): string {
  return `/projects/${projectId}/inputs/${inputId}/review`
}

/** Message de réussite : « 2 tickets à valider ». */
export function proposalToast(tickets: number): string {
  return ticketsToValidateText(tickets)
}

/** Message d'erreur de la fonction `propose_tasks_from_quote`. */
export function proposeErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de proposer des tâches pour ce devis.'
  if (code === 'P0001' && message) return message
  return message ? `Impossible de proposer les tâches : ${message}` : 'Impossible de proposer les tâches. Réessaie.'
}

/** Texte à afficher quand « Proposer les tâches » n'est pas possible, ou null s'il l'est. */
export function noProposalText(proposal: TasksProposal): string | null {
  switch (proposal.kind) {
    case 'ready':
      return null
    case 'no-project':
      return 'Rattache ce devis à un projet pour proposer ses tâches : les tickets arrivent dans le projet.'
    case 'no-templates':
      return 'Aucune ligne de ce devis ne vient d’une prestation du catalogue avec des tâches types.'
    case 'not-accepted':
      return 'Les tâches sont proposées quand le devis est accepté.'
  }
}
