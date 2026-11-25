import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BackLink, Badge, Button, EmptyState, ErrorState, Field, LoadingState, Textarea, TextInput, useToast } from '../../components/ui'
import { formatDate } from '../../shared/billing'
import { LABELS } from '../../shared/types'
import {
  canDeleteContract,
  canTransition,
  contractErrorText,
  CONTRACT_TONE,
  isContractLocked,
  isPdf,
  signedAtFromDate,
  type ContractWithLinks,
} from './contractLogic'
import { DeleteContractModal } from './DeleteContractModal'
import { MarkdownView } from './MarkdownView'
import { SignContractModal } from './SignContractModal'
import { useAttachSignedPdf, useContract, useContractFileUrl, useUpdateContract } from './useContracts'
import styles from './contracts.module.css'

const SIGNED_VIA_LABEL = { manual: 'saisie à la main', portal: 'sur le portail client', yousign: 'par Yousign' } as const

export function ContractPage() {
  const { contractId } = useParams()
  const { data: contract, isLoading, isError, refetch } = useContract(contractId)
  if (isLoading) return <LoadingState label="Chargement du contrat…" />
  if (isError) return <ErrorState message="Impossible de charger le contrat." onRetry={() => void refetch()} />
  if (!contract) {
    return <EmptyState title="Contrat introuvable" text="Ce contrat n'existe pas ou tu n'y as pas accès." action={<Link to="/contracts">Retour aux contrats</Link>} />
  }
  return <ContractEditor key={contract.id} contract={contract} />
}

