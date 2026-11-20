import { Link, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { buyerFromClient, sellerFromOrganization } from '../../shared/billing'
import { useCurrentMember } from '../auth/useCurrentMember'
import { DocumentPreview, PrintBar } from '../billing'
import { useClient, useClientContacts } from '../clients/useClients'
import { primaryContact } from '../clients/clientUtils'
import { useInvoice } from './useInvoices'

/** Aperçu A4 d'une facture. Émise : vendeur et acheteur figés ; brouillon : ceux d'aujourd'hui. */
export function InvoicePrintPage() {
  const { invoiceId } = useParams()
  const { organization } = useCurrentMember()
  const invoiceQuery = useInvoice(invoiceId)
  const invoice = invoiceQuery.data
  const clientQuery = useClient(invoice?.client_id)
  const contactsQuery = useClientContacts(invoice?.client_id)
  const back = invoiceId ? `/invoices/${invoiceId}` : '/invoices'

  if (invoiceQuery.isLoading || (invoice && (clientQuery.isLoading || contactsQuery.isLoading))) {
    return <LoadingState label="Chargement de la facture…" />
  }
  if (invoiceQuery.isError || clientQuery.isError || contactsQuery.isError) {
    return (
      <ErrorState
        message="Impossible de charger la facture."
        onRetry={() => {
          void invoiceQuery.refetch()
          void clientQuery.refetch()
          void contactsQuery.refetch()
        }}
      />
    )
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

  const seller = invoice.seller ?? (organization ? sellerFromOrganization(organization) : null)
  const client = clientQuery.data
  const buyer = invoice.buyer ?? (client ? buyerFromClient(client, primaryContact(contactsQuery.data ?? [])) : null)
  if (!seller || !buyer) {
    return <EmptyState title="Aperçu indisponible" text="Les informations du vendeur ou du client sont introuvables." />
  }

  return (
    <>
      <PrintBar backTo={back} backLabel="Facture" />
      <DocumentPreview
        kind={invoice.kind}
        number={invoice.number}
        issueDate={invoice.issue_date}
        dueDate={invoice.due_date}
        seller={seller}
        buyer={buyer}
        title={invoice.title}
        lines={invoice.lines}
        notes={invoice.notes}
        totals={{
          total_ht_cents: invoice.total_ht_cents,
          total_vat_cents: invoice.total_vat_cents,
          total_ttc_cents: invoice.total_ttc_cents,
        }}
      />
    </>
  )
}
