import { useEffect, useState, type FormEvent } from 'react'
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
  Textarea,
  TextInput,
  useToast,
} from '../../components/ui'
import { formatDate, quoteDisplayStatus, todayIso } from '../../shared/billing'
import { LinesEditor } from '../billing'
import { useCurrentMember } from '../auth/useCurrentMember'
import {
  canTransition,
  DRAFT_DEPOSIT_WARNING,
  fieldsOf,
  finalInvoiceLabel,
  hasUnsavedChanges,
  isQuoteLocked,
  parseDepositPercent,
  QUOTE_DISPLAY_LABELS,
  QUOTE_DISPLAY_TONE,
  quoteErrorText,
  transitionPatch,
  validateQuoteFields,
  type QuoteDraftFields,
  type QuoteWithLinks,
} from './quoteLogic'
import { useCreateInvoiceFromQuote, useDuplicateQuote, useQuote, useQuoteDeposits, useUpdateQuote } from './useQuotes'
import styles from './quotes.module.css'

/** Prévient avant de quitter la page avec des modifications non enregistrées (rechargement, fermeture, liens internes). */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const message = 'Tu as des modifications non enregistrées. Quitter quand même ?'
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    function onClick(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.origin !== window.location.origin) return
      if (anchor.pathname + anchor.search === window.location.pathname + window.location.search) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])
}

export function QuotePage() {
  const { quoteId } = useParams()
  const { data: quote, isLoading, isError, refetch } = useQuote(quoteId)
  if (isLoading) return <LoadingState label="Chargement du devis…" />
  if (isError) return <ErrorState message="Impossible de charger le devis." onRetry={() => void refetch()} />
  if (!quote) {
    return (
      <EmptyState title="Devis introuvable" text="Ce devis n'existe pas ou tu n'y as pas accès." action={<Link to="/quotes">Retour aux devis</Link>} />
    )
  }
  // key : un autre devis (duplication) repart d'un formulaire neuf.
  return <QuoteEditor key={quote.id} quote={quote} />
}

