import micIcon from '../../assets/icons/mic.svg'
import { Button } from '../../components/ui'
import { openPrompt } from '../../lib/desktop'
import { formatElapsed, useRecordingState } from './useRecordingState'
import styles from './DesktopRecordButton.module.css'

export interface DesktopRecordButtonProps {
  /** "icon": entrée de la barre latérale (micro du Figma) ; "button": bouton texte. */
  variant?: 'icon' | 'button'
}

/** Only rendered inside Tauri. Opens the prompt window, which shows the stop button while recording. */
export function DesktopRecordButton({ variant = 'button' }: DesktopRecordButtonProps) {
  const recording = useRecordingState()
  const active = recording !== null && recording.status !== 'idle'
  const label = active ? `Enregistrement en cours (${formatElapsed(recording.elapsedSecs)})` : 'Enregistrer un appel'
  const open = () => void openPrompt({ reason: 'manual-start' }).catch(() => undefined)

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={[styles.icon, active ? styles.recording : ''].filter(Boolean).join(' ')}
        title={label}
        aria-label={label}
        onClick={open}
      >
        <img src={micIcon} alt="" width={20} height={20} />
        {active ? <span className={styles.dot} aria-hidden="true" /> : null}
      </button>
    )
  }

  return (
    <Button variant={active ? 'danger' : 'secondary'} size="sm" onClick={open}>
      {active ? `● Enregistrement ${formatElapsed(recording.elapsedSecs)}` : 'Enregistrer un appel'}
    </Button>
  )
}
