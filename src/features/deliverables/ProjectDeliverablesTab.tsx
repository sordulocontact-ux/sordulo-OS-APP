import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ActionsMenu, Badge, Button, EmptyState, ErrorState, LoadingState, Modal, useToast } from '../../components/ui'
import { useCurrentMember, useOrgMembers } from '../auth'
import { useProjectContext } from '../projects/useProjectContext'
import { LABELS } from '../../shared/types'
import { DeliverableFormModal, VersionUploadModal, type DeliverableFormValues } from './DeliverableModals'
import { DeliverableViewer, type NewCommentInput } from './DeliverableViewer'
import {
  DELIVERABLE_STATUS_TONE,
  VERSION_STATUS_TONE,
  formatDateTime,
  latestVersion,
  type ViewerComment,
} from './deliverableLogic'
import {
  deliverableErrorText,
  useAddComment,
  useCreateDeliverable,
  useDeleteDeliverable,
  useDeliverables,
  useSetCommentResolved,
  useSetVersionStatus,
  useSignedFileUrl,
  useUpdateDeliverable,
  useUploadVersion,
  useVersionComments,
  type DeliverableWithVersions,
  type VersionWithFile,
} from './useDeliverables'
import styles from './ProjectDeliverablesTab.module.css'

/**
 * Onglet « Livrables » de la page projet : liste des livrables, versions V1, V2…, visionneuse avec
 * les épingles et les commentaires (équipe et client). Sélection dans l'URL (?livrable=&version=).
 */
