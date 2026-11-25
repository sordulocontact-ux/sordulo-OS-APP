import { useState, type FormEvent } from 'react'
import { Button, Field, Modal, Select, TextInput, useToast } from '../../components/ui'
import { useCurrentMember } from '../auth/useCurrentMember'
import { contractErrorText } from './contractLogic'
import { useAcceptedQuotes, useClientOptions, useCreateBlankContract, useDraftContract } from './useContracts'
import styles from './contracts.module.css'

export interface NewContractModalProps {
  open: boolean
  onClose: () => void
  /** Projet de la page où l'on se trouve ; null : liste globale. */
  projectId?: string | null
  /** Client du projet (contrat vierge sans choix de client). */
  projectClientId?: string | null
  onCreated: (contractId: string) => void
}

/** Nouveau contrat : rédigé par l'IA depuis un devis accepté, ou vierge. */
export function NewContractModal({ open, onClose, projectId = null, projectClientId = null, onCreated }: NewContractModalProps) {
  const toast = useToast()
  const { member, organization } = useCurrentMember()
  const [mode, setMode] = useState<'quote' | 'blank'>('quote')
  const [quoteId, setQuoteId] = useState('')
  const [clientId, setClientId] = useState(projectClientId ?? '')
  const [title, setTitle] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quotes = useAcceptedQuotes(projectId, open)
  const clients = useClientOptions(open && mode === 'blank' && !projectClientId)
  const draft = useDraftContract()
  const blank = useCreateBlankContract()
  const busy = draft.isPending || blank.isPending
  const quoteList = quotes.data ?? []

  async function submit(event: FormEvent) {
    event.preventDefault()
    setShowErrors(true)
    setError(null)
    try {
      if (mode === 'quote') {
        if (quoteId === '') return
        const id = await draft.mutateAsync(quoteId)
        toast.success('Contrat rédigé, à relire avant envoi')
        onCreated(id)
      } else {
        if (!organization || clientId === '' || title.trim() === '') return
        const created = await blank.mutateAsync({ organizationId: organization.id, memberId: member?.id ?? null, clientId, projectId, title: title.trim() })
        toast.success('Contrat créé')
        onCreated(created.id)
      }
    } catch (e) {
      setError(contractErrorText(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau contrat"
      dismissible={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" type="submit" form="new-contract-form" loading={busy}>
            {mode === 'quote' ? 'Rédiger le contrat' : 'Créer le contrat'}
          </Button>
        </>
      }
    >
      <form id="new-contract-form" className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className={styles.choices}>
          <legend className={styles.hint}>Point de départ</legend>
          <label>
            <input type="radio" name="mode" checked={mode === 'quote'} onChange={() => setMode('quote')} /> Depuis un devis accepté (rédigé par l’IA)
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'blank'} onChange={() => setMode('blank')} /> Contrat vierge
          </label>
        </fieldset>
        {mode === 'quote' ? (
          <Field
            label="Devis accepté"
            error={showErrors && quoteId === '' ? 'Choisis un devis.' : null}
            hint={quotes.isLoading ? 'Chargement des devis…' : quoteList.length === 0 ? 'Aucun devis accepté pour le moment.' : 'Prix et prestations sont repris du devis tels quels.'}
          >
            <Select value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
              <option value="">Choisir un devis</option>
              {quoteList.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.number} · {q.title}
                  {q.client ? ` · ${q.client.name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Titre" error={showErrors && title.trim() === '' ? 'Donne un titre au contrat.' : null}>
              <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            {projectClientId ? null : (
              <Field label="Client" error={showErrors && clientId === '' ? 'Choisis un client.' : null}>
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Choisir un client</option>
                  {(clients.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
        {draft.isPending ? <p className={styles.hint}>L’IA rédige le contrat, compte une dizaine de secondes.</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
