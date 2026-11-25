import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, Field, LoadingState, TextInput } from '../../components/ui'
import { formatDate } from '../../shared/billing'
import { LABELS } from '../../shared/types'
import { PortalContracts, PortalInvoices, PortalQuotes } from './PortalDocuments'
import { PortalDeliverables } from './PortalDeliverables'
import { PortalApiError } from './portalApi'
import type { PortalProgress, PortalResponse } from './portalContract'
import { isPortalToken, pendingActions, progressPercent, readClientName, saveClientName } from './portalLogic'
import { usePortal } from './usePortal'
import styles from './PortalPage.module.css'

/** Nom du client partagé par toutes les actions de la page (mémorisé sur l'appareil). */
export interface ClientNameState {
  name: string
  setName: (name: string) => void
  /** Nom trimé, ou null après avoir mis le focus sur le champ « Votre nom ». */
  requireName: () => string | null
}

/**
 * Portail client public (/p/:token), hors connexion et hors barre latérale : avancement, livrables à
 * commenter et valider, devis à accepter, contrats à signer, factures.
 */
export function PortalPage() {
  const { token = '' } = useParams()
  const valid = isPortalToken(token)
  const portal = usePortal(valid ? token : '')

  if (!valid) return <InvalidLink />
  if (portal.isLoading) {
    return (
      <main className={styles.shell}>
        <LoadingState label="Chargement de votre espace projet…" />
      </main>
    )
  }
  if (portal.isError) {
    if (portal.error instanceof PortalApiError && portal.error.status === 404) return <InvalidLink />
    return (
      <main className={styles.shell}>
        <ErrorState
          message={portal.error instanceof PortalApiError ? portal.error.message : 'Impossible de charger votre espace projet.'}
          onRetry={() => void portal.refetch()}
        />
      </main>
    )
  }
  if (!portal.data) return <InvalidLink />
  return <PortalContent token={token} data={portal.data} />
}

function InvalidLink() {
  useEffect(() => {
    document.title = 'Lien invalide'
  }, [])
  return (
    <main className={styles.shell}>
      <EmptyState
        title="Ce lien ne fonctionne pas"
        text="Il est incomplet, a été remplacé par un nouveau lien ou le portail a été désactivé. Demandez un nouveau lien à l’agence."
      />
    </main>
  )
}

function PortalContent({ token, data }: { token: string; data: PortalResponse }) {
  const { project } = data
  const nameRef = useRef<HTMLElement>(null)
  const [name, setNameState] = useState(() => readClientName())
  const [nameError, setNameError] = useState<string | null>(null)
  const pending = pendingActions(data)

  useEffect(() => {
    document.title = `${project.name} · Espace client`
  }, [project.name])

  const nameState: ClientNameState = {
    name,
    setName: (value) => {
      setNameState(value)
      setNameError(null)
      saveClientName(value)
    },
    requireName: () => {
      const clean = name.trim()
      if (clean) return clean
      setNameError('Indiquez votre nom : il apparaît sur vos commentaires, validations et signatures.')
      const input = nameRef.current?.querySelector('input')
      input?.scrollIntoView({ block: 'center' })
      input?.focus({ preventScroll: true })
      return null
    },
  }

  const nothing =
    data.deliverables.length === 0 && data.quotes.length === 0 && data.contracts.length === 0 && data.invoices.length === 0

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        {project.agencyName ? <p className={styles.agency}>{project.agencyName}</p> : null}
        <h1 className={styles.projectName}>{project.name}</h1>
        <p className={styles.meta}>
          {project.clientName ? <span>{project.clientName}</span> : null}
          <Badge tone="primary">{LABELS.projectStatus[project.status]}</Badge>
          {project.startDate ? <span>Début : {formatDate(project.startDate)}</span> : null}
          {project.dueDate ? <span>Échéance : {formatDate(project.dueDate)}</span> : null}
        </p>
        {pending > 0 ? (
          <p className={styles.pending} role="status">
            {pending === 1 ? 'Un élément attend votre réponse.' : `${pending} éléments attendent votre réponse.`}
          </p>
        ) : null}
      </header>

      <Progress progress={data.progress} />

      {nothing ? (
        <EmptyState title="Rien à valider pour l’instant" text="L’agence partagera ici les maquettes, devis, contrats et factures du projet." />
      ) : (
        <>
          <section ref={nameRef} className={styles.nameCard} aria-label="Votre nom">
            <Field label="Votre nom" hint="Affiché sur vos commentaires, validations et signatures. Mémorisé sur cet appareil." error={nameError}>
              <TextInput
                value={name}
                maxLength={80}
                autoComplete="name"
                onChange={(event) => nameState.setName(event.target.value)}
              />
            </Field>
          </section>
          {data.deliverables.length > 0 ? <PortalDeliverables token={token} deliverables={data.deliverables} nameState={nameState} /> : null}
          {data.quotes.length > 0 ? <PortalQuotes token={token} quotes={data.quotes} nameState={nameState} /> : null}
          {data.contracts.length > 0 ? <PortalContracts token={token} contracts={data.contracts} nameState={nameState} /> : null}
          {data.invoices.length > 0 ? <PortalInvoices invoices={data.invoices} /> : null}
        </>
      )}

      <footer className={styles.footer}>
        <p>Espace client privé : ne partagez ce lien qu’avec les personnes concernées par le projet.</p>
      </footer>
    </main>
  )
}

function Progress({ progress }: { progress: PortalProgress }) {
  const percent = progressPercent(progress.tasksDone, progress.tasksTotal)
  if (percent === null && progress.areas.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby="portal-progress">
      <h2 id="portal-progress" className={styles.sectionTitle}>
        Avancement
      </h2>
      {percent !== null ? (
        <div className={styles.progressBlock}>
          <div className={styles.progressLabel}>
            <span>
              {progress.tasksDone} tâche{progress.tasksDone > 1 ? 's' : ''} terminée{progress.tasksDone > 1 ? 's' : ''} sur{' '}
              {progress.tasksTotal}
            </span>
            <strong>{percent} %</strong>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Avancement du projet"
          >
            <div className={styles.progressFill} style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
        </div>
      ) : null}
      {progress.areas.length > 0 ? (
        <ul className={styles.areas}>
          {progress.areas.map((area) => (
            <li key={area.area ?? '_'} className={styles.area}>
              <span className={styles.areaName}>{area.area ?? 'Général'}</span>
              <span className={styles.areaCounts}>
                {area.open > 0 ? `${area.open} en cours` : null}
                {area.open > 0 && area.done > 0 ? ' · ' : null}
                {area.done > 0 ? `${area.done} terminé${area.done > 1 ? 's' : ''}` : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
