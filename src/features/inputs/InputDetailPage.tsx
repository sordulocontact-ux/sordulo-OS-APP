import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BackLink, Badge, Button, Card, EmptyState, ErrorState, LoadingState, useToast, type BadgeTone } from '../../components/ui'
import { api, ApiRequestError } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import { formatTimestamp, speakerLabel } from '../../shared/transcript'
import type { Input } from '../../shared/types'
import { DeleteInputButton } from './DeleteInputButton'
import { DownloadInputButtons } from './DownloadInputButtons'
import { ProposedTicketsPreview } from './ProposedTicketsPreview'
import { useInputTickets } from '../review/useReviewData'
import { InputStatusBadge } from './InputStatusBadge'
import { SpeakerNamesForm } from './SpeakerNamesForm'
import { formatDateTime, inputTitle, kindLabel } from './inputUtils'
import { useInput, useProposedTicketCount } from './useInputs'
import styles from './InputDetailPage.module.css'

const SPEAKER_TONES: BadgeTone[] = ['primary', 'info', 'success', 'warning', 'design', 'dev', 'new_request', 'bug']

interface StepDef {
  label: string
}

function stepsFor(kind: Input['kind']): StepDef[] {
  return [
    { label: 'Envoyée' },
    ...(kind === 'meeting' ? [{ label: 'Transcription' }] : []),
    { label: 'Analyse' },
    { label: 'Prête' },
  ]
}

/** Index of the current step, or -1 when in error (no step is highlighted). */
function currentStep(input: Input, count: number): number {
  switch (input.status) {
    case 'uploaded':
      return 0
    case 'transcribing':
      return 1
    case 'analyzing':
      return count - 2
    case 'ready':
      return count - 1
    default:
      return -1
  }
}

