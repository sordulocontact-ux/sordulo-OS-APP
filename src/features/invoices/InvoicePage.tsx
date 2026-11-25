import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  BackLink,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  Select,
  Textarea,
  TextInput,
  useToast,
} from '../../components/ui'
import {
  daysLate,
  formatDate,
  formatMoney,
  hasLineErrors,
  invoiceAllowsNegativeLines,
  todayIso,
  validateInvoiceLines,
} from '../../shared/billing'
import { LABELS, type Client, type DocumentLine, type Invoice, type Organization } from '../../shared/types'
import { ADMIN_ROLES, PROJECT_ROLES, useHasRole } from '../auth/roles'
import { useCurrentMember } from '../auth/useCurrentMember'
import { LinesEditor } from '../billing'
import { useClient } from '../clients/useClients'
import { issuerChoices, issuerName, showIssuerSelect } from '../settings/issuerLogic'
import { useIssuers } from '../settings/useIssuers'
import {
  DISPLAY_STATUS_TONE,
  invoiceDisplayStatus,
  invoiceErrorText,
  invoiceNumberLabel,
  issueCheck,
  paidAtFor,
  paidDateError,
  parisDay,
  statusBadgeLabel,
} from './invoiceLogic'
import {
  useCreateCreditNote,
  useCreditNoteOf,
  useDeleteInvoice,
  useInvoice,
  useIssueInvoice,
  useProjectOptions,
  useSaveInvoiceDraft,
  useSetInvoicePaid,
} from './useInvoices'
import styles from './invoices.module.css'

export function InvoicePage() {
  const { invoiceId } = useParams()
  const { organization } = useCurrentMember()
  const invoiceQuery = useInvoice(invoiceId)
  const invoice = invoiceQuery.data
  const clientQuery = useClient(invoice?.client_id)

  if (invoiceQuery.isLoading) return <LoadingState label="Chargement de la facture…" />
  if (invoiceQuery.isError) {
    return <ErrorState message="Impossible de charger la facture." onRetry={() => void invoiceQuery.refetch()} />
  }
  if (!invoice) {
    return (
      <EmptyState
        title="Facture introuvable"
        text="Cette facture n'existe pas ou tu n'y as pas accès."
        action={<Link to="/invoices">Retour aux factures</Link>}
      />
    )
  }
  if (clientQuery.isLoading) return <LoadingState label="Chargement de la facture…" />
  if (clientQuery.isError) {
    return <ErrorState message="Impossible de charger le client de la facture." onRetry={() => void clientQuery.refetch()} />
  }
  // `key` : le brouillon local repart de zéro quand on change de facture.
  return <InvoiceView key={invoice.id} invoice={invoice} client={clientQuery.data ?? null} organization={organization} />
}

interface InvoiceViewProps {
  invoice: Invoice
  client: Client | null
  organization: Organization | null
}

