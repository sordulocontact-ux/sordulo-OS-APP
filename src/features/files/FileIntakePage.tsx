import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BackLink, Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Select, Spinner, TextInput, useToast } from '../../components/ui'
import {
  FilingError,
  cancelIntake,
  classifyIntake,
  fileIntake,
  filingKeys,
  getIntake,
  importFromIntake,
  revokeFilingRule,
  undoFiling,
} from '../../lib/filing'
import { REVIEW_REASON_LABELS, reviewReasons, type ReviewReason } from '../../shared/filing'
import { DEFAULT_FOLDERS, FILE_KINDS, FOLDER_BY_KIND, LABELS, type FileIntake, type FileKind } from '../../shared/types'
import { ApiRequestError } from '../../lib/api'
import { useCurrentMember } from '../auth/useCurrentMember'
import { createWrittenInputFromDocument } from '../inputs/createDocumentInput'
import { DocumentError } from '../inputs/documentText'
import { FilePreview } from './FilePreview'
import {
  alwaysLabel,
  confidenceWord,
  fileErrorText,
  filedPlaceLabel,
  folderList,
  initialDraft,
  isIntakeBusy,
  latestVersions,
  projectsOfClient,
  resolveVersionGroup,
  versionLabel,
  type IntakeDraft,
} from './fileLogic'
import { filesKeys } from './keys'
import { fetchFileAsFile } from './projectFiles'
import { useFilingDirectory, useProjectDocuments, useProjectFile, useProjectFiles, type FilingDirectory } from './useFiles'
import styles from './files.module.css'

const INBOX_PATH = '/files/inbox'
/** Motifs qui ont leur propre encadré sur l'écran. */
const SHOWN_ELSEWHERE: readonly ReviewReason[] = ['duplicate', 'import_suggested']

function messageOf(error: unknown): string {
  if (error instanceof FilingError || error instanceof ApiRequestError || error instanceof DocumentError) return error.message
  return fileErrorText(error)
}

/** Écran de rangement d'un dépôt : proposition de l'IA modifiable, motifs de vérification, doublon, import, règle « Toujours ». */
export function FileIntakePage() {
  const { intakeId } = useParams()
  const id = intakeId ?? ''
  const { organization } = useCurrentMember()
  const { data: directory, isLoading: directoryLoading } = useFilingDirectory(organization?.id)
  const { data: intake, isLoading, isError, refetch } = useQuery({
    queryKey: filingKeys.intake(id),
    enabled: id !== '',
    queryFn: () => getIntake(id),
    // Classement en cours : relecture toutes les 2 s.
    refetchInterval: (query) => (query.state.data && isIntakeBusy(query.state.data) ? 2000 : false),
  })

  let content
  if (isLoading || directoryLoading) content = <LoadingState label="Chargement du dépôt…" />
  else if (isError) content = <ErrorState message="Impossible de charger ce dépôt." onRetry={() => void refetch()} />
  else if (!intake)
    content = (
      <EmptyState
        title="Dépôt introuvable"
        text="Il n’existe pas, ou il est réservé au membre qui l’a déposé."
        action={
          <Link to={INBOX_PATH}>
            Voir la boîte de dépôt
          </Link>
        }
      />
    )
  else content = <IntakeBody intake={intake} directory={directory ?? { clients: [], projects: [] }} />

  return (
    <div className={styles.intakePage}>
      <BackLink to={INBOX_PATH} label="Boîte de dépôt" />
      {intake ? (
        <header className={styles.intakeHeader}>
          <h1 className={styles.intakeTitle}>{intake.name}</h1>
          <Badge tone={confidenceTone(intake)}>{intakeBadgeText(intake)}</Badge>
        </header>
      ) : null}
      {content}
    </div>
  )
}

function intakeBadgeText(intake: FileIntake): string {
  if (intake.status === 'filed') return intake.auto_filed ? 'Rangé automatiquement' : 'Rangé'
  if (intake.status === 'cancelled') return 'Abandonné'
  if (intake.status === 'error') return 'Erreur'
  if (intake.status === 'ready') return confidenceWord(intake)
  return 'Analyse…'
}

