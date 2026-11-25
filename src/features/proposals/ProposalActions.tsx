import { useId, useState } from 'react'
import { Button, type ButtonSize } from '../../components/ui'
import type { AiProposal } from '../../shared/types'
import { alwaysHint, canUndo, type ProposalDecision } from './proposalLogic'
import { proposalErrorText, useDecideProposal } from './useProposals'
import styles from './ProposalActions.module.css'

export interface ProposalActionsProps {
  proposal: Pick<AiProposal, 'id' | 'status' | 'kind' | 'title'>
  /** Après une décision réussie (la proposition à jour). */
  onDone?: (updated: AiProposal, decision: ProposalDecision) => void
  /** Message d'erreur en français (la proposition reste inchangée). */
  onError?: (message: string) => void
  size?: ButtonSize
}

/**
 * Boutons d'une proposition de l'IA, réutilisables (page Propositions, île) :
 * en attente → Valider, Toujours, Refuser ; appliquée (à la main ou par une règle) → Annuler ; sinon rien.
 * Ne dépend que de TanStack Query (pas de toast) : le parent affiche le résultat par onDone / onError.
 */
export function ProposalActions({ proposal, onDone, onError, size = 'sm' }: ProposalActionsProps) {
  const decide = useDecideProposal()
  const [running, setRunning] = useState<ProposalDecision | null>(null)
  const hintId = useId()

  async function run(decision: ProposalDecision) {
    setRunning(decision)
    try {
      const updated = await decide.mutateAsync({ id: proposal.id, decision })
      onDone?.(updated, decision)
    } catch (error) {
      onError?.(proposalErrorText(error))
    } finally {
      setRunning(null)
    }
  }

  const busy = running !== null
  const button = (decision: ProposalDecision, label: string, variant: 'primary' | 'secondary' | 'ghost', extra: { describedBy?: string; title?: string } = {}) => (
    <Button
      variant={variant}
      size={size}
      loading={running === decision}
      disabled={busy && running !== decision}
      aria-label={`${label} : ${proposal.title}`}
      aria-describedby={extra.describedBy}
      title={extra.title}
      onClick={() => void run(decision)}
    >
      {label}
    </Button>
  )

  if (proposal.status === 'pending') {
    const hint = alwaysHint(proposal.kind)
    return (
      <div className={styles.actions}>
        {button('apply', 'Valider', 'primary')}
        {button('always', 'Toujours', 'secondary', { describedBy: hintId, title: hint })}
        {button('refuse', 'Refuser', 'ghost')}
        <span id={hintId} className="visually-hidden">
          {hint}
        </span>
      </div>
    )
  }
  if (canUndo(proposal)) {
    return <div className={styles.actions}>{button('undo', 'Annuler', 'secondary')}</div>
  }
  return null
}