export function ProjectDeliverablesTab() {
  const { project } = useProjectContext()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const deliverables = useDeliverables(project.id)
  const createDeliverable = useCreateDeliverable(project.id)
  const [creating, setCreating] = useState(false)

  const list = useMemo(() => deliverables.data ?? [], [deliverables.data])
  const selectedId = searchParams.get('livrable')
  const selected = list.find((d) => d.id === selectedId) ?? list[0] ?? null

  function selectDeliverable(id: string) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('livrable', id)
        next.delete('version')
        return next
      },
      { replace: true },
    )
  }

  function create(values: DeliverableFormValues) {
    const position = list.reduce((max, d) => Math.max(max, d.position), 0) + 1
    createDeliverable.mutate(
      { ...values, position },
      {
        onSuccess: (created) => {
          setCreating(false)
          selectDeliverable(created.id)
          toast.success('Livrable créé : envoie sa première version')
        },
        onError: (error) => toast.error(deliverableErrorText(error)),
      },
    )
  }

  if (deliverables.isLoading) return <LoadingState label="Chargement des livrables…" />
  if (deliverables.isError) {
    return <ErrorState message="Impossible de charger les livrables." onRetry={() => void deliverables.refetch()} />
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Livrables</h2>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nouveau livrable
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Aucun livrable"
          text="Un livrable regroupe les versions d’une maquette ou d’un fichier soumis au client, avec ses commentaires et sa validation."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Créer le premier livrable
            </Button>
          }
        />
      ) : (
        <>
          <ul className={styles.cards} aria-label="Livrables du projet">
            {list.map((d) => {
              const latest = latestVersion(d.versions)
              const active = selected?.id === d.id
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`${styles.card} ${active ? styles.cardActive : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectDeliverable(d.id)}
                  >
                    <span className={styles.cardTitle}>{d.title}</span>
                    <span className={styles.cardMeta}>
                      <Badge tone={DELIVERABLE_STATUS_TONE[d.status]}>{LABELS.deliverableStatus[d.status]}</Badge>
                      <span>{latest ? `V${latest.version}` : 'Aucune version'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected ? <DeliverableDetail key={selected.id} deliverable={selected} /> : null}
        </>
      )}

      <DeliverableFormModal open={creating} onClose={() => setCreating(false)} saving={createDeliverable.isPending} onSubmit={create} />
    </div>
  )
}

function DeliverableDetail({ deliverable }: { deliverable: DeliverableWithVersions }) {
  const { project } = useProjectContext()
  const toast = useToast()
  const { member } = useCurrentMember()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const updateDeliverable = useUpdateDeliverable(project.id)
  const deleteDeliverable = useDeleteDeliverable(project.id)
  const uploadVersion = useUploadVersion(project.id)
  const setStatus = useSetVersionStatus(project.id)

  const latest = latestVersion(deliverable.versions)
  const requested = Number(searchParams.get('version'))
  const version = deliverable.versions.find((v) => v.version === requested) ?? latest
  const nextVersion = (latest?.version ?? 0) + 1

  function selectVersion(n: number) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.set('livrable', deliverable.id)
        if (n === latest?.version) next.delete('version')
        else next.set('version', String(n))
        return next
      },
      { replace: true },
    )
  }

  function save(values: DeliverableFormValues) {
    updateDeliverable.mutate(
      { id: deliverable.id, ...values },
      {
        onSuccess: () => {
          setEditing(false)
          toast.success('Livrable enregistré')
        },
        onError: (error) => toast.error(deliverableErrorText(error)),
      },
    )
  }

  function upload(values: { file: File; note: string | null }) {
    uploadVersion.mutate(
      {
        organizationId: project.organization_id,
        deliverableId: deliverable.id,
        file: values.file,
        note: values.note,
        previousVersionGroupId: latest?.file?.version_group_id ?? null,
      },
      {
        onSuccess: () => {
          setUploading(false)
          selectVersion(nextVersion)
          toast.success(`V${nextVersion} envoyée : le client peut la voir sur le portail`)
        },
        onError: (error) => toast.error(deliverableErrorText(error)),
      },
    )
  }

  function remove() {
    deleteDeliverable.mutate(deliverable.id, {
      onSuccess: () => {
        setConfirmDelete(false)
        toast.success('Livrable supprimé')
      },
      onError: (error) => toast.error(deliverableErrorText(error)),
    })
  }

  function decide(target: VersionWithFile, status: VersionWithFile['status']) {
    setStatus.mutate(
      { versionId: target.id, status, decidedByName: member?.name ?? null },
      {
        onSuccess: () => toast.success(`V${target.version} : ${LABELS.deliverableVersionStatus[status].toLowerCase()}`),
        onError: (error) => toast.error(deliverableErrorText(error)),
      },
    )
  }

  return (
    <section className={styles.detail} aria-labelledby={`livrable-${deliverable.id}`}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <h3 id={`livrable-${deliverable.id}`} className={styles.detailTitle}>
            {deliverable.title}
          </h3>
          <Badge tone={DELIVERABLE_STATUS_TONE[deliverable.status]}>{LABELS.deliverableStatus[deliverable.status]}</Badge>
        </div>
        <div className={styles.actions}>
          <Button variant={latest ? 'secondary' : 'primary'} onClick={() => setUploading(true)}>
            Envoyer la V{nextVersion}
          </Button>
          <ActionsMenu
            label={`Actions pour ${deliverable.title}`}
            items={[
              { label: 'Modifier', onSelect: () => setEditing(true) },
              { label: 'Supprimer', tone: 'danger', onSelect: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </div>
      {deliverable.description ? <p className={styles.description}>{deliverable.description}</p> : null}

      {!version ? (
        <EmptyState
          title="Aucune version"
          text="Envoie une image ou un PDF : le client pourra le commenter et le valider sur le portail."
          action={
            <Button variant="primary" onClick={() => setUploading(true)}>
              Envoyer la V1
            </Button>
          }
        />
      ) : (
        <>
          <div className={styles.versionBar}>
            <div className={styles.versions} role="group" aria-label="Versions">
              {deliverable.versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`${styles.versionButton} ${v.id === version.id ? styles.versionButtonActive : ''}`}
                  aria-pressed={v.id === version.id}
                  onClick={() => selectVersion(v.version)}
                >
                  V{v.version}
                </button>
              ))}
            </div>
            <div className={styles.versionMeta}>
              <Badge tone={VERSION_STATUS_TONE[version.status]}>{LABELS.deliverableVersionStatus[version.status]}</Badge>
              <span className={styles.muted}>
                {version.decided_at
                  ? `${version.decided_by_name ?? 'Décision'}, ${formatDateTime(version.decided_at)}`
                  : `Envoyée le ${formatDateTime(version.created_at)}`}
              </span>
              <ActionsMenu
                label={`Noter la décision pour la V${version.version}`}
                items={[
                  { label: 'Noter : validée', onSelect: () => decide(version, 'approved'), disabled: version.status === 'approved' },
                  {
                    label: 'Noter : modifications demandées',
                    onSelect: () => decide(version, 'changes_requested'),
                    disabled: version.status === 'changes_requested',
                  },
                  { label: 'Remettre en attente', onSelect: () => decide(version, 'pending'), disabled: version.status === 'pending' },
                ]}
              />
            </div>
          </div>
          {version.note ? (
            <p className={styles.note}>
              <span className={styles.noteLabel}>Note pour le client :</span> {version.note}
            </p>
          ) : null}
          <VersionViewer key={version.id} version={version} />
        </>
      )}

      <DeliverableFormModal
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ title: deliverable.title, description: deliverable.description }}
        saving={updateDeliverable.isPending}
        onSubmit={save}
      />
      <VersionUploadModal
        open={uploading}
        onClose={() => setUploading(false)}
        nextVersion={nextVersion}
        deliverableTitle={deliverable.title}
        saving={uploadVersion.isPending}
        onSubmit={upload}
      />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Supprimer ce livrable ?"
        actions={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Annuler</Button>
            <Button variant="danger" loading={deleteDeliverable.isPending} onClick={remove}>
              Supprimer
            </Button>
          </>
        }
      >
        <p className={styles.modalText}>
          « {deliverable.title} », ses versions et leurs commentaires seront supprimés, et le client ne le verra plus. Les
          fichiers restent dans Fichiers › Livrables.
        </p>
      </Modal>
    </section>
  )
}

function VersionViewer({ version }: { version: VersionWithFile }) {
  const { project } = useProjectContext()
  const toast = useToast()
  const members = useOrgMembers(project.organization_id)
  const comments = useVersionComments(version.id)
  const live = version.file && version.file.deleted_at === null ? version.file.storage_path : null
  const url = useSignedFileUrl(live)
  const addComment = useAddComment(version.id)
  const setResolved = useSetCommentResolved(version.id)

  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.name])), [members.data])
  const viewerComments: ViewerComment[] = useMemo(
    () =>
      (comments.data ?? []).map((c) => ({
        id: c.id,
        x: c.x === null ? null : Number(c.x),
        y: c.y === null ? null : Number(c.y),
        body: c.body,
        authorName: c.from_client
          ? (c.author_name ?? 'Client')
          : (c.author_member_id ? names.get(c.author_member_id) : null) ?? 'Membre retiré',
        fromClient: c.from_client,
        resolved: c.resolved_at !== null,
        createdAt: c.created_at,
      })),
    [comments.data, names],
  )

  async function add(input: NewCommentInput): Promise<boolean> {
    try {
      await addComment.mutateAsync(input)
      return true
    } catch (error) {
      toast.error(deliverableErrorText(error))
      return false
    }
  }

  if (comments.isError) {
    return <ErrorState message="Impossible de charger les commentaires." onRetry={() => void comments.refetch()} />
  }

  return (
    <DeliverableViewer
      fileName={version.file?.name ?? 'Fichier'}
      mimeType={version.file?.mime_type ?? null}
      url={url.data ?? null}
      urlLoading={Boolean(live) && url.isLoading}
      comments={viewerComments}
      commentsLoading={comments.isLoading}
      onAddComment={add}
      onToggleResolved={(comment) =>
        setResolved.mutate(
          { id: comment.id, resolved: !comment.resolved },
          { onError: (error) => toast.error(deliverableErrorText(error)) },
        )
      }
    />
  )
}