function confidenceTone(intake: FileIntake) {
  if (intake.status === 'filed') return 'success'
  if (intake.status === 'error') return 'danger'
  if (intake.status === 'ready') return confidenceWord(intake) === 'Sûr' ? 'success' : 'warning'
  return 'neutral'
}

function IntakeBody({ intake, directory }: { intake: FileIntake; directory: FilingDirectory }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: filingKeys.all }), queryClient.invalidateQueries({ queryKey: filesKeys.all })])
  }

  async function abandon() {
    setBusy(true)
    try {
      await cancelIntake(intake.id)
      await refresh()
      toast.success('Dépôt abandonné.')
      void navigate(INBOX_PATH)
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function retry() {
    setBusy(true)
    try {
      const outcome = await classifyIntake(intake.id)
      await refresh()
      if (outcome.classifyError) toast.error(outcome.classifyError)
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (intake.status === 'cancelled') {
    return <EmptyState title="Ce dépôt a été abandonné" text="Dépose le fichier de nouveau pour le ranger." action={<Link to={INBOX_PATH}>Voir la boîte de dépôt</Link>} />
  }

  const side = (
    <Card className={styles.previewCard}>
      <FilePreview storagePath={intake.storage_path} name={intake.name} mimeType={intake.mime_type} />
    </Card>
  )

  if (intake.status === 'uploaded' || intake.status === 'classifying') {
    return (
      <div className={styles.intakeGrid}>
        {side}
        <Card className={styles.panel}>
          <p className={styles.progress} role="status" aria-live="polite">
            <Spinner label="" />
            Classement en cours…
          </p>
          <p className={styles.hint}>La proposition arrive dans quelques secondes. Cette page se met à jour toute seule.</p>
          <div className={styles.formActions}>
            {intake.status === 'uploaded' ? (
              <Button onClick={() => void retry()} loading={busy}>
                Relancer le classement
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void abandon()} disabled={busy}>
              Abandonner le dépôt
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (intake.status === 'error') {
    return (
      <div className={styles.intakeGrid}>
        {side}
        <Card className={styles.panel}>
          <ErrorState message={intake.error_message ?? 'Le classement a échoué.'} onRetry={busy ? undefined : () => void retry()} />
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => void abandon()} disabled={busy}>
              Abandonner le dépôt
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (intake.status === 'filed') {
    return (
      <div className={styles.intakeGrid}>
        {side}
        <FiledPanel intake={intake} directory={directory} />
      </div>
    )
  }

  return (
    <div className={styles.intakeGrid}>
      {side}
      <ReviewForm key={`${intake.id}-${intake.updated_at}`} intake={intake} directory={directory} onAbandon={() => void abandon()} abandoning={busy} />
    </div>
  )
}

/* ---------- Déjà rangé ---------- */

function FiledPanel({ intake, directory }: { intake: FileIntake; directory: FilingDirectory }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: file, isLoading } = useProjectFile(intake.filed_file_id)
  const [busy, setBusy] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const projectName = file ? (directory.projects.find((project) => project.id === file.project_id)?.name ?? null) : null

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: filingKeys.all }), queryClient.invalidateQueries({ queryKey: filesKeys.all })])
  }

  async function undo() {
    setBusy(true)
    try {
      await undoFiling(intake.id)
      await refresh()
      toast.success('Rangement annulé : le fichier est à la corbeille.')
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!intake.rule_id) return
    setBusy(true)
    try {
      await revokeFilingRule(intake.rule_id)
      setRevoked(true)
      await refresh()
      toast.success('C’est noté : ces documents ne seront plus rangés seuls.')
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <LoadingState label="Chargement du fichier…" />

  return (
    <Card className={styles.panel}>
      {file ? (
        <>
          <div className={styles.banner} role="status">
            <p className={styles.bannerText}>
              {intake.auto_filed ? 'Rangé automatiquement. ' : ''}
              {filedPlaceLabel(projectName, file.folder)}
              {versionLabel(file.version) ? ` (${versionLabel(file.version)})` : ''}
            </p>
            <div className={styles.formActions}>
              <Button size="sm" onClick={() => void undo()} loading={busy}>
                Annuler
              </Button>
              <Link to={`/projects/${file.project_id}/files?file=${file.id}`}>Voir le fichier</Link>
            </div>
          </div>
          {file.summary ? <p className={styles.summary}>{file.summary}</p> : null}
          {file.change_summary ? <p className={styles.summary}>Ce qui change : {file.change_summary}</p> : null}
          {intake.auto_filed && intake.rule_id && !revoked ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => void revoke()} disabled={busy}>
                Ne plus ranger seul
              </Button>
            </div>
          ) : null}
          {intake.proposal?.suggest_tickets || file.kind === 'feedback' ? <CreateTickets file={file} /> : null}
        </>
      ) : (
        <p className={styles.hint}>Le fichier rangé a été supprimé définitivement.</p>
      )}
    </Card>
  )
}

/** Retour client rangé : le fichier devient une entrée du projet, analysée en tickets (import en lecture seule). */
function CreateTickets({ file }: { file: NonNullable<ReturnType<typeof useProjectFile>['data']> }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [inputPath, setInputPath] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    try {
      const blob = await fetchFileAsFile(file.storage_path, file.name, file.mime_type)
      const input = await createWrittenInputFromDocument(blob, file.project_id)
      await queryClient.invalidateQueries({ queryKey: ['inputs', file.project_id] })
      setInputPath(`/projects/${file.project_id}/inputs/${input.id}`)
      toast.success('Entrée créée : l’analyse des tickets démarre.')
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.callout}>
      <p className={styles.calloutText}>Ce document ressemble à un retour client. Tu peux en faire des tickets.</p>
      {inputPath ? (
        <Link to={inputPath}>Ouvrir l’entrée</Link>
      ) : (
        <Button variant="primary" size="sm" onClick={() => void create()} loading={busy}>
          Créer les tickets
        </Button>
      )}
    </div>
  )
}