function Steps({ input }: { input: Input }) {
  const steps = stepsFor(input.kind)
  const current = currentStep(input, steps.length)
  const allDone = input.status === 'ready'
  return (
    <ol className={styles.steps} aria-label="Progression">
      {steps.map((step, index) => {
        const state = allDone || index < current ? 'done' : index === current ? 'current' : 'todo'
        return (
          <li
            key={step.label}
            className={[styles.step, styles[state]].join(' ')}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={styles.stepIndex} aria-hidden="true">
              {state === 'done' ? '✓' : index + 1}
            </span>
            {step.label}
            {state === 'done' ? <span className="visually-hidden"> (terminée)</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

function Transcript({ input }: { input: Input }) {
  const transcript = input.transcript
  if (!transcript) {
    if (input.status === 'error') {
      return <EmptyState title="Pas de transcription" text="La transcription n'a pas pu être produite." />
    }
    return (
      <LoadingState
        label={input.status === 'uploaded' ? 'Fichier reçu, en attente de transcription…' : 'Transcription en cours…'}
      />
    )
  }
  if (transcript.utterances.length === 0) {
    return <EmptyState title="Transcription vide" text="Aucune parole n'a été détectée dans le fichier." />
  }
  return (
    <ul className={styles.transcript}>
      {transcript.utterances.map((u, index) => (
        <li key={index} className={styles.utterance}>
          <span className={styles.speaker}>
            <Badge tone={SPEAKER_TONES[u.speaker % SPEAKER_TONES.length] ?? 'neutral'}>
              {speakerLabel(u.speaker, input.speaker_names)}
            </Badge>
            <span className={styles.time}>{formatTimestamp(u.start)}</span>
          </span>
          <p className={styles.words}>{u.text}</p>
        </li>
      ))}
    </ul>
  )
}

function InputDetail({ input, projectId }: { input: Input; projectId: string }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ready = input.status === 'ready'
  const { data: proposed, isSuccess: countLoaded } = useProposedTicketCount(input.id, ready)
  const allTickets = useInputTickets(input.id, ready)
  const validatedCount = (allTickets.data ?? []).filter((t) => t.status === 'validated' || t.status === 'done').length

  async function rerun() {
    setRunning(true)
    try {
      await api.processInput({ inputId: input.id })
      toast.success('Traitement relancé.')
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        toast.success('Un traitement est déjà en cours.')
      } else {
        toast.error(e instanceof ApiRequestError ? e.message : 'Impossible de relancer le traitement.')
      }
    } finally {
      setRunning(false)
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.input(input.id) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) })
    }
  }

  const speakers = input.transcript
    ? [...new Set(input.transcript.utterances.map((u) => u.speaker))].sort((a, b) => a - b)
    : []

  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <BackLink to={`/projects/${projectId}/inputs`} label="Entrées" />
        <h1 className={styles.title}>{inputTitle(input)}</h1>
        <div className={styles.meta}>
          <Badge tone={input.kind === 'meeting' ? 'primary' : 'neutral'}>{kindLabel(input.kind)}</Badge>
          <span className={styles.date}>{formatDateTime(input.created_at)}</span>
          <span aria-live="polite">
            <InputStatusBadge status={input.status} />
          </span>
          <span className={styles.headerAction}>
            <DownloadInputButtons input={input} />
            <DeleteInputButton input={input} size="sm" goBackAfter />
          </span>
        </div>
      </header>

      <Steps input={input} />

      {input.status === 'error' ? (
        <div className={styles.errorBlock}>
          <ErrorState message={input.error_message ?? 'Le traitement de cette entrée a échoué.'} />
          <Button variant="primary" onClick={() => void rerun()} loading={running}>
            Relancer
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div className={styles.actions}>
          {proposed && proposed.tickets > 0 ? null : countLoaded ? (
            <p className={styles.noTicket}>
              Aucun ticket proposé.{' '}
              <Link to={`/projects/${projectId}/tickets`}>Voir les tickets du projet</Link>
            </p>
          ) : null}
          {confirming ? (
            <div className={styles.confirm} role="group" aria-label="Confirmer la relance">
              <p>Les tickets encore proposés de cette entrée seront remplacés.</p>
              {validatedCount > 0 ? (
                <p className={styles.warning} role="alert">
                  Attention : cette entrée a déjà {validatedCount} ticket{validatedCount > 1 ? 's' : ''} validé
                  {validatedCount > 1 ? 's' : ''}, qui {validatedCount > 1 ? 'restent' : 'reste'} en place. L'analyse évite de
                  les recréer, mais vérifie qu'il n'y a pas de doublon avant de valider.
                </p>
              ) : null}
              <div className={styles.confirmButtons}>
                <Button variant="primary" onClick={() => void rerun()} loading={running}>
                  Relancer l'analyse
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)} disabled={running}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Relancer l'analyse
            </Button>
          )}
        </div>
      ) : null}

      {ready ? <ProposedTicketsPreview input={input} /> : null}

      {input.kind === 'written' ? (
        <Card>
          <h2 className={styles.sectionTitle}>Retour écrit</h2>
          <p className={styles.rawText}>{input.raw_text ?? ''}</p>
        </Card>
      ) : (
        <>
          <section aria-labelledby="transcript-title" className={styles.section}>
            <h2 id="transcript-title" className={styles.sectionTitle}>
              Transcription
            </h2>
            <Transcript input={input} />
          </section>
          {input.transcript && speakers.length > 0 ? (
            <Card>
              <SpeakerNamesForm
                key={JSON.stringify(input.speaker_names)}
                input={input}
                speakers={speakers}
              />
            </Card>
          ) : null}
        </>
      )}
    </article>
  )
}

export function InputDetailPage() {
  const { projectId, inputId } = useParams()
  const { data: input, isLoading, isError, refetch } = useInput(inputId)

  if (isLoading) return <LoadingState label="Chargement de l'entrée…" />
  if (isError) return <ErrorState message="Impossible de charger l'entrée." onRetry={() => void refetch()} />
  if (!input || !projectId) {
    return (
      <EmptyState
        title="Entrée introuvable"
        text="Cette entrée n'existe pas ou tu n'y as pas accès."
        action={projectId ? <Link to={`/projects/${projectId}/inputs`}>Retour aux entrées</Link> : <Link to="/projects">Retour aux projets</Link>}
      />
    )
  }
  return <InputDetail input={input} projectId={projectId} />
}
