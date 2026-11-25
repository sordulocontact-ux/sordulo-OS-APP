import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import micIcon from '../../assets/icons/mic.svg'
import { Button, Icon, IconButton, Modal, Spinner } from '../../components/ui'
import { formatDuration } from '../review/voiceNote'
import { useVoiceCommand } from './useVoiceCommand'
import { isHold, taskDetails } from './voiceCommandLogic'
import styles from './VoiceCommandButton.module.css'

/**
 * Bouton micro des commandes vocales (slot `trailing` de la palette Cmd+K). Maintenir pour parler (relâcher
 * termine), ou cliquer puis « Terminer ». La commande est transcrite, l'IA propose une action : une réponse,
 * une tâche à confirmer, ou une page ouverte tout de suite. Rien n'est écrit sans « Confirmer ».
 */
export function VoiceCommandButton() {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // La palette est une fenêtre native : la fermer (son évènement close la démonte).
  const closePalette = useCallback(() => buttonRef.current?.closest('dialog')?.close(), [])
  const onNavigate = useCallback(
    (path: string) => {
      closePalette()
      navigate(path)
    },
    [closePalette, navigate],
  )
  const command = useVoiceCommand({ path: location.pathname, onNavigate })
  const { stage, voiceState, result } = command

  // Maintenir pour parler : relâcher n'importe où après PUSH_TO_TALK_MS termine l'écoute.
  const releaseRef = useRef<(() => void) | null>(null)
  useEffect(() => () => releaseRef.current?.(), [])
  const stopRef = useRef(command.stop)
  useEffect(() => {
    stopRef.current = command.stop
  }, [command.stop])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || stage !== 'closed') return
    const pressedAt = Date.now()
    command.begin()
    const onUp = () => {
      releaseRef.current?.()
      if (isHold(Date.now() - pressedAt)) stopRef.current()
    }
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
    releaseRef.current = () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      releaseRef.current = null
    }
  }

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    // Clavier (Entrée, Espace) : detail = 0. Un clic souris est déjà géré par onPointerDown.
    if (event.detail === 0 && stage === 'closed') command.begin()
  }

  // Fermer la carte, c'est en avoir fini : la palette se ferme aussi.
  function finish() {
    command.close()
    closePalette()
  }

  function openTasks(projectId: string) {
    command.close()
    onNavigate(`/projects/${projectId}/tasks`)
  }

  const transcript = result?.transcript ?? null
  const busy = stage === 'saving'
  const listening = stage === 'voice' && (voiceState === 'starting' || voiceState === 'recording')

  let actions = (
    <Button variant="ghost" onClick={finish} disabled={busy}>
      Fermer
    </Button>
  )
  if (stage === 'voice' && voiceState === 'recording') {
    actions = (
      <>
        <Button variant="ghost" onClick={finish}>
          Annuler
        </Button>
        <Button variant="primary" onClick={command.stop} autoFocus>
          Terminer
        </Button>
      </>
    )
  } else if ((stage === 'result' || stage === 'saving') && result?.intent === 'create_task') {
    actions = (
      <>
        <Button variant="ghost" onClick={finish} disabled={busy}>
          Annuler
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void command.confirm()} autoFocus>
          Confirmer
        </Button>
      </>
    )
  } else if (stage === 'saved' && result?.intent === 'create_task') {
    const projectId = result.task.projectId
    actions = (
      <>
        <Button variant="ghost" onClick={finish}>
          Fermer
        </Button>
        <Button variant="primary" onClick={() => openTasks(projectId)} autoFocus>
          Voir les tâches
        </Button>
      </>
    )
  } else if (stage === 'error' || (stage === 'result' && result?.intent !== 'create_task')) {
    actions = (
      <>
        <Button variant="ghost" onClick={finish}>
          Fermer
        </Button>
        <Button variant="secondary" onClick={command.begin} autoFocus>
          <Icon src={micIcon} size="sm" />
          Parler à nouveau
        </Button>
      </>
    )
  }

  return (
    <>
      <IconButton
        ref={buttonRef}
        icon={micIcon}
        label="Commande vocale : maintenir pour parler"
        className={[styles.mic, listening ? styles.live : ''].filter(Boolean).join(' ')}
        aria-pressed={listening}
        onPointerDown={onPointerDown}
        onClick={onClick}
      />

      <Modal open={stage !== 'closed'} onClose={finish} title="Commande vocale" dismissible={!busy} actions={actions}>
        <div className={styles.body}>
          {stage === 'voice' ? (
            <p className={styles.status} role="status" aria-live="polite">
              {voiceState === 'recording' ? (
                <>
                  <span className={styles.dot} aria-hidden="true" />
                  <span>
                    J’écoute… <span className={styles.timer}>{formatDuration(command.elapsed)}</span>
                  </span>
                </>
              ) : voiceState === 'transcribing' ? (
                <>
                  <Spinner label="" />
                  Transcription…
                </>
              ) : (
                <>
                  <Spinner label="" />
                  Ouverture du micro…
                </>
              )}
            </p>
          ) : null}
          {stage === 'voice' && voiceState === 'recording' ? (
            <p className={styles.hint}>
              Par exemple « Combien on a encaissé ce mois ? », « Crée une tâche pour Ibé : refaire le menu », « Ouvre les devis ».
              Relâche le bouton, ou choisis Terminer.
            </p>
          ) : null}

          {stage === 'thinking' ? (
            <p className={styles.status} role="status" aria-live="polite">
              <Spinner label="" />
              Je regarde ce qu’il faut faire…
            </p>
          ) : null}

          {transcript && stage !== 'voice' && stage !== 'thinking' ? (
            <p className={styles.transcript}>
              <span className="visually-hidden">Tu as dit : </span>« {transcript} »
            </p>
          ) : null}

          {(stage === 'result' || stage === 'saving' || stage === 'saved') && result ? (
            result.intent === 'create_task' ? (
              <div className={styles.card} aria-live="polite">
                <h3 className={styles.question}>
                  {stage === 'saved' ? `Tâche « ${result.task.title} » créée sur ${result.task.projectName}.` : result.confirmation}
                </h3>
                {stage !== 'saved' ? (
                  <dl className={styles.details}>
                    {taskDetails(result.task).map((row) => (
                      <div key={row.label} className={styles.detail}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : result.intent === 'answer' || result.intent === 'unknown' ? (
              <p className={result.intent === 'answer' ? styles.answer : styles.muted} aria-live="polite">
                {result.answer}
              </p>
            ) : null
          ) : null}

          {command.error && stage !== 'voice' ? (
            <p className={styles.error} role="alert">
              {command.error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  )
}