/* ---------- Proposition à relire ---------- */

interface ReviewFormProps {
  intake: FileIntake
  directory: FilingDirectory
  onAbandon: () => void
  abandoning: boolean
}

function ReviewForm({ intake, directory, onAbandon, abandoning }: ReviewFormProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const proposal = intake.proposal
  const [draft, setDraft] = useState<IntakeDraft>(() => initialDraft(intake, directory.projects))
  const [always, setAlways] = useState(false)
  const [pinProject, setPinProject] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<{ quoteId: string | null; invoiceId: string | null; warning?: string } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const projectFiles = useProjectFiles(draft.projectId || undefined)
  const documents = useProjectDocuments(draft.projectId || undefined)
  const duplicate = useProjectFile(proposal?.duplicate_of_file_id)

  const patch = (changes: Partial<IntakeDraft>) => setDraft((current) => ({ ...current, ...changes }))
  const projectOptions = projectsOfClient(directory.projects, draft.clientId)
  const client = directory.clients.find((candidate) => candidate.id === draft.clientId) ?? null
  const live = latestVersions(projectFiles.data ?? [])
  const versionValue = live.some((file) => file.id === draft.versionFileId) ? draft.versionFileId : ''
  const folderNames = Array.from(new Set([...DEFAULT_FOLDERS, ...folderList(projectFiles.data ?? [])]))
  const reasons = reviewReasons(intake).filter((reason) => !SHOWN_ELSEWHERE.includes(reason))
  const isDuplicate = Boolean(proposal?.duplicate_of_file_id)
  const quotes = documents.data?.quotes ?? []
  const invoices = documents.data?.invoices ?? []
  const quoteOptions = imported?.quoteId && !quotes.some((quote) => quote.id === imported.quoteId) ? [...quotes, { id: imported.quoteId, label: 'Devis importé' }] : quotes
  const invoiceOptions =
    imported?.invoiceId && !invoices.some((invoice) => invoice.id === imported.invoiceId) ? [...invoices, { id: imported.invoiceId, label: 'Facture importée' }] : invoices

  function changeKind(kind: FileKind) {
    setDraft((current) => {
      const keepFolder = !(DEFAULT_FOLDERS as readonly string[]).includes(current.folder) || current.folder !== FOLDER_BY_KIND[current.kind]
      return { ...current, kind, folder: keepFolder ? current.folder : FOLDER_BY_KIND[kind] }
    })
  }

  async function submit() {
    if (!draft.projectId) return
    setBusy(true)
    try {
      const versionGroupId = resolveVersionGroup(projectFiles.data ?? [], draft.versionFileId, draft.projectId)
      const result = await fileIntake(intake.id, {
        projectId: draft.projectId,
        folder: draft.folder,
        kind: draft.kind,
        name: draft.name,
        quoteId: draft.kind === 'quote' && draft.quoteId ? draft.quoteId : null,
        invoiceId: draft.kind === 'invoice' && draft.invoiceId ? draft.invoiceId : null,
        versionGroupId,
        changeSummary: versionGroupId && draft.versionFileId === proposal?.previous_version_file_id ? undefined : null,
        always,
        alwaysPinProject: always && pinProject,
        clientId: draft.clientId || null,
      })
      await Promise.all([queryClient.invalidateQueries({ queryKey: filingKeys.all }), queryClient.invalidateQueries({ queryKey: filesKeys.all })])
      const project = directory.projects.find((candidate) => candidate.id === result.file.project_id)
      toast.success(filedPlaceLabel(project?.name ?? null, result.file.folder) + '.')
      if (result.ruleError) toast.error(`Rangé, mais la règle « Toujours » n’a pas été créée : ${result.ruleError}`)
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    setImporting(true)
    setImportError(null)
    try {
      const result = await importFromIntake(intake.id)
      setImported(result)
      if (result.quoteId) patch({ quoteId: result.quoteId })
      if (result.invoiceId) patch({ invoiceId: result.invoiceId })
      await queryClient.invalidateQueries({ queryKey: filesKeys.all })
      toast.success(result.quoteId ? 'Devis importé.' : 'Facture importée.')
    } catch (error) {
      setImportError(messageOf(error))
    } finally {
      setImporting(false)
    }
  }

  const importNoun = draft.kind === 'invoice' ? 'la facture importée' : 'le devis importé'

  return (
    <Card className={styles.panel}>
      <div className={styles.confidenceLine}>
        <Badge tone={confidenceTone(intake)}>{confidenceWord(intake)}</Badge>
        {proposal?.document_number ? <span className={styles.muted}>N° {proposal.document_number}</span> : null}
      </div>

      {reasons.length > 0 ? (
        <ul className={styles.reasons} aria-label="À vérifier">
          {reasons.map((reason) => (
            <li key={reason}>{REVIEW_REASON_LABELS[reason]}</li>
          ))}
        </ul>
      ) : null}

      {proposal?.summary ? <p className={styles.summary}>{proposal.summary}</p> : null}
      {proposal && proposal.reasons.length > 0 ? (
        <details className={styles.details}>
          <summary>Pourquoi ce rangement</summary>
          <ul className={styles.reasons}>
            {proposal.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {isDuplicate ? (
        <div className={styles.callout} role="alert">
          <p className={styles.calloutText}>
            Ce fichier est identique à un fichier déjà rangé
            {duplicate.data ? (
              <>
                {' : '}
                <Link to={`/projects/${duplicate.data.project_id}/files?file=${duplicate.data.id}`}>{duplicate.data.name}</Link>
              </>
            ) : null}
            .
          </p>
        </div>
      ) : null}

      {proposal?.suggest_import ? (
        <div className={styles.callout}>
          <p className={styles.calloutText}>
            {draft.kind === 'invoice' ? 'Cette facture' : 'Ce devis'} n’existe pas dans Sordulo OS. Tu peux créer {importNoun} d’après le fichier, puis le relier ici.
          </p>
          {imported ? (
            <>
              <Link to={imported.quoteId ? `/quotes/${imported.quoteId}` : `/invoices/${imported.invoiceId ?? ''}`}>
                {imported.quoteId ? 'Ouvrir le devis créé' : 'Ouvrir la facture créée'}
              </Link>
              {imported.warning ? (
                <p className={styles.warningText} role="status">
                  {imported.warning}
                </p>
              ) : null}
            </>
          ) : (
            <Button size="sm" onClick={() => void runImport()} loading={importing}>
              {draft.kind === 'invoice' ? 'Créer la facture importée' : 'Créer le devis importé'}
            </Button>
          )}
          {importError ? (
            <p className={styles.errorText} role="alert">
              {importError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.fields}>
        <Field label="Client">
          <Select
            value={draft.clientId}
            onChange={(event) => {
              const clientId = event.target.value
              const stillValid = projectsOfClient(directory.projects, clientId).some((project) => project.id === draft.projectId)
              patch({ clientId, projectId: stillValid ? draft.projectId : '', versionFileId: stillValid ? draft.versionFileId : '' })
            }}
          >
            <option value="">Tous les clients</option>
            {directory.clients.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projet">
          <Select
            value={draft.projectId}
            onChange={(event) => {
              const project = directory.projects.find((candidate) => candidate.id === event.target.value)
              patch({ projectId: event.target.value, clientId: project?.client_id ?? draft.clientId, versionFileId: '', quoteId: '', invoiceId: '' })
            }}
          >
            <option value="">Choisir un projet</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type de document">
          <Select value={draft.kind} onChange={(event) => changeKind(event.target.value as FileKind)}>
            {FILE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LABELS.fileKind[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dossier">
          <TextInput value={draft.folder} onChange={(event) => patch({ folder: event.target.value })} list="intake-folders" maxLength={80} />
          <datalist id="intake-folders">
            {folderNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Nom du fichier">
          <TextInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} maxLength={255} />
        </Field>
        {draft.kind === 'quote' && (quoteOptions.length > 0 || draft.quoteId) ? (
          <Field label="Devis relié">
            <Select value={draft.quoteId} onChange={(event) => patch({ quoteId: event.target.value })}>
              <option value="">Aucun</option>
              {quoteOptions.map((quote) => (
                <option key={quote.id} value={quote.id}>
                  {quote.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {draft.kind === 'invoice' && (invoiceOptions.length > 0 || draft.invoiceId) ? (
          <Field label="Facture reliée">
            <Select value={draft.invoiceId} onChange={(event) => patch({ invoiceId: event.target.value })}>
              <option value="">Aucune</option>
              {invoiceOptions.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {draft.projectId ? (
          <Field label="Version" hint={versionValue && proposal?.change_summary && draft.versionFileId === proposal.previous_version_file_id ? `Ce qui change : ${proposal.change_summary}` : undefined}>
            <Select value={versionValue} onChange={(event) => patch({ versionFileId: event.target.value })} disabled={projectFiles.isLoading}>
              <option value="">Nouveau fichier</option>
              {live.map((file) => (
                <option key={file.id} value={file.id}>
                  Nouvelle version de « {file.name} »{versionLabel(file.version) ? ` (${versionLabel(file.version)})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {client || draft.clientId ? (
        <div className={styles.alwaysBox}>
          <label className={styles.check}>
            <input type="checkbox" checked={always} onChange={(event) => setAlways(event.target.checked)} />
            <span>{alwaysLabel(draft.kind, client?.name ?? null)}</span>
          </label>
          {always ? (
            <label className={styles.check}>
              <input type="checkbox" checked={pinProject} onChange={(event) => setPinProject(event.target.checked)} />
              <span>Toujours dans ce projet (sinon dans celui que l’IA détecte)</span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className={styles.formActions}>
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!draft.projectId || draft.name.trim() === '' || projectFiles.isLoading || abandoning}>
          {isDuplicate ? 'Ranger quand même' : 'Ranger'}
        </Button>
        <Button variant="ghost" onClick={onAbandon} loading={abandoning} disabled={busy}>
          Abandonner le dépôt
        </Button>
      </div>
    </Card>
  )
}
