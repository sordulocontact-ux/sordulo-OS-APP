import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, TextInput } from '../../components/ui'
import type { Invoice } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useClients } from '../clients/useClients'
import { activeIssuers, defaultIssuerId, showIssuerSelect } from '../settings/issuerLogic'
import { useIssuers } from '../settings/useIssuers'
import { invoiceErrorText } from './invoiceLogic'
import { useCreateInvoiceDraft, useProjectOptions } from './useInvoices'
import styles from './invoices.module.css'

export interface NewInvoiceModalProps {
  open: boolean
  onClose: () => void
  /** Client et projet pré-remplis. */
  initialClientId?: string
  initialProjectId?: string
  /** Appelé avec le brouillon créé. */
  onCreated: (invoice: Invoice) => void
}

interface Draft {
  clientId: string
  projectId: string
  kind: 'invoice' | 'deposit'
  title: string
  issuerId: string
}

/** Petite modale de création d'un brouillon : client, projet facultatif, type, titre. */
export function NewInvoiceModal({ open, onClose, initialClientId = '', initialProjectId = '', onCreated }: NewInvoiceModalProps) {
  const { organization } = useCurrentMember()
  const clients = useClients()
  const projects = useProjectOptions()
  const create = useCreateInvoiceDraft()
  const [draft, setDraft] = useState<Draft>({ clientId: initialClientId, projectId: initialProjectId, kind: 'invoice', title: '', issuerId: '' })
  const [wasOpen, setWasOpen] = useState(open)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remet le formulaire à neuf à chaque ouverture.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft({ clientId: initialClientId, projectId: initialProjectId, kind: 'invoice', title: '', issuerId: '' })
      setShowErrors(false)
      setError(null)
      create.reset()
    }
  }

  const allProjects = projects.data ?? []
  // Projet pré-rempli sans client : le client est celui du projet.
  const clientId = draft.clientId || allProjects.find((p) => p.id === draft.projectId)?.client_id || ''
  const clientProjects = allProjects.filter((p) => p.client_id === clientId)
  const activeClients = (clients.data ?? []).filter((c) => !c.archived_at || c.id === clientId)
  const issuers = useIssuers(organization?.id)
  const issuerChoices = activeIssuers(issuers.data ?? [])
  // Émetteur par défaut tant que rien n'est choisi ; aucun émetteur lisible : la base décide.
  const issuerId = issuerChoices.some((i) => i.id === draft.issuerId) ? draft.issuerId : defaultIssuerId(issuerChoices)
  const busy = create.isPending
  const clientError = clientId === '' ? 'Choisis un client.' : null
  const titleError = draft.title.trim() === '' ? 'Indique un titre.' : null

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setShowErrors(true)
    setError(null)
    if (clientError || titleError || !organization) return
    try {
      const invoice = await create.mutateAsync({
        organizationId: organization.id,
        clientId,
        projectId: clientProjects.some((p) => p.id === draft.projectId) ? draft.projectId : null,
        kind: draft.kind,
        title: draft.title.trim(),
        // Sans ligne : la base refuse une ligne sans libellé, l'éditeur propose « Ajouter une ligne ».
        lines: [],
        issuerId: issuerId === '' ? null : issuerId,
      })
      onCreated(invoice)
    } catch (e) {
      setError(invoiceErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Nouvelle facture"
      dismissible={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="new-invoice-form" loading={busy}>
            Créer le brouillon
          </Button>
        </>
      }
    >
      <form id="new-invoice-form" className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field label="Client" error={showErrors ? clientError : null}>
          <Select
            value={clientId}
            onChange={(e) => setDraft((d) => ({ ...d, clientId: e.target.value, projectId: '' }))}
            required
          >
            <option value="">Choisir un client</option>
            {activeClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projet (facultatif)">
          <Select value={draft.projectId} onChange={(e) => set('projectId', e.target.value)} disabled={clientId === ''}>
            <option value="">Aucun projet</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={draft.kind} onChange={(e) => set('kind', e.target.value as Draft['kind'])}>
            <option value="invoice">Facture</option>
            <option value="deposit">Facture d’acompte</option>
          </Select>
        </Field>
        {showIssuerSelect(issuerChoices) ? (
          <Field label="Émetteur" hint="Chaque émetteur a sa propre numérotation de factures.">
            <Select value={issuerId} onChange={(e) => set('issuerId', e.target.value)}>
              {issuerChoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.display_name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Titre" error={showErrors ? titleError : null}>
          <TextInput value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex. Refonte du site" required />
        </Field>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