function ContractEditor({ contract }: { contract: ContractWithLinks }) {
  const navigate = useNavigate()
  const toast = useToast()
  const update = useUpdateContract(contract.id)
  const attach = useAttachSignedPdf(contract)
  const file = useContractFileUrl(contract.file_id)
  const [title, setTitle] = useState(contract.title)
  const [body, setBody] = useState(contract.body)
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const locked = isContractLocked(contract.status)
  const dirty = !locked && (title !== contract.title || body !== contract.body)
  const busy = update.isPending || attach.isPending
  const titleError = title.trim() === '' ? 'Le titre est obligatoire.' : null

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(contractErrorText(e))
    }
  }

  const edits = () => ({ title: title.trim(), body })

  function save() {
    return run(async () => {
      if (titleError) return
      await update.mutateAsync(edits())
      toast.success('Contrat enregistré')
    })
  }

  function send() {
    return run(async () => {
      if (titleError || !canTransition(contract.status, 'send')) return
      await update.mutateAsync({ ...edits(), status: 'sent' })
      toast.success('Contrat marqué comme envoyé')
    })
  }

  function sign(name: string, date: string) {
    return run(async () => {
      await update.mutateAsync({ ...(locked ? {} : edits()), status: 'signed', signed_by_name: name, signed_at: signedAtFromDate(date), signed_via: 'manual' })
      setSigning(false)
      toast.success('Contrat marqué comme signé')
    })
  }

  function cancel() {
    return run(async () => {
      if (!window.confirm('Annuler ce contrat ? Il ne pourra plus être signé.')) return
      await update.mutateAsync({ status: 'cancelled' })
      toast.success('Contrat annulé')
    })
  }

  function reopen() {
    return run(async () => {
      await update.mutateAsync({ status: 'draft' })
      toast.success('Contrat repassé en brouillon')
    })
  }

  function onFile(picked: File | undefined) {
    if (!picked) return
    void run(async () => {
      if (!isPdf(picked)) throw new Error('Choisis un fichier PDF.')
      await attach.mutateAsync(picked)
      toast.success('PDF signé joint')
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to={contract.project ? `/projects/${contract.project.id}/contracts` : '/contracts'} label="Contrats" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{contract.title}</h1>
            <Badge tone={CONTRACT_TONE[contract.status]}>{LABELS.contractStatus[contract.status]}</Badge>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => void navigate(`/contracts/${contract.id}/print`)}>Aperçu PDF</Button>
            {canTransition(contract.status, 'send') ? (
              <Button onClick={() => void send()} disabled={busy}>
                Marquer envoyé
              </Button>
            ) : null}
            {canTransition(contract.status, 'reopen') ? (
              <Button onClick={() => void reopen()} disabled={busy}>
                Repasser en brouillon
              </Button>
            ) : null}
            {canTransition(contract.status, 'sign') ? (
              <Button variant="primary" onClick={() => setSigning(true)} disabled={busy}>
                Marquer signé
              </Button>
            ) : null}
            {canTransition(contract.status, 'cancel') ? (
              <Button onClick={() => void cancel()} disabled={busy}>
                Annuler le contrat
              </Button>
            ) : null}
            {canDeleteContract(contract.status) ? (
              <Button variant="danger" onClick={() => setDeleting(true)} disabled={busy}>
                Supprimer
              </Button>
            ) : null}
          </div>
        </div>
        <dl className={styles.meta}>
          <dt>Client</dt>
          <dd>{contract.client ? <Link className={styles.link} to={`/clients/${contract.client.id}`}>{contract.client.name}</Link> : 'Client inconnu'}</dd>
          <dt>Projet</dt>
          <dd>{contract.project ? <Link className={styles.link} to={`/projects/${contract.project.id}`}>{contract.project.name}</Link> : 'Sans projet'}</dd>
          {contract.quote_id ? (
            <>
              <dt>Devis</dt>
              <dd>
                <Link className={styles.link} to={`/quotes/${contract.quote_id}`}>
                  Voir le devis
                </Link>
              </dd>
            </>
          ) : null}
          {contract.sent_at ? (
            <>
              <dt>Envoyé le</dt>
              <dd>{formatDate(contract.sent_at.slice(0, 10))}</dd>
            </>
          ) : null}
          {contract.signed_at ? (
            <>
              <dt>Signé</dt>
              <dd>
                le {formatDate(contract.signed_at.slice(0, 10))}
                {contract.signed_by_name ? ` par ${contract.signed_by_name}` : ''}
                {contract.signed_via ? ` (${SIGNED_VIA_LABEL[contract.signed_via]})` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {locked ? (
        <p className={styles.notice}>
          {contract.status === 'signed' ? 'Ce contrat est signé : il ne se modifie plus. Tu peux l’annuler pour en refaire un.' : 'Ce contrat est annulé.'}
        </p>
      ) : null}

      <div className={styles.editor}>
        {locked ? null : (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            noValidate
          >
            <Field label="Titre" error={titleError}>
              <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className={styles.bodyField}>
              <Field label="Texte du contrat" hint="Markdown simple : # titre, ## article, - liste, **gras**.">
                <Textarea value={body} rows={24} maxLength={200000} onChange={(e) => setBody(e.target.value)} />
              </Field>
            </div>
            <div>
              <Button variant="primary" type="submit" loading={update.isPending} disabled={!dirty || busy}>
                Enregistrer
              </Button>
            </div>
          </form>
        )}
        <section className={styles.section} aria-label="Aperçu du contrat">
          <h2 className={styles.sectionTitle}>Aperçu</h2>
          <div className={styles.preview}>
            <MarkdownView source={locked ? contract.body : body} />
          </div>
        </section>
      </div>

      <section className={styles.section} aria-labelledby="signed-pdf">
        <h2 id="signed-pdf" className={styles.sectionTitle}>
          PDF signé
        </h2>
        {contract.file_id ? (
          file.isLoading ? (
            <p className={styles.hint}>Chargement du fichier…</p>
          ) : file.data ? (
            <p>
              <a className={styles.link} href={file.data.url} target="_blank" rel="noreferrer">
                {file.data.name}
              </a>
            </p>
          ) : (
            <p className={styles.hint}>Le fichier joint est introuvable (corbeille ou supprimé).</p>
          )
        ) : (
          <p className={styles.hint}>Aucun PDF joint.</p>
        )}
        {contract.project_id ? (
          <div>
            <label className={styles.hint} htmlFor="signed-pdf-input">
              {contract.file_id ? 'Remplacer le PDF signé' : 'Joindre le PDF signé'} (rangé dans le dossier Contrats du projet)
            </label>
            <input
              id="signed-pdf-input"
              ref={fileRef}
              className={styles.fileInput}
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy || contract.status === 'cancelled'}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {attach.isPending ? <p className={styles.hint}>Envoi en cours…</p> : null}
          </div>
        ) : (
          <p className={styles.hint}>Rattache le contrat à un projet pour y joindre le PDF signé.</p>
        )}
      </section>

      <SignContractModal open={signing} onClose={() => setSigning(false)} busy={update.isPending} onSign={(name, date) => void sign(name, date)} />
      <DeleteContractModal contract={deleting ? contract : null} onClose={() => setDeleting(false)} onDeleted={() => void navigate('/contracts')} />
    </div>
  )
}
