import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, TextInput, useToast } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { activeIssuers, defaultIssuerId, showIssuerSelect } from '../settings/issuerLogic'
import { useIssuers } from '../settings/useIssuers'
import { quoteErrorText } from './quoteLogic'
import { useClientProjectOptions, useCreateQuote, useQuoteClients } from './useQuotes'
import styles from './quotes.module.css'

export interface NewQuoteModalProps {
  open: boolean
  onClose: () => void
  /** Pré-remplissage (`?client=&project=`). */
  initialClientId?: string
  initialProjectId?: string
  /** Appelé avec l'id du devis créé. */
  onCreated: (quoteId: string) => void
}

/** Création d'un devis en brouillon : client obligatoire, projet facultatif du client, titre. */
export function NewQuoteModal({ open, onClose, initialClientId = '', initialProjectId = '', onCreated }: NewQuoteModalProps) {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const clients = useQuoteClients()
  const create = useCreateQuote()
  const [clientId, setClientId] = useState(initialClientId)
  const [projectId, setProjectId] = useState(initialProjectId)
  const [title, setTitle] = useState('')
  const [pickedIssuerId, setPickedIssuerId] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projects = useClientProjectOptions(clientId)
  const issuers = useIssuers(organization?.id)
  const issuerChoices = activeIssuers(issuers.data ?? [])
  // Émetteur par défaut tant que rien n'est choisi ; aucun émetteur lisible : la base décide.
  const issuerId = issuerChoices.some((i) => i.id === pickedIssuerId) ? pickedIssuerId : defaultIssuerId(issuerChoices)

  const clientError = showErrors && clientId === '' ? 'Choisis un client.' : null
  const titleError = showErrors && title.trim() === '' ? 'Donne un titre au devis.' : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setShowErrors(true)
    setError(null)
    if (!organization || clientId === '' || title.trim() === '') return
    try {
      const quote = await create.mutateAsync({
        organizationId: organization.id,
        memberId: member?.id ?? null,
        clientId,
        projectId: projectId === '' ? null : projectId,
        title: title.trim(),
        issuerId: issuerId === '' ? null : issuerId,
      })
      toast.success('Devis créé')
      onCreated(quote.id)
    } catch (e) {
      setError(quoteErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau devis"
      dismissible={!create.isPending}
      actions={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="new-quote-form" loading={create.isPending}>
            Créer le devis
          </Button>
        </>
      }
    >
      <form id="new-quote-form" className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Client" error={clientError}>
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setProjectId('')
            }}
          >
            <option value="">Choisir un client</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projet (facultatif)" hint={clientId === '' ? 'Choisis d’abord un client.' : undefined}>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={clientId === ''}>
            <option value="">Aucun projet</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Titre" error={titleError}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refonte du site vitrine" />
        </Field>
        {showIssuerSelect(issuerChoices) ? (
          <Field label="Émetteur" hint="L’entité qui émet le devis puis les factures.">
            <Select value={issuerId} onChange={(e) => setPickedIssuerId(e.target.value)}>
              {issuerChoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.display_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {clients.isError ? <p className={styles.error}>Impossible de charger les clients.</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
