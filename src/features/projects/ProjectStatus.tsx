import { Badge, type BadgeTone } from '../../components/ui'
import type { ProjectStatus as Status } from '../../shared/types'
import { LABELS } from '../../shared/types'

/** Ton de la pastille par statut : neutre (prospect, archivé), orange (devis), bleu (en cours), vert (livré, payé). */
const TONE: Record<Status, BadgeTone> = {
  prospect: 'neutral',
  quote_sent: 'warning',
  in_progress: 'info',
  delivered: 'success',
  paid: 'success',
  archived: 'neutral',
}

/** Pastille arrondie de statut (Midday « Invoices »). Le libellé reste écrit : la couleur n'est jamais seule. */
export function ProjectStatus({ status }: { status: Status }) {
  return <Badge tone={TONE[status]}>{LABELS.projectStatus[status] ?? status}</Badge>
}
