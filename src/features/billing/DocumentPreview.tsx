import {
  computeTotals,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  legalMentions,
  lineHtCents,
} from '../../shared/billing'
import { LABELS, type DocumentLine, type DocumentTotals, type InvoiceBuyer, type InvoiceKind, type InvoiceSeller } from '../../shared/types'
import styles from './DocumentPreview.module.css'

export interface DocumentPreviewProps {
  kind: 'quote' | InvoiceKind
  /** null : brouillon sans numéro (« Brouillon » affiché). */
  number: string | null
  issueDate: string | null
  /** Facture : échéance. */
  dueDate?: string | null
  /** Devis : date de validité. */
  validUntil?: string | null
  seller: InvoiceSeller
  buyer: InvoiceBuyer
  /** Objet du document, affiché sous l'en-tête. */
  title?: string
  lines: DocumentLine[]
  notes: string | null
  /** Totaux enregistrés par la base ; à défaut, calculés depuis les lignes. */
  totals?: DocumentTotals
}

const KIND_TITLE: Record<DocumentPreviewProps['kind'], string> = {
  quote: 'Devis',
  invoice: 'Facture',
  deposit: 'Facture d’acompte',
  credit_note: 'Avoir',
}

function addressLines(p: {
  street: string | null
  postal: string | null
  city: string | null
  country: string | null
}): string[] {
  const cityLine = [p.postal, p.city].filter(Boolean).join(' ')
  return [p.street, cityLine, p.country].filter((l): l is string => Boolean(l && l.trim()))
}

/** Aperçu A4 d'un devis ou d'une facture. Imprimé (`window.print()`), la page ne contient que ce document. */
export function DocumentPreview({
  kind,
  number,
  issueDate,
  dueDate,
  validUntil,
  seller,
  buyer,
  title,
  lines,
  notes,
  totals,
}: DocumentPreviewProps) {
  const computed = computeTotals(lines)
  const shown = totals ?? computed
  const mentions = legalMentions({ kind, seller, dueDate, issueDate, validUntil, vatTotal: shown.total_vat_cents })
  const sellerName = seller.legal_name ?? seller.name
  const sellerAddress = addressLines({
    street: seller.address_street,
    postal: seller.address_postal_code,
    city: seller.address_city,
    country: seller.address_country,
  })
  const buyerAddress = addressLines({
    street: buyer.billing_street,
    postal: buyer.billing_postal_code,
    city: buyer.billing_city,
    country: buyer.billing_country,
  })

  return (
    <div className={styles.wrapper}>
      <article className={styles.page} aria-label={`${KIND_TITLE[kind]} ${number ?? 'brouillon'}`}>
        <header className={styles.header}>
          <div className={styles.party}>
            <p className={styles.partyName}>
              {sellerName}
              {seller.legal_form ? ` ${seller.legal_form}` : ''}
            </p>
            {sellerAddress.map((l) => (
              <p key={l}>{l}</p>
            ))}
            {seller.siret ? <p>SIRET : {seller.siret}</p> : null}
          </div>
          <div className={styles.meta}>
            <h2 className={styles.kind}>{KIND_TITLE[kind]}</h2>
            <p className={styles.number}>{number ?? 'Brouillon'}</p>
            {issueDate ? <p>Date : {formatDate(issueDate)}</p> : null}
            {kind === 'quote' && validUntil ? <p>Valable jusqu’au : {formatDate(validUntil)}</p> : null}
            {kind !== 'quote' && dueDate ? <p>Échéance : {formatDate(dueDate)}</p> : null}
          </div>
        </header>

        <section className={styles.buyer} aria-label="Client">
          <p className={styles.sectionLabel}>{kind === 'quote' ? 'Destinataire' : 'Facturé à'}</p>
          <p className={styles.partyName}>{buyer.name}</p>
          {buyerAddress.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {buyer.siret ? <p>SIRET : {buyer.siret}</p> : null}
          {buyer.contact_name ? <p>À l’attention de {buyer.contact_name}</p> : null}
        </section>

        {title ? <p className={styles.subject}>Objet : {title}</p> : null}

        <table className={styles.lines}>
          <thead>
            <tr>
              <th scope="col">Désignation</th>
              <th scope="col" className={styles.num}>
                Qté
              </th>
              <th scope="col">Unité</th>
              <th scope="col" className={styles.num}>
                PU HT
              </th>
              <th scope="col" className={styles.num}>
                TVA
              </th>
              <th scope="col" className={styles.num}>
                Total HT
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td>
                  <span className={styles.lineLabel}>{line.label}</span>
                  {line.description ? <span className={styles.lineDescription}>{line.description}</span> : null}
                </td>
                <td className={styles.num}>{formatQuantity(line.quantity)}</td>
                <td>{LABELS.lineUnit[line.unit]}</td>
                <td className={styles.num}>{formatMoney(line.unit_price_cents)}</td>
                <td className={styles.num}>{formatRate(line.vat_rate)}</td>
                <td className={styles.num}>{formatMoney(lineHtCents(line))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className={styles.totals}>
          <div className={styles.totalRow}>
            <dt>Total HT</dt>
            <dd>{formatMoney(shown.total_ht_cents)}</dd>
          </div>
          {computed.vatByRate.map((r) => (
            <div key={r.rate} className={styles.totalRow}>
              <dt>TVA {formatRate(r.rate)}</dt>
              <dd>{formatMoney(r.vat_cents)}</dd>
            </div>
          ))}
          <div className={[styles.totalRow, styles.grand].join(' ')}>
            <dt>Total TTC</dt>
            <dd>{formatMoney(shown.total_ttc_cents)}</dd>
          </div>
        </dl>

        {notes ? <p className={styles.notes}>{notes}</p> : null}

        <footer className={styles.mentions}>
          {mentions.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {kind === 'quote' ? <div className={styles.signature} aria-hidden="true" /> : null}
        </footer>
      </article>
    </div>
  )
}
