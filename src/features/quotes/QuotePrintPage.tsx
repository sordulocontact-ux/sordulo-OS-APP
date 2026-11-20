import { useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { buyerFromClient, sellerFromIssuer, sellerFromOrganization } from '../../shared/billing'
import { DocumentPreview, PrintBar } from '../billing'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useIssuers } from '../settings/useIssuers'
import { useClientWithContacts, useQuote } from './useQuotes'

/** Aperçu A4 imprimable d'un devis (hors barre latérale). */
export function QuotePrintPage() {
  const { quoteId } = useParams()
  const { organization } = useCurrentMember()
  const quoteQuery = useQuote(quoteId)
  const quote = quoteQuery.data ?? null
  const clientQuery = useClientWithContacts(quote?.client_id)
  const issuersQuery = useIssuers(organization?.id)

  const backTo = `/quotes/${quoteId ?? ''}`
  if (quoteQuery.isLoading || (quote && (clientQuery.isLoading || issuersQuery.isLoading))) return <LoadingState label="Chargement du devis…" />
  if (quoteQuery.isError || clientQuery.isError || issuersQuery.isError) {
    return (
      <ErrorState
        message="Impossible de charger le devis."
        onRetry={() => {
          void quoteQuery.refetch()
          void clientQuery.refetch()
          void issuersQuery.refetch()
        }}
      />
    )
  }
  const client = clientQuery.data
  if (!quote || !client || !organization) {
    return <EmptyState title="Devis introuvable" text="Ce devis n'existe pas ou tu n'y as pas accès." />
  }
  const issuer = (issuersQuery.data ?? []).find((i) => i.id === quote.issuer_id)
  const contact = client.client_contacts.find((c) => c.is_primary) ?? null

  return (
    <>
      <PrintBar backTo={backTo} backLabel={`Devis ${quote.number}`} />
      <DocumentPreview
        kind="quote"
        number={quote.number}
        issueDate={quote.issue_date}
        validUntil={quote.valid_until}
        seller={issuer ? sellerFromIssuer(issuer) : sellerFromOrganization(organization)}
        buyer={buyerFromClient(client, contact)}
        title={quote.title}
        lines={quote.lines}
        notes={quote.notes}
        totals={{
          total_ht_cents: quote.total_ht_cents,
          total_vat_cents: quote.total_vat_cents,
          total_ttc_cents: quote.total_ttc_cents,
        }}
      />
    </>
  )
}
