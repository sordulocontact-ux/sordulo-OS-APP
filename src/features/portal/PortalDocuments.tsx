import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, Field, TextInput, useToast } from '../../components/ui'
import { formatDate, formatMoney, formatQuantity, lineHtCents } from '../../shared/billing'
import { LABELS } from '../../shared/types'
import type { PortalContract, PortalInvoice, PortalQuote } from './portalContract'
import { INVOICE_KIND_CLIENT_LABEL, contractClientStatus, invoiceClientStatus, quoteClientStatus } from './portalLogic'
import { markdownBlocks } from './portalMarkdown'
import type { ClientNameState } from './PortalPage'
import { portalErrorText, usePortalAction } from './usePortal'
import styles from './PortalPage.module.css'

/* ---------- Accord : nom tapé + case « Bon pour accord » ---------- */

interface AgreementFormProps {
  nameState: ClientNameState
  checkboxLabel: string
  submitLabel: string
  pending: boolean
  onSubmit: (name: string) => void
}

/** Signature simple : le nom tapé et la case cochée valent accord (en attendant Yousign). */
function AgreementForm({ nameState, checkboxLabel, submitLabel, pending, onSubmit }: AgreementFormProps) {
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = nameState.name.trim()
    if (!name) {
      setError('Tapez votre nom complet.')
      return
    }
    if (!checked) {
      setError('Cochez la case « Bon pour accord ».')
      return
    }
    setError(null)
    onSubmit(name)
  }

  return (
    <form className={styles.agreement} onSubmit={submit}>
      <Field label="Nom et prénom du signataire" error={error}>
        <TextInput value={nameState.name} maxLength={80} autoComplete="name" onChange={(event) => nameState.setName(event.target.value)} />
      </Field>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>
          <strong>Bon pour accord.</strong> {checkboxLabel}
        </span>
      </label>
      <div>
        <Button variant="primary" type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/* ---------- Devis ---------- */

export function PortalQuotes({ token, quotes, nameState }: { token: string; quotes: readonly PortalQuote[]; nameState: ClientNameState }) {
  return (
    <section className={styles.section} aria-labelledby="portal-quotes">
      <h2 id="portal-quotes" className={styles.sectionTitle}>
        Devis
      </h2>
      {quotes.map((quote) => (
        <QuoteCard key={quote.id} token={token} quote={quote} nameState={nameState} />
      ))}
    </section>
  )
}

function QuoteCard({ token, quote, nameState }: { token: string; quote: PortalQuote; nameState: ClientNameState }) {
  const toast = useToast()
  const action = usePortalAction(token)
  const status = quoteClientStatus(quote)
  const canAccept = quote.status === 'sent' && !quote.expired

  function accept(authorName: string) {
    action.mutate(
      { action: 'accept_quote', quoteId: quote.id, authorName, accepted: true },
      {
        onSuccess: () => toast.success(`Devis ${quote.number} accepté, merci !`),
        onError: (error) => toast.error(portalErrorText(error)),
      },
    )
  }

  return (
    <Card className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          Devis {quote.number} · {quote.title}
        </h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className={styles.text}>
        Émis le {formatDate(quote.issueDate)}
        {quote.validUntil ? ` · valable jusqu’au ${formatDate(quote.validUntil)}` : ''}
        {quote.acceptedAt ? ` · accepté le ${formatDate(quote.acceptedAt.slice(0, 10))}` : ''}
      </p>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Prestation</th>
              <th scope="col" className={styles.num}>
                Quantité
              </th>
              <th scope="col" className={styles.num}>
                Prix unitaire HT
              </th>
              <th scope="col" className={styles.num}>
                Total HT
              </th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <span className={styles.lineLabel}>{line.label}</span>
                  {line.description ? <span className={styles.lineDescription}>{line.description}</span> : null}
                </td>
                <td className={styles.num}>
                  {formatQuantity(line.quantity)} {LABELS.lineUnit[line.unit]}
                </td>
                <td className={styles.num}>{formatMoney(line.unitPriceCents)}</td>
                <td className={styles.num}>{formatMoney(lineHtCents({ quantity: line.quantity, unit_price_cents: line.unitPriceCents }))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.totals}>
        <div>
          <dt>Total HT</dt>
          <dd>{formatMoney(quote.totalHtCents)}</dd>
        </div>
        <div>
          <dt>TVA</dt>
          <dd>{formatMoney(quote.totalVatCents)}</dd>
        </div>
        <div className={styles.totalStrong}>
          <dt>Total TTC</dt>
          <dd>{formatMoney(quote.totalTtcCents)}</dd>
        </div>
      </dl>
      {quote.notes ? <p className={styles.note}>{quote.notes}</p> : null}

      {canAccept ? (
        <AgreementForm
          nameState={nameState}
          checkboxLabel={`J’accepte le devis ${quote.number} d’un montant de ${formatMoney(quote.totalTtcCents)} TTC.`}
          submitLabel="Accepter le devis"
          pending={action.isPending}
          onSubmit={accept}
        />
      ) : quote.expired ? (
        <p className={styles.text}>Ce devis a expiré : demandez à l’agence une version à jour.</p>
      ) : null}
    </Card>
  )
}

/* ---------- Contrats ---------- */

export function PortalContracts({
  token,
  contracts,
  nameState,
}: {
  token: string
  contracts: readonly PortalContract[]
  nameState: ClientNameState
}) {
  return (
    <section className={styles.section} aria-labelledby="portal-contracts">
      <h2 id="portal-contracts" className={styles.sectionTitle}>
        Contrats
      </h2>
      {contracts.map((contract) => (
        <ContractCard key={contract.id} token={token} contract={contract} nameState={nameState} />
      ))}
    </section>
  )
}

function ContractBody({ body }: { body: string }) {
  const blocks = markdownBlocks(body)
  if (blocks.length === 0) return <p className={styles.text}>Contrat sans texte.</p>
  return (
    <div className={styles.contractBody}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return block.level === 1 ? (
            <h4 key={index} className={styles.contractH1}>
              {block.text}
            </h4>
          ) : (
            <h5 key={index} className={styles.contractH2}>
              {block.text}
            </h5>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={index}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )
        }
        return <p key={index}>{block.text}</p>
      })}
    </div>
  )
}