function InvoiceView({ invoice, client, organization }: InvoiceViewProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const isAdmin = useHasRole(ADMIN_ROLES)
  const canOpenProject = useHasRole(PROJECT_ROLES)
  const projects = useProjectOptions()
  const credited = useInvoice(invoice.credited_invoice_id)
  const creditNote = useCreditNoteOf(invoice.id, invoice.status === 'cancelled')

  const save = useSaveInvoiceDraft(invoice)
  const remove = useDeleteInvoice()
  const issue = useIssueInvoice()
  const setPaid = useSetInvoicePaid()
  const createCreditNote = useCreateCreditNote()

  const isDraft = invoice.status === 'draft'
  const [title, setTitle] = useState(invoice.title)
  const [lines, setLines] = useState<DocumentLine[]>(invoice.lines)
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [issuerId, setIssuerId] = useState(invoice.issuer_id ?? '')
  const issuers = useIssuers(organization?.id)
  const issuerList = issuers.data ?? []
  const issuerOptions = issuerChoices(issuerList, invoice.issuer_id)
  const issuerChanged = issuerId !== (invoice.issuer_id ?? '')
  const issuer = issuerList.find((i) => i.id === issuerId)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'issue' | 'delete' | 'credit' | 'paid' | null>(null)
  /** Date d'encaissement saisie dans la fenêtre « Marquer comme payée » / « Modifier la date ». */
  const [paidDay, setPaidDay] = useState('')
  const [paidDayAttempted, setPaidDayAttempted] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const today = todayIso()
  const status = invoiceDisplayStatus(invoice, today)
  const isCredit = invoice.kind === 'credit_note'
  const project = projects.data?.find((p) => p.id === invoice.project_id)
  // Prix négatifs : avoir, et facture (déduction des acomptes d'une facture de solde) si le total reste positif ou nul.
  const allowNegative = invoiceAllowsNegativeLines(invoice.kind)
  const { lineErrors, totalError } = validateInvoiceLines(invoice.kind, lines)
  const check = issueCheck({ lines, lineErrors, totalError, client, organization: issuer ?? organization })
  const titleError = title.trim() === '' ? 'Indique un titre.' : null
  const dirty =
    title !== invoice.title ||
    notes !== (invoice.notes ?? '') ||
    issuerChanged ||
    JSON.stringify(lines) !== JSON.stringify(invoice.lines)

  const fields = () => ({
    title: title.trim(),
    lines,
    notes: notes.trim() === '' ? null : notes.trim(),
    ...(issuerChanged && issuerId !== '' ? { issuer_id: issuerId } : {}),
  })

  async function saveDraft(): Promise<boolean> {
    setAttempted(true)
    setError(null)
    if (titleError || hasLineErrors(lineErrors) || totalError) return false
    try {
      await save.mutateAsync(fields())
      return true
    } catch (e) {
      setError(invoiceErrorText(e))
      return false
    }
  }

  async function onSave() {
    if (await saveDraft()) toast.success('Brouillon enregistré')
  }

  function askIssue() {
    setAttempted(true)
    setError(null)
    if (titleError || check.blockers.length > 0) return
    setModalError(null)
    setConfirm('issue')
  }

  async function confirmIssue() {
    setModalError(null)
    try {
      if (dirty) await save.mutateAsync(fields())
      const issued = await issue.mutateAsync(invoice)
      toast.success(`Facture ${issued.number ?? ''} émise`.replace('  ', ' '))
      setConfirm(null)
    } catch (e) {
      setModalError(invoiceErrorText(e))
    }
  }

  async function confirmDelete() {
    setModalError(null)
    try {
      await remove.mutateAsync(invoice)
      toast.success('Brouillon supprimé')
      void navigate('/invoices', { replace: true })
    } catch (e) {
      setModalError(invoiceErrorText(e))
    }
  }

  async function confirmCredit() {
    setModalError(null)
    try {
      const note = await createCreditNote.mutateAsync(invoice)
      toast.success('Avoir créé')
      setConfirm(null)
      void navigate(`/invoices/${note.id}`)
    } catch (e) {
      setModalError(invoiceErrorText(e))
    }
  }

  async function cancelPayment() {
    setError(null)
    try {
      await setPaid.mutateAsync({ invoice, paid: false })
      toast.success('Paiement annulé')
    } catch (e) {
      setError(invoiceErrorText(e))
    }
  }

  /** Fenêtre de la date d'encaissement : aujourd'hui par défaut, ou la date déjà notée. */
  function askPaidDate() {
    setModalError(null)
    setPaidDayAttempted(false)
    setPaidDay(invoice.paid_at ? parisDay(invoice.paid_at) : today)
    setConfirm('paid')
  }

  const wasPaid = invoice.status === 'paid'
  const paidDayError = paidDateError(paidDay, invoice.issue_date, today)

  async function confirmPaid() {
    setPaidDayAttempted(true)
    if (paidDayError) return
    setModalError(null)
    // Même jour que celui déjà noté : rien à changer.
    if (wasPaid && invoice.paid_at && parisDay(invoice.paid_at) === paidDay) {
      setConfirm(null)
      return
    }
    try {
      await setPaid.mutateAsync({ invoice, paid: true, paidAt: paidAtFor(paidDay, today) })
      toast.success(wasPaid ? 'Date d’encaissement modifiée' : 'Facture marquée comme payée')
      setConfirm(null)
    } catch (e) {
      setModalError(invoiceErrorText(e))
    }
  }

  const canTogglePaid = !isCredit && (invoice.status === 'issued' || invoice.status === 'paid')
  const canCredit = !isCredit && (invoice.status === 'issued' || invoice.status === 'paid')
  const closeConfirm = () => setConfirm(null)
  const modalBusy = issue.isPending || save.isPending || remove.isPending || createCreditNote.isPending

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/invoices" label="Factures" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{invoiceNumberLabel(invoice)}</h1>
            <Badge>{LABELS.invoiceKind[invoice.kind]}</Badge>
            <Badge tone={DISPLAY_STATUS_TONE[status]}>{statusBadgeLabel(invoice, today)}</Badge>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => void navigate(`/invoices/${invoice.id}/print`)}>Aperçu PDF</Button>
            {isDraft ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => {
                    setModalError(null)
                    setConfirm('delete')
                  }}
                >
                  Supprimer le brouillon
                </Button>
                <Button onClick={() => void onSave()} loading={save.isPending && confirm === null}>
                  Enregistrer
                </Button>
                <Button variant="primary" onClick={askIssue}>
                  Émettre la facture
                </Button>
              </>
            ) : (
              <>
                {canTogglePaid ? (
                  <Button
                    variant={wasPaid ? 'secondary' : 'primary'}
                    onClick={() => (wasPaid ? void cancelPayment() : askPaidDate())}
                    loading={setPaid.isPending && confirm === null}
                  >
                    {wasPaid ? 'Annuler le paiement' : 'Marquer comme payée'}
                  </Button>
                ) : null}
                {canCredit ? (
                  <Button
                    onClick={() => {
                      setModalError(null)
                      setConfirm('credit')
                    }}
                  >
                    Créer un avoir
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </header>

      <section className={styles.section} aria-labelledby="invoice-infos">
        <h2 id="invoice-infos" className={styles.sectionTitle}>
          Infos
        </h2>
        <dl className={styles.infos}>
          <dt>Titre</dt>
          <dd>{invoice.title}</dd>
          {!isDraft && (invoice.seller?.name ?? issuerName(issuerList, invoice.issuer_id)) ? (
            <>
              <dt>Émetteur</dt>
              <dd>{invoice.seller?.name ?? issuerName(issuerList, invoice.issuer_id)}</dd>
            </>
          ) : null}
          <dt>Client</dt>
          <dd>
            {client ? (
              <Link to={`/clients/${client.id}`} className={styles.link}>
                {client.name}
              </Link>
            ) : (
              'Client inconnu'
            )}
          </dd>
          {invoice.project_id ? (
            <>
              <dt>Projet</dt>
              <dd>
                {project ? (
                  canOpenProject ? (
                    <Link to={`/projects/${project.id}/tickets`} className={styles.link}>
                      {project.name}
                    </Link>
                  ) : (
                    project.name
                  )
                ) : (
                  'Projet non accessible'
                )}
              </dd>
            </>
          ) : null}
          {invoice.quote_id ? (
            <>
              <dt>Devis d’origine</dt>
              <dd>
                <Link to={`/quotes/${invoice.quote_id}`} className={styles.link}>
                  Voir le devis
                </Link>
              </dd>
            </>
          ) : null}
          {invoice.credited_invoice_id ? (
            <>
              <dt>Facture annulée</dt>
              <dd>
                <Link to={`/invoices/${invoice.credited_invoice_id}`} className={styles.link}>
                  {credited.data ? invoiceNumberLabel(credited.data) : 'Voir la facture'}
                </Link>
              </dd>
            </>
          ) : null}
          {invoice.status === 'cancelled' && creditNote.data ? (
            <>
              <dt>Avoir</dt>
              <dd>
                <Link to={`/invoices/${creditNote.data.id}`} className={styles.link}>
                  {invoiceNumberLabel(creditNote.data)}
                </Link>
              </dd>
            </>
          ) : null}
          {invoice.issue_date ? (
            <>
              <dt>Émise le</dt>
              <dd>{formatDate(invoice.issue_date)}</dd>
            </>
          ) : null}
          {invoice.due_date && !isCredit ? (
            <>
              <dt>Échéance</dt>
              <dd>
                {formatDate(invoice.due_date)}
                {status === 'overdue' ? ` (en retard de ${daysLate(invoice, today)} j)` : ''}
              </dd>
            </>
          ) : null}
          {invoice.paid_at ? (
            <>
              <dt>Payée le</dt>
              <dd className={styles.paidDate}>
                {formatDate(parisDay(invoice.paid_at))}
                {canTogglePaid && wasPaid ? (
                  <Button size="sm" variant="ghost" onClick={askPaidDate} aria-label="Modifier la date d’encaissement">
                    Modifier
                  </Button>
                ) : null}
              </dd>
            </>
          ) : null}
          <dt>Total TTC</dt>
          <dd>{formatMoney(invoice.total_ttc_cents)}</dd>
        </dl>
      </section>

      {isDraft ? (
        <>
          {attempted && check.blockers.length > 0 ? (
            <div className={[styles.notice, styles.noticeDanger].join(' ')} role="alert">
              <p>L’émission est impossible pour le moment :</p>
              <ul>
                {check.blockers.map((b) => (
                  <li key={b.code}>
                    {b.message}
                    {b.code === 'address' && client ? (
                      <>
                        {' '}
                        <Link to={`/clients/${client.id}`} className={styles.link}>
                          Compléter la fiche du client
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {check.warnings.length > 0 ? (
            <div className={[styles.notice, styles.noticeWarning].join(' ')}>
              {check.warnings.map((w) => (
                <p key={w.code}>
                  {w.message}
                  {isAdmin ? (
                    <>
                      {' '}
                      <Link to="/settings" className={styles.link}>
                        Compléter les paramètres
                      </Link>
                    </>
                  ) : (
                    ' Demande à un admin de compléter les paramètres.'
                  )}
                </p>
              ))}
            </div>
          ) : null}
          <section className={styles.section} aria-labelledby="invoice-lines">
            <h2 id="invoice-lines" className={styles.sectionTitle}>
              Lignes
            </h2>
            <Field label="Titre" error={attempted ? titleError : null}>
              <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {showIssuerSelect(issuerOptions) ? (
              <Field label="Émetteur" hint="Fixé à l’émission : chaque émetteur a sa propre numérotation de factures.">
                <Select value={issuerId} onChange={(e) => setIssuerId(e.target.value)}>
                  {issuerId === '' ? <option value="">Émetteur par défaut</option> : null}
                  {issuerOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.display_name}
                      {i.archived_at ? ' (archivé)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {organization ? (
              <LinesEditor lines={lines} onChange={setLines} org={organization} showErrors={attempted} allowNegative={allowNegative} />
            ) : null}
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>
          </section>
        </>
      ) : (
        <section className={styles.section} aria-labelledby="invoice-lines">
          <h2 id="invoice-lines" className={styles.sectionTitle}>
            Lignes
          </h2>
          {organization ? (
            <LinesEditor lines={invoice.lines} onChange={() => undefined} org={organization} readOnly allowNegative={allowNegative} />
          ) : null}
          {invoice.notes ? <p className={styles.multiline}>{invoice.notes}</p> : null}
        </section>
      )}

      <Modal
        open={confirm === 'issue'}
        onClose={closeConfirm}
        title="Émettre la facture ?"
        dismissible={!modalBusy}
        actions={
          <>
            <Button onClick={closeConfirm} disabled={modalBusy}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void confirmIssue()} loading={modalBusy}>
              Émettre la facture
            </Button>
          </>
        }
      >
        <p>
          La facture recevra un numéro définitif et ne sera plus modifiable. Pour la corriger ensuite, il faudra créer un avoir.
        </p>
        {modalError ? (
          <p className={styles.error} role="alert">
            {modalError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirm === 'paid'}
        onClose={closeConfirm}
        title={wasPaid ? 'Modifier la date d’encaissement' : 'Marquer comme payée'}
        dismissible={!setPaid.isPending}
        actions={
          <>
            <Button onClick={closeConfirm} disabled={setPaid.isPending}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void confirmPaid()} loading={setPaid.isPending}>
              {wasPaid ? 'Enregistrer la date' : 'Marquer comme payée'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void confirmPaid()
          }}
        >
          <Field
            label="Date d’encaissement"
            hint="Le jour où l’argent est arrivé sur le compte : elle compte pour le CA encaissé et les seuils."
            error={paidDayAttempted ? (paidDayError ?? undefined) : undefined}
          >
            <TextInput
              type="date"
              value={paidDay}
              min={invoice.issue_date ?? undefined}
              max={today}
              onChange={(e) => setPaidDay(e.target.value)}
              disabled={setPaid.isPending}
            />
          </Field>
        </form>
        {modalError ? (
          <p className={styles.error} role="alert">
            {modalError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirm === 'delete'}
        onClose={closeConfirm}
        title="Supprimer ce brouillon ?"
        dismissible={!modalBusy}
        actions={
          <>
            <Button onClick={closeConfirm} disabled={modalBusy}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={modalBusy}>
              Supprimer le brouillon
            </Button>
          </>
        }
      >
        <p>Le brouillon sera supprimé définitivement.</p>
        {modalError ? (
          <p className={styles.error} role="alert">
            {modalError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirm === 'credit'}
        onClose={closeConfirm}
        title="Créer un avoir ?"
        dismissible={!modalBusy}
        actions={
          <>
            <Button onClick={closeConfirm} disabled={modalBusy}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void confirmCredit()} loading={modalBusy}>
              Créer l’avoir
            </Button>
          </>
        }
      >
        <p>
          L’avoir annule toute la facture {invoiceNumberLabel(invoice)} : elle passera en « Annulée » et ne pourra plus changer.
        </p>
        {modalError ? (
          <p className={styles.error} role="alert">
            {modalError}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
