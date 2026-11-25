import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Modal, Spinner, useToast, type BadgeTone } from '../../components/ui'
import {
  FilingError,
  choiceFromProposal,
  classifyIntake,
  fileIntake,
  filingKeys,
  startBatch,
  startIntake,
  undoFiling,
} from '../../lib/filing'
import { proposalLabel } from '../../shared/filing'
import type { FileIntake } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { dragHasFiles, filesFromDrop } from '../inputs/documentText'
import { INTAKE_STATE_LABELS, fileErrorText, filedPlaceLabel, formatSize, intakeState, type IntakeState } from './fileLogic'
import { filesKeys } from './keys'
import { OPEN_FILE_DROP_EVENT } from './openFileDrop'
import { useFilingDirectory } from './useFiles'
import styles from './files.module.css'

interface Entry {
  key: string
  file: File
  intake: FileIntake | null
  error: string | null
}

const STATE_TONES: Record<IntakeState, BadgeTone> = {
  pending: 'info',
  error: 'danger',
  sure: 'success',
  check: 'warning',
  auto: 'success',
  filed: 'success',
  cancelled: 'neutral',
}

function messageOf(error: unknown): string {
  return error instanceof FilingError ? error.message : fileErrorText(error)
}

/**
 * Fenêtre « Déposer un fichier » : à monter une fois dans la mise en page (elle écoute `openFileDrop()`).
 * Un ou plusieurs fichiers, progression par fichier, puis le résultat de chacun : rangé automatiquement,
 * sûr (Ranger en un clic), à vérifier (écran de rangement) ou erreur (Réessayer).
 */
export function FileDropDialog() {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)
  const [initialFiles, setInitialFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    function onOpen(event: Event) {
      const files = (event as CustomEvent<File[] | undefined>).detail ?? []
      setInitialFiles(files)
      setSession((value) => value + 1)
      setSending(false)
      setOpen(true)
    }
    document.addEventListener(OPEN_FILE_DROP_EVENT, onOpen)
    return () => document.removeEventListener(OPEN_FILE_DROP_EVENT, onOpen)
  }, [])

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Déposer un fichier" dismissible={!sending}>
      <DropBody key={session} initialFiles={initialFiles} onSendingChange={setSending} onNavigate={() => setOpen(false)} />
    </Modal>
  )
}

interface DropBodyProps {
  initialFiles: File[]
  onSendingChange: (sending: boolean) => void
  onNavigate: () => void
}

