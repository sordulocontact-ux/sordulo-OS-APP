import { Button } from '../../components/ui'
import { openPrompt } from '../../lib/desktop'
import { formatElapsed, useRecordingState } from './useRecordingState'

/** Header button, only rendered inside Tauri. The prompt window shows the stop button while recording. */
export function DesktopRecordButton() {
  const recording = useRecordingState()
  const active = recording !== null && recording.status !== 'idle'
  return (
    <Button
      variant={active ? 'danger' : 'secondary'}
      size="sm"
      onClick={() => void openPrompt({ reason: 'manual-start' }).catch(() => undefined)}
    >
      {active ? `● Enregistrement ${formatElapsed(recording.elapsedSecs)}` : 'Enregistrer un appel'}
    </Button>
  )
}
