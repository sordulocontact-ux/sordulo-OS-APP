import { BackLink, Button } from '../../components/ui'
import styles from './PrintBar.module.css'

export interface PrintBarProps {
  backTo: string
  backLabel: string
}

/** Barre au-dessus de l'aperçu : retour et impression (le navigateur propose « Enregistrer au format PDF »). Masquée à l'impression. */
export function PrintBar({ backTo, backLabel }: PrintBarProps) {
  return (
    <div className={styles.bar}>
      <BackLink to={backTo} label={backLabel} />
      <div className={styles.actions}>
        <p className={styles.help}>Choisis « Enregistrer au format PDF » dans la fenêtre d’impression.</p>
        <Button variant="primary" onClick={() => window.print()}>
          Télécharger en PDF
        </Button>
      </div>
    </div>
  )
}