function DropBody({ initialFiles, onSendingChange, onNavigate }: DropBodyProps) {
  const { member, organization } = useCurrentMember()
  const { data: directory } = useFilingDirectory(organization?.id)
  const queryClient = useQueryClient()
  const toast = useToast()
  const pickRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [entries, setEntries] = useState<Entry[]>(() => initialFiles.map(toEntry))
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())

  function toEntry(file: File): Entry {
    return { key: crypto.randomUUID(), file, intake: null, error: null }
  }

  function patchEntry(key: string, changes: Partial<Entry>) {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)))
  }

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: filingKeys.all }), queryClient.invalidateQueries({ queryKey: filesKeys.all })])
  }

  async function send(newEntries: Entry[]) {
    if (!member || !organization || newEntries.length === 0) return
    setProgress({ done: 0, total: newEntries.length })
    onSendingChange(true)
    const byFile = new Map(newEntries.map((entry) => [entry.file, entry.key]))
    const result = await startBatch(
      newEntries.map((entry) => entry.file),
      {
        source: 'web',
        organizationId: organization.id,
        memberId: member.id,
        onProgress: ({ done, total, item }) => {
          setProgress({ done, total })
          const key = byFile.get(item.file)
          if (key) patchEntry(key, { intake: item.outcome?.intake ?? null, error: item.error })
        },
      },
    )
    setBatchId(result.batchId)
    setProgress(null)
    onSendingChange(false)
    await refresh()
  }

  // Fichiers donnés à l'ouverture (glissés sur la page) : envoyés une seule fois.
  useEffect(() => {
    if (initialFiles.length === 0) return
    const timer = setTimeout(() => void send(entries), 0)
    return () => clearTimeout(timer)
    // Une seule fois par ouverture : la fenêtre est remontée à chaque `openFileDrop()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function add(files: File[]) {
    if (files.length === 0) return
    const next = files.map(toEntry)
    setEntries((current) => [...current, ...next])
    void send(next)
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    add(files)
  }

  function onDragEnter(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragOver(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void filesFromDrop(event.dataTransfer).then(add)
  }

  async function run(entry: Entry, task: () => Promise<FileIntake | null>, success?: (intake: FileIntake) => string) {
    setBusyKeys((current) => new Set(current).add(entry.key))
    try {
      const intake = await task()
      if (intake) {
        patchEntry(entry.key, { intake, error: null })
        if (success) toast.success(success(intake))
      }
      await refresh()
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current)
        next.delete(entry.key)
        return next
      })
    }
  }

  const fileEntry = (entry: Entry) =>
    run(
      entry,
      async () => {
        const intake = entry.intake
        const choice = intake ? choiceFromProposal(intake) : null
        if (!intake || !choice) return null
        const result = await fileIntake(intake.id, choice)
        return result.intake
      },
      () => 'Fichier rangé.',
    )

  const retryEntry = (entry: Entry) =>
    run(entry, async () => {
      if (entry.intake) {
        const outcome = await classifyIntake(entry.intake.id)
        if (outcome.classifyError) toast.error(outcome.classifyError)
        return outcome.intake
      }
      if (!member || !organization) return null
      const outcome = await startIntake(entry.file, { source: 'web', organizationId: organization.id, memberId: member.id, batchId })
      if (outcome.classifyError) toast.error(outcome.classifyError)
      return outcome.intake
    })

  const undoEntry = (entry: Entry) =>
    run(
      entry,
      async () => (entry.intake ? await undoFiling(entry.intake.id) : null),
      () => 'Rangement annulé.',
    )

  const sureEntries = entries.filter((entry) => entry.intake && intakeState(entry.intake) === 'sure')
  const needsCheck = entries.filter((entry) => entry.intake && intakeState(entry.intake) === 'check').length
  const sending = progress !== null

  async function fileAllSure() {
    for (const entry of sureEntries) await fileEntry(entry)
  }

  function label(entry: Entry): string {
    const intake = entry.intake
    if (!intake) return ''
    if (intake.status === 'filed') {
      const file = intake.proposal
      const project = directory?.projects.find((candidate) => candidate.id === file?.project_id)
      return filedPlaceLabel(project?.name ?? null, file?.folder ?? '')
    }
    if (!intake.proposal) return intake.status === 'error' ? (intake.error_message ?? 'Le classement a échoué.') : 'Analyse en cours…'
    return proposalLabel(intake.proposal, {
      clientName: directory?.clients.find((client) => client.id === intake.proposal?.client_id)?.name,
      projectName: directory?.projects.find((project) => project.id === intake.proposal?.project_id)?.name,
    })
  }

  return (
    <div className={styles.dropBody} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button type="button" className={styles.dropZone} data-dragging={dragging || undefined} onClick={() => pickRef.current?.click()}>
        <span className={styles.dropZoneTitle}>{dragging ? 'Dépose les fichiers' : 'Choisis des fichiers ou glisse-les ici'}</span>
        <span className={styles.hint}>Plusieurs à la fois. L’IA propose où les ranger.</span>
      </button>
      <input ref={pickRef} type="file" multiple className={styles.hiddenInput} onChange={onPick} tabIndex={-1} aria-hidden="true" />

      {progress ? (
        <p className={styles.progress} role="status" aria-live="polite">
          <Spinner label="" />
          Envoi et analyse : {progress.done} sur {progress.total}
        </p>
      ) : null}

      {entries.length > 0 ? (
        <ul className={styles.dropList} aria-label="Fichiers déposés">
          {entries.map((entry) => {
            const intake = entry.intake
            const failed = !intake && entry.error !== null
            const state: IntakeState | 'sending' = intake ? (intake.status === 'error' ? 'error' : intakeState(intake)) : failed ? 'error' : 'sending'
            const busy = busyKeys.has(entry.key)
            return (
              <li key={entry.key} className={styles.dropItem}>
                <div className={styles.dropItemMain}>
                  <span className={styles.dropName}>{entry.file.name}</span>
                  <span className={styles.muted}>{formatSize(entry.file.size)}</span>
                  <span aria-live="polite">
                    {state === 'sending' ? (
                      <Badge tone="neutral">Envoi…</Badge>
                    ) : (
                      <Badge tone={STATE_TONES[state]}>{INTAKE_STATE_LABELS[state]}</Badge>
                    )}
                  </span>
                </div>
                {state === 'error' ? (
                  <p className={styles.errorText} role="alert">
                    {entry.error ?? intake?.error_message ?? 'Une erreur est survenue.'}
                  </p>
                ) : intake ? (
                  <p className={styles.dropLabel}>{label(entry)}</p>
                ) : null}
                <div className={styles.dropActions}>
                  {state === 'sure' ? (
                    <Button size="sm" variant="primary" loading={busy} onClick={() => void fileEntry(entry)}>
                      Ranger
                    </Button>
                  ) : null}
                  {state === 'check' && intake ? (
                    <Link to={`/files/intake/${intake.id}`} onClick={onNavigate} className={styles.docLink}>
                      Vérifier
                    </Link>
                  ) : null}
                  {state === 'pending' && intake ? (
                    <Link to={`/files/intake/${intake.id}`} onClick={onNavigate} className={styles.docLink}>
                      Ouvrir
                    </Link>
                  ) : null}
                  {state === 'error' ? (
                    <Button size="sm" loading={busy} onClick={() => void retryEntry(entry)}>
                      Réessayer
                    </Button>
                  ) : null}
                  {state === 'auto' || state === 'filed' ? (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => void undoEntry(entry)}>
                      Annuler
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {entries.length > 0 && !sending ? (
        <div className={styles.dropFooter}>
          {sureEntries.length > 1 ? (
            <Button variant="primary" onClick={() => void fileAllSure()}>
              Tout ranger ({sureEntries.length})
            </Button>
          ) : null}
          {needsCheck > 1 && batchId ? (
            <Link to={`/files/inbox?batch=${batchId}`} onClick={onNavigate} className={styles.docLink}>
              Vérifier les {needsCheck} fichiers à la suite
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