function ContractCard({ token, contract, nameState }: { token: string; contract: PortalContract; nameState: ClientNameState }) {
  const toast = useToast()
  const action = usePortalAction(token)
  const status = contractClientStatus(contract)

  function sign(signerName: string) {
    action.mutate(
      { action: 'sign_contract', contractId: contract.id, signerName, accepted: true },
      {
        onSuccess: () => toast.success('Contrat signé, merci !'),
        onError: (error) => toast.error(portalErrorText(error)),
      },
    )
  }

  return (
    <Card className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{contract.title}</h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {contract.status === 'signed' ? (
        <p className={styles.text}>
          Signé{contract.signedByName ? ` par ${contract.signedByName}` : ''}
          {contract.signedAt ? ` le ${formatDate(contract.signedAt.slice(0, 10))}` : ''}.
        </p>
      ) : null}
      <details className={styles.details} open={contract.status === 'sent'}>
        <summary>Lire le contrat</summary>
        <ContractBody body={contract.body} />
      </details>
      {contract.status === 'sent' ? (
        <AgreementForm
          nameState={nameState}
          checkboxLabel="J’ai lu le contrat et j’en accepte les termes."
          submitLabel="Signer le contrat"
          pending={action.isPending}
          onSubmit={sign}
        />
      ) : null}
    </Card>
  )
}

/* ---------- Factures ---------- */

export function PortalInvoices({ invoices }: { invoices: readonly PortalInvoice[] }) {
  return (
    <section className={styles.section} aria-labelledby="portal-invoices">
      <h2 id="portal-invoices" className={styles.sectionTitle}>
        Factures
      </h2>
      <p className={styles.sectionHint}>Paiement par virement, IBAN sur la facture.</p>
      <Card className={styles.card}>
        <ul className={styles.invoiceList}>
          {invoices.map((invoice) => {
            const status = invoiceClientStatus(invoice)
            return (
              <li key={invoice.id} className={styles.invoice}>
                <div className={styles.invoiceMain}>
                  <span className={styles.lineLabel}>
                    {INVOICE_KIND_CLIENT_LABEL[invoice.kind]} {invoice.number ?? ''}
                  </span>
                  <span className={styles.lineDescription}>
                    {invoice.title}
                    {invoice.status === 'paid' && invoice.paidAt
                      ? ` · payée le ${formatDate(invoice.paidAt.slice(0, 10))}`
                      : invoice.dueDate
                        ? ` · échéance le ${formatDate(invoice.dueDate)}`
                        : ''}
                  </span>
                </div>
                <span className={styles.invoiceAmount}>{formatMoney(invoice.totalTtcCents)}</span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
