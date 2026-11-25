import { useQuery } from '@tanstack/react-query'
import { Badge } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { countFeedbackRounds, roundsAlert, roundsLabel, roundsState, type RoundInput, type RoundTicket } from './roundsLogic'
import styles from './FeedbackRounds.module.css'

export interface FeedbackRoundsProps {
  projectId: string
  /** projects.feedback_rounds_included. */
  included: number
}

/** Lit les entrées et les tickets d'un projet (colonnes utiles seulement). */
function useRounds(projectId: string) {
  return useQuery({
    // Préfixes 'inputs' / 'tickets' de queryKeys : une validation de tickets rafraîchit le compte.
    queryKey: ['inputs', projectId, 'rounds'] as const,
    enabled: Boolean(projectId),
    queryFn: async () => {
      const [inputs, tickets] = await Promise.all([
        supabase.from('inputs').select('id, quote_id').eq('project_id', projectId).overrideTypes<RoundInput[], { merge: false }>(),
        supabase.from('tickets').select('input_id, status').eq('project_id', projectId).overrideTypes<RoundTicket[], { merge: false }>(),
      ])
      if (inputs.error) throw inputs.error
      if (tickets.error) throw tickets.error
      return countFeedbackRounds(inputs.data, tickets.data)
    },
  })
}

/** « Retours : 3 sur 2 prévus », avec une alerte au-delà du devis. À monter dans l'en-tête de la page projet. */
export function FeedbackRounds({ projectId, included }: FeedbackRoundsProps) {
  const { data: count, isError } = useRounds(projectId)
  // Compte indisponible : on n'affiche rien plutôt qu'un faux « 0 sur N ».
  if (isError || count === undefined) return null
  const state = roundsState(count, included)
  const alert = roundsAlert(state)
  return (
    <div className={styles.root}>
      <Badge tone={state.exceeded ? 'danger' : state.atLimit ? 'warning' : 'neutral'}>{roundsLabel(state)}</Badge>
      {alert ? (
        <p className={styles.alert} role="alert">
          {alert}
        </p>
      ) : null}
    </div>
  )
}
