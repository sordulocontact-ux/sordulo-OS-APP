import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Select } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import gmailLogo from '../../assets/connectors/gmail.png'
import { FINANCE_ROLES, PROJECT_ROLES, useHasRole } from '../auth/roles'
import { FollowupsPanel } from '../followups'
import { NewInputModal } from '../inputs/NewInputModal'
import { useProjects } from '../projects/useProjects'
import { EMAIL_PROMISES, projectChoices } from './emailLogic'
import styles from './email.module.css'

/** Coller un mail client : choix du projet, puis fenêtre « Nouvelle entrée » (retour écrit). */
function PasteMailCard() {
  const { data, isLoading, isError, refetch } = useProjects()
  const [projectId, setProjectId] = useState('')
  const [open, setOpen] = useState(false)
  const choices = useMemo(() => projectChoices(data ?? []), [data])

  return (
    <Card className={styles.card}>
      <h2>Coller un mail client</h2>
      <p className={styles.lead}>Choisis le projet, colle le mail : l'IA en tire des tickets que tu valides ensuite.</p>
      {isLoading ? (
        <LoadingState label="Chargement des projets…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les projets." onRetry={() => void refetch()} />
      ) : choices.length === 0 ? (
        <EmptyState title="Aucun projet" text="Crée d'abord un projet pour y rattacher un mail." action={<Link to="/projects">Voir les projets</Link>} />
      ) : (
        <div className={styles.pasteForm}>
          <Field label="Projet">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Choisir un projet</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => setOpen(true)} disabled={projectId === ''}>
            Coller un mail
          </Button>
        </div>
      )}
      {projectId !== '' ? <NewInputModal projectId={projectId} open={open} onClose={() => setOpen(false)} /> : null}
    </Card>
  )
}

/** Email : présentation de la future boîte mail (Gmail, bientôt) et ce qui sert déjà au mail aujourd'hui. */
export function EmailPage() {
  const canFollowUp = useHasRole(FINANCE_ROLES)
  const canPaste = useHasRole(PROJECT_ROLES)

  return (
    <section className={table.page} aria-labelledby="email-title">
      <h1 id="email-title">Email</h1>

      <Card className={styles.hero}>
        <div className={styles.heroHead}>
          <img src={gmailLogo} alt="" className={styles.logo} width={40} height={40} />
          <div>
            <h2>La boîte mail dans Sordulo OS</h2>
            <Badge tone="info">Bientôt</Badge>
          </div>
        </div>
        <p className={styles.lead}>
          Elle demandera de relier ton compte Gmail depuis la page Connecteurs. En attendant, les outils ci-dessous couvrent déjà l'essentiel.
        </p>
        <ul className={styles.promises}>
          {EMAIL_PROMISES.map((promise) => (
            <li key={promise.title}>
              <strong>{promise.title}</strong>
              <span className={styles.muted}>{promise.text}</span>
            </li>
          ))}
        </ul>
        <div>
          <Link to="/connectors" className={styles.linkButton}>
            Voir les connecteurs
          </Link>
        </div>
      </Card>

      <div className={styles.now}>
        <h2>Disponible aujourd'hui</h2>
        {canPaste ? <PasteMailCard /> : null}
        {canFollowUp ? (
          <FollowupsPanel />
        ) : (
          <p className={styles.muted}>Les relances de devis et de factures sont réservées à l'administration et à la finance.</p>
        )}
      </div>
    </section>
  )
}