function QuoteEditor({ quote }: { quote: QuoteWithLinks }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const update = useUpdateQuote(quote)
  const duplicate = useDuplicateQuote()
  const createInvoice = useCreateInvoiceFromQuote()
  const deposits = useQuoteDeposits(quote.id, quote.status === 'accepted')
  const deductedCount = deposits.data?.deducted.length ?? 0
  const hasDraftDeposit = (deposits.data?.drafts.length ?? 0) > 0
  const saved = fieldsOf(quote)
  const [draft, setDraft] = useState<QuoteDraftFields>(saved)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [depositOpen, setDepositOpen] = useState(false)
  const [percentText, setPercentText] = useState('30')

  const locked = isQuoteLocked(quote.status)
  const dirty = !locked && hasUnsavedChanges(saved, draft)
  useUnsavedGuard(dirty)
  const shown = quoteDisplayStatus(quote, todayIso())
  const errors = showErrors ? validateQuoteFields(draft, quote.issue_date) : {}
  const busy = update.isPending || duplicate.isPending || createInvoice.isPending

  function set<K extends keyof QuoteDraftFields>(key: K, value: QuoteDraftFields[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  /** Colonnes éditables à écrire, ou null si le formulaire est invalide. */
  function editablePatch() {
    setShowErrors(true)
    const found = validateQuoteFields(draft, quote.issue_date)
    if (found.title || found.lines || found.validUntil) return null
    return {
      title: draft.title.trim(),
      lines: draft.lines,
      notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
      valid_until: draft.validUntil === '' ? null : draft.validUntil,
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(quoteErrorText(e))
    }
  }

  function save() {
    return run(async () => {
      const patch = editablePatch()
      if (!patch) return
      await update.mutateAsync(patch)
      toast.success('Devis enregistré')
    })
  }

  function moveTo(to: 'draft' | 'sent' | 'accepted' | 'refused', message: string) {
    return run(async () => {
      if (!canTransition(quote.status, to)) return
      // Les modifications en cours sont enregistrées avec le changement de statut.
      const patch = dirty || to === 'sent' ? editablePatch() : {}
      if (!patch) return
      await update.mutateAsync({ ...patch, ...transitionPatch(to, new Date().toISOString()) })
      toast.success(message)
    })
  }

  function copy() {
    return run(async () => {
      if (!organization) return
      const created = await duplicate.mutateAsync({ quote, organizationId: organization.id, memberId: member?.id ?? null })
      toast.success('Devis dupliqué')
      void navigate(`/quotes/${created.id}`)
    })
  }

  function invoice(kind: 'invoice' | 'deposit', percent?: number) {
    return run(async () => {
      if (!organization) return
      const created = await createInvoice.mutateAsync({ quote, organizationId: organization.id, memberId: member?.id ?? null, kind, percent })
      toast.success(kind === 'deposit' ? 'Facture d’acompte créée' : deductedCount > 0 ? 'Facture de solde créée' : 'Facture créée')
      void navigate(`/invoices/${created.id}`)
    })
  }

  const percent = parseDepositPercent(percentText)
  function submitDeposit(event: FormEvent) {
    event.preventDefault()
    if (percent === null) return
    void invoice('deposit', percent).then(() => setDepositOpen(false))
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/quotes" label="Devis" />
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <h1>{quote.title}</h1>
            <span className={styles.number}>{quote.number}</span>
            <Badge tone={QUOTE_DISPLAY_TONE[shown]}>{QUOTE_DISPLAY_LABELS[shown]}</Badge>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => void navigate(`/quotes/${quote.id}/print`)}>Aperçu PDF</Button>
            <Button onClick={() => void copy()} loading={duplicate.isPending} disabled={busy}>
              Dupliquer
            </Button>
            {quote.status === 'accepted' ? (
              <>
                <Button onClick={() => setDepositOpen(true)} disabled={busy}>
                  Facture d’acompte
                </Button>
                <Button variant="primary" onClick={() => void invoice('invoice')} loading={createInvoice.isPending} disabled={busy}>
                  {finalInvoiceLabel(deductedCount)}
                </Button>
              </>
            ) : null}
            {quote.status === 'sent' ? (
              <>
                <Button onClick={() => void moveTo('draft', 'Devis repassé en brouillon')} disabled={busy}>
                  Repasser en brouillon
                </Button>
                <Button variant="danger" onClick={() => void moveTo('refused', 'Devis marqué comme refusé')} disabled={busy}>
                  Marquer comme refusé
                </Button>
                <Button variant="primary" onClick={() => void moveTo('accepted', 'Devis marqué comme accepté')} disabled={busy}>
                  Marquer comme accepté
                </Button>
              </>
            ) : null}
            {quote.status === 'draft' ? (
              <>
                <Button onClick={() => void save()} loading={update.isPending} disabled={busy || !dirty}>
                  Enregistrer
                </Button>
                <Button variant="primary" onClick={() => void moveTo('sent', 'Devis marqué comme envoyé')} disabled={busy}>
                  Marquer comme envoyé
                </Button>
              </>
            ) : null}
            {quote.status === 'sent' && dirty ? (
              <Button onClick={() => void save()} loading={update.isPending} disabled={busy}>
                Enregistrer
              </Button>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {quote.status === 'accepted' && hasDraftDeposit ? <p className={styles.notice}>{DRAFT_DEPOSIT_WARNING}</p> : null}
        <dl className={styles.meta}>
          <dt>Client</dt>
          <dd>
            {quote.client ? (
              <Link to={`/clients/${quote.client.id}`} className={styles.link}>
                {quote.client.name}
              </Link>
            ) : (
              'Client inconnu'
            )}
          </dd>
          <dt>Projet</dt>
          <dd>{quote.project?.name ?? 'Aucun projet'}</dd>
          <dt>Date du devis</dt>
          <dd>{formatDate(quote.issue_date)}</dd>
          {quote.sent_at ? (
            <>
              <dt>Envoyé le</dt>
              <dd>{formatDate(quote.sent_at.slice(0, 10))}</dd>
            </>
          ) : null}
          {quote.accepted_at ? (
            <>
              <dt>Accepté le</dt>
              <dd>{formatDate(quote.accepted_at.slice(0, 10))}</dd>
            </>
          ) : null}
          {quote.refused_at ? (
            <>
              <dt>Refusé le</dt>
              <dd>{formatDate(quote.refused_at.slice(0, 10))}</dd>
            </>
          ) : null}
        </dl>
      </header>

      <section className={styles.section} aria-labelledby="quote-infos">
        <h2 id="quote-infos" className={styles.sectionTitle}>
          Informations
        </h2>
        <div className={styles.fields}>
          <Field label="Titre" error={errors.title}>
            <TextInput value={draft.title} onChange={(e) => set('title', e.target.value)} disabled={locked} />
          </Field>
          <Field label="Valable jusqu’au" error={errors.validUntil}>
            <TextInput type="date" value={draft.validUntil} onChange={(e) => set('validUntil', e.target.value)} disabled={locked} />
          </Field>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="quote-lines">
        <h2 id="quote-lines" className={styles.sectionTitle}>
          Lignes
        </h2>
        {organization ? (
          <LinesEditor
            lines={draft.lines}
            onChange={(lines) => set('lines', lines)}
            org={organization}
            readOnly={locked}
            showErrors={showErrors}
          />
        ) : null}
        {errors.lines ? (
          <p className={styles.error} role="alert">
            {errors.lines}
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="quote-notes">
        <h2 id="quote-notes" className={styles.sectionTitle}>
          Notes
        </h2>
        <Field label="Notes affichées sur le devis" hint="Conditions particulières, délais, précisions.">
          <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} disabled={locked} rows={4} />
        </Field>
      </section>

      <Modal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        title="Facture d’acompte"
        dismissible={!createInvoice.isPending}
        actions={
          <>
            <Button onClick={() => setDepositOpen(false)} disabled={createInvoice.isPending}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" form="deposit-form" loading={createInvoice.isPending} disabled={percent === null}>
              Créer la facture
            </Button>
          </>
        }
      >
        <form id="deposit-form" className={styles.form} onSubmit={submitDeposit} noValidate>
          <Field
            label="Pourcentage du devis"
            hint="Entre 1 et 100 %."
            error={percent === null ? 'Saisis un pourcentage entre 1 et 100.' : null}
          >
            <TextInput inputMode="decimal" value={percentText} onChange={(e) => setPercentText(e.target.value)} />
          </Field>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  )
}
