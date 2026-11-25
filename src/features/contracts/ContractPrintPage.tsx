import { useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { formatDate } from '../../shared/billing'
import { PrintBar } from '../billing'
import { MarkdownView } from './MarkdownView'
import { useContract } from './useContracts'
import styles from './contracts.module.css'

/** Aperçu A4 imprimable d'un contrat (hors barre latérale). Le texte est celui du contrat, déjà complet. */
export function ContractPrintPage() {
  const { contractId } = useParams()
  const { data: contract, isLoading, isError, refetch } = useContract(contractId)
  if (isLoading) return <LoadingState label="Chargement du contrat…" />
  if (isError) return <ErrorState message="Impossible de charger le contrat." onRetry={() => void refetch()} />
  if (!contract) return <EmptyState title="Contrat introuvable" text="Ce contrat n'existe pas ou tu n'y as pas accès." />
  const signedAt = contract.status === 'signed' ? contract.signed_at : null

  return (
    <>
      <PrintBar backTo={`/contracts/${contract.id}`} backLabel="Contrat" />
      <div className={styles.wrapper}>
        <article className={styles.sheet} aria-label={`Contrat ${contract.title}`}>
          <div className={styles.preview}>
            <MarkdownView source={contract.body} />
          </div>
          <footer className={styles.signatures}>
            <div className={styles.signatureBox}>
              <p>Pour le prestataire</p>
              <div className={styles.signatureSpace} aria-hidden="true" />
            </div>
            <div className={styles.signatureBox}>
              <p>Pour le client{contract.client ? ` : ${contract.client.name}` : ''}</p>
              <div className={styles.signatureSpace} aria-hidden="true" />
              {signedAt ? (
                <p className={styles.signedNote}>
                  Signé le {formatDate(signedAt.slice(0, 10))}
                  {contract.signed_by_name ? ` par ${contract.signed_by_name}` : ''}
                </p>
              ) : null}
            </div>
          </footer>
        </article>
      </div>
    </>
  )
}
