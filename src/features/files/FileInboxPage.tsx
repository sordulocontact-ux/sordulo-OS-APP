import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, EmptyState, ErrorState, LoadingState, useToast, type BadgeTone } from '../../components/ui'
import tableStyles from '../../components/ui/dataTable.module.css'
import {
  FilingError,
  cancelIntake,
  choiceFromProposal,
  classifyIntake,
  fileIntake,
  filingKeys,
  listBatch,
  listPendingIntakes,
  undoFiling,
} from '../../lib/filing'
import { proposalLabel } from '../../shared/filing'
import type { FileIntake } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { INTAKE_STATE_LABELS, fileErrorText, formatSize, intakeState, isIntakeBusy, sureIntakes, type IntakeState } from './fileLogic'
import { formatFileDate } from './format'
import { filesKeys } from './keys'
import { openFileDrop } from './openFileDrop'
import { useFilingDirectory } from './useFiles'
import styles from './files.module.css'

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

/** Boîte de dépôt : mes dépôts en attente (ceux de l'organisation pour un admin), filtrables par lot (?batch=). */
export function FileInboxPage() {
  const { member, organization } = useCurrentMember()
  const { data: members } = useOrgMembers(organization?.id)
  const { data: directory } = useFilingDirectory(organization?.id)
  const [params] = useSearchParams()
  const batch = params.get('batch')
  const isAdmin = member?.role === 'admin'
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState(false)

  const orgId = organization?.id ?? ''
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: batch ? filingKeys.batch(batch) : [...filingKeys.pending(orgId), isAdmin ? 'all' : (member?.id ?? '')],
    enabled: batch ? true : Boolean(organization && member),
    queryFn: () => (batch ? listBatch(batch) : listPendingIntakes(orgId, isAdmin ? {} : { createdBy: member?.id })),
    refetchInterval: (query) => (query.state.data?.some(isIntakeBusy) ? 2000 : false),
  })

  const items = (data ?? []).filter((intake) => intake.status !== 'cancelled')
  const sure = sureIntakes(items)

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: filingKeys.all }), queryClient.invalidateQueries({ queryKey: filesKeys.all })])
  }

  async function runOne(id: string, task: () => Promise<unknown>, success: string) {
    setBusyIds((current) => new Set(current).add(id))
    try {
      await task()
      await refresh()
      if (success) toast.success(success)
    } catch (error) {
      toast.error(messageOf(error))
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  function file(intake: FileIntake) {
    const choice = choiceFromProposal(intake)
    if (!choice) return Promise.resolve()
    return fileIntake(intake.id, choice)
  }

  async function fileAllSure() {
    setBulk(true)
    let done = 0
    let failed = 0
    for (const intake of sure) {
      try {
        await file(intake)
        done++
      } catch {
        failed++
      }
    }
    await refresh()
    setBulk(false)
    if (done > 0) toast.success(done === 1 ? '1 fichier rangé.' : `${done} fichiers rangés.`)
    if (failed > 0) toast.error(failed === 1 ? '1 fichier n’a pas pu être rangé.' : `${failed} fichiers n’ont pas pu être rangés.`)
  }

  const authorName = (memberId: string | null) => members?.find((candidate) => candidate.id === memberId)?.name ?? 'Inconnu'

  function proposalText(intake: FileIntake): string {
    if (intake.status === 'error') return intake.error_message ?? 'Le classement a échoué.'
    if (!intake.proposal) return isIntakeBusy(intake) ? 'Analyse en cours…' : 'Aucune proposition'
    return proposalLabel(intake.proposal, {
      clientName: directory?.clients.find((client) => client.id === intake.proposal?.client_id)?.name,
      projectName: directory?.projects.find((project) => project.id === intake.proposal?.project_id)?.name,
    })
  }

  return (
    <div className={tableStyles.page}>
      <div className={styles.header}>
        <h1>Boîte de dépôt</h1>
        <div className={styles.actions}>
          {sure.length > 0 ? (
            <Button variant="primary" onClick={() => void fileAllSure()} loading={bulk}>
              Tout ranger ({sure.length})
            </Button>
          ) : null}
          <Button onClick={() => openFileDrop()}>Déposer un fichier</Button>
        </div>
      </div>
      <p className={styles.hint}>
        {batch ? (
          <>
            Fichiers déposés ensemble. <Link to="/files/inbox">Voir tous les dépôts</Link>
          </>
        ) : isAdmin ? (
          'Les dépôts en attente de toute l’organisation.'
        ) : (
          'Tes dépôts en attente de rangement.'
        )}
      </p>

      {isLoading ? (
        <LoadingState label="Chargement des dépôts…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les dépôts." onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Rien à ranger"
          text="Dépose un ou plusieurs fichiers : l’IA propose où les ranger."
          action={<Button onClick={() => openFileDrop()}>Déposer un fichier</Button>}
        />
      ) : (
        <div className={tableStyles.scroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Fichier</th>
                <th scope="col">Proposition</th>
                <th scope="col">État</th>
                <th scope="col" className={styles.colActions}>
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((intake) => {
                const state = intakeState(intake)
                const busy = bulk || busyIds.has(intake.id)
                return (
                  <tr key={intake.id} className={tableStyles.row}>
                    <td>
                      <span className={tableStyles.primary}>{intake.name}</span>
                      <span className={tableStyles.secondLine}>
                        {[formatSize(intake.size_bytes), formatFileDate(intake.created_at), isAdmin ? authorName(intake.created_by) : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className={state === 'error' ? styles.errorText : undefined}>{proposalText(intake)}</td>
                    <td>
                      <Badge tone={STATE_TONES[state]} aria-live="polite">
                        {INTAKE_STATE_LABELS[state]}
                      </Badge>
                    </td>
                    <td className={styles.rowActions}>
                      {state === 'sure' ? (
                        <Button size="sm" variant="primary" loading={busy} onClick={() => void runOne(intake.id, () => file(intake), 'Fichier rangé.')}>
                          Ranger
                        </Button>
                      ) : null}
                      {state === 'sure' || state === 'check' ? (
                        <Link to={`/files/intake/${intake.id}`} className={styles.docLink}>
                          {state === 'check' ? 'Vérifier' : 'Modifier'}
                        </Link>
                      ) : null}
                      {state === 'error' ? (
                        <>
                          <Button size="sm" loading={busy} onClick={() => void runOne(intake.id, () => classifyIntake(intake.id), '')}>
                            Réessayer
                          </Button>
                          <Link to={`/files/intake/${intake.id}`} className={styles.docLink}>
                            Ouvrir
                          </Link>
                        </>
                      ) : null}
                      {state === 'auto' || state === 'filed' ? (
                        <Button size="sm" variant="ghost" loading={busy} onClick={() => void runOne(intake.id, () => undoFiling(intake.id), 'Rangement annulé.')}>
                          Annuler le rangement
                        </Button>
                      ) : state !== 'cancelled' ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runOne(intake.id, () => cancelIntake(intake.id), 'Dépôt abandonné.')}>
                          Annuler
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
