import { Badge, Spinner } from '../../components/ui'
import { LABELS, type InputStatus } from '../../shared/types'
import { STATUS_TONES, isInputActive } from './inputUtils'

/** Status badge; the text is also the accessible name, so the spinner stays silent. */
export function InputStatusBadge({ status }: { status: InputStatus }) {
  const working = status === 'transcribing' || status === 'analyzing'
  return (
    <Badge tone={STATUS_TONES[status]} data-active={isInputActive(status) || undefined}>
      {working ? <Spinner label="" /> : null}
      {LABELS.inputStatus[status]}
    </Badge>
  )
}
