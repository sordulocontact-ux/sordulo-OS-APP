import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, ErrorState, Field, LoadingState, Textarea, TextInput, useToast } from '../../components/ui'
import { ApiRequestError } from '../../lib/api'
import { FINANCE_ROLES, useHasRole } from '../auth/roles'
import type { Brief } from '../../shared/types'
import { briefSections, briefToForm, formChanged, formToBrief, type BriefForm } from './briefLogic'
import { useBrief, useBriefQuote, useCreateQuoteDraft, useGenerateBrief, useSaveBrief } from './useBrief'
import styles from './BriefPanel.module.css'

const errorText = (e: unknown, fallback: string) => (e instanceof ApiRequestError ? e.message : fallback)

export interface BriefPanelProps {
  inputId: string
}

/** Section « Brief » de la fiche d'une entrée prête : génération, relecture, modification, brouillon de devis. */
export function BriefPanel({ inputId }: BriefPanelProps) {
  const query = useBrief(inputId)
  const generate = useGenerateBrief(inputId)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    try {
      await generate.mutateAsync()
    } catch (e) {
      setError(errorText(e, 'Impossible de générer le brief.'))
    }
  }

  let body
  if (query.isLoading) body = <LoadingState label="Chargement du brief…" />
  else if (query.isError) body = <ErrorState message="Impossible de charger le brief." onRetry={() => void query.refetch()} />
  else if (!query.data) {
    body = (
      <div className={styles.empty}>
        <p className={styles.muted}>L’IA résume l’entrée en brief structuré : contexte, objectifs, livrables, contraintes, budget, délais et questions à poser. Rien n’est inventé, tu relis et corriges.</p>
        <div>
          <Button variant="primary" onClick={() => void run()} loading={generate.isPending}>
            {error ? 'Réessayer' : 'Générer le brief'}
          </Button>
        </div>
      </div>
    )
  } else body = <BriefView key={query.data.updated_at} brief={query.data} inputId={inputId} onRegenerate={run} regenerating={generate.isPending} />

  return (
    <section className={styles.section} aria-labelledby={`brief-title-${inputId}`}>
      <h2 id={`brief-title-${inputId}`} className={styles.title}>
        Brief
      </h2>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {body}
    </section>
  )
}

interface BriefViewProps {
  brief: Brief
  inputId: string
  onRegenerate: () => Promise<void>
  regenerating: boolean
}

function BriefView({ brief, inputId, onRegenerate, regenerating }: BriefViewProps) {
  const toast = useToast()
  const navigate = useNavigate()
  const canQuote = useHasRole(FINANCE_ROLES)
  const save = useSaveBrief(inputId)
  const createQuote = useCreateQuoteDraft(inputId)
  const quote = useBriefQuote(brief.quote_id)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<BriefForm>(() => briefToForm(brief.content))
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sections = briefSections(brief.content)

  const set = (key: keyof BriefForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync({ briefId: brief.id, content: formToBrief(form) })
      toast.success('Brief enregistré')
      setEditing(false)
    } catch {
      setError('Impossible d’enregistrer le brief.')
    }
  }

  async function makeQuote() {
    setError(null)
    try {
      const { quoteId } = await createQuote.mutateAsync(brief.id)
      toast.success('Brouillon de devis créé')
      void navigate(`/quotes/${quoteId}`)
    } catch (e) {
      setError(errorText(e, 'Impossible de créer le brouillon de devis.'))
    }
  }

  async function regenerate() {
    await onRegenerate()
    setConfirming(false)
  }

  return (
    <Card className={styles.card}>
      {editing ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="Contexte">
            <Textarea rows={4} value={form.contexte} onChange={(e) => set('contexte')(e.target.value)} />
          </Field>
          <Field label="Objectifs" hint="Un point par ligne.">
            <Textarea rows={3} value={form.objectifs} onChange={(e) => set('objectifs')(e.target.value)} />
          </Field>
          <Field label="Livrables" hint="Un point par ligne.">
            <Textarea rows={3} value={form.livrables} onChange={(e) => set('livrables')(e.target.value)} />
          </Field>
          <Field label="Contraintes" hint="Un point par ligne.">
            <Textarea rows={3} value={form.contraintes} onChange={(e) => set('contraintes')(e.target.value)} />
          </Field>
          <div className={styles.pair}>
            <Field label="Budget">
              <TextInput value={form.budget} onChange={(e) => set('budget')(e.target.value)} />
            </Field>
            <Field label="Délais">
              <TextInput value={form.delais} onChange={(e) => set('delais')(e.target.value)} />
            </Field>
          </div>
          <Field label="Questions ouvertes" hint="Un point par ligne.">
            <Textarea rows={3} value={form.questions} onChange={(e) => set('questions')(e.target.value)} />
          </Field>
          <div className={styles.buttons}>
            <Button variant="primary" type="submit" loading={save.isPending} disabled={!formChanged(form, brief.content)}>
              Enregistrer
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setForm(briefToForm(brief.content))
                setEditing(false)
              }}
              disabled={save.isPending}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : sections.length === 0 ? (
        <p className={styles.muted}>Le brief est vide : l’entrée ne contenait rien d’exploitable. Modifie-le ou régénère-le.</p>
      ) : (
        <dl className={styles.sections}>
          {sections.map((s) => (
            <div key={s.key} className={styles.row}>
              <dt className={styles.label}>{s.title}</dt>
              <dd className={styles.value}>
                {s.items ? (
                  <ul className={styles.list}>
                    {s.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  s.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {editing ? null : confirming ? (
        <div className={styles.confirm} role="group" aria-label="Confirmer la régénération">
          <p>Le brief actuel, avec tes modifications, sera remplacé. Le devis déjà créé n’est pas touché.</p>
          <div className={styles.buttons}>
            <Button variant="primary" onClick={() => void regenerate()} loading={regenerating}>
              Remplacer le brief
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={regenerating}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.buttons}>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Modifier
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Régénérer
          </Button>
          {canQuote ? (
            brief.quote_id && quote.data ? (
              <Link className={styles.quoteLink} to={`/quotes/${quote.data.id}`}>
                Voir le devis {quote.data.number}
              </Link>
            ) : (
              <Button variant="primary" size="sm" onClick={() => void makeQuote()} loading={createQuote.isPending} disabled={brief.quote_id !== null && quote.isLoading}>
                Créer le brouillon de devis
              </Button>
            )
          ) : null}
        </div>
      )}
    </Card>
  )
}
