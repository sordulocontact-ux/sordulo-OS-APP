import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorState, Field, LoadingState, TextInput, useToast } from '../../components/ui'
import { formatMoney } from '../../shared/billing'
import { supabase } from '../../lib/supabase'
import type { CommissionPlan } from '../../shared/types'
import { emptyCommissionForm, parseCommissionForm, planToForm, previewCommission, type CommissionForm } from './profileLogic'
import { commissionPlanKey } from './useMemberAbsences'
import styles from './ProfileEditors.module.css'

const PREVIEW_DEFAULT = '8000'

export interface CommissionPlanEditorProps {
  memberId: string
}

/** Barème de commission d'un apporteur (admin seulement : la base refuse les autres). Aucun barème pré-rempli. */
export function CommissionPlanEditor({ memberId }: CommissionPlanEditorProps) {
  const plan = useQuery({
    queryKey: commissionPlanKey(memberId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_plans')
        .select('*')
        .eq('member_id', memberId)
        .maybeSingle<CommissionPlan>()
      if (error) throw error
      return data
    },
  })
  if (plan.isLoading) return <LoadingState label="Chargement du barème…" />
  if (plan.isError) return <ErrorState message="Impossible de charger le barème." onRetry={() => void plan.refetch()} />
  return <CommissionPlanForm key={plan.data?.updated_at ?? 'new'} memberId={memberId} plan={plan.data ?? null} />
}

function CommissionPlanForm({ memberId, plan }: { memberId: string; plan: CommissionPlan | null }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<CommissionForm>(() => (plan ? planToForm(plan) : emptyCommissionForm()))
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState(PREVIEW_DEFAULT)

  const save = useMutation({
    mutationFn: async (fields: NonNullable<ReturnType<typeof parseCommissionForm> & { ok: true }>['plan']) => {
      const { error: dbError } = plan
        ? await supabase.from('commission_plans').update(fields).eq('member_id', memberId)
        : await supabase.from('commission_plans').insert({ member_id: memberId, ...fields })
      if (dbError) throw dbError
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commissionPlanKey(memberId) })
      toast.success('Barème enregistré.')
    },
    onError: () => setError('Impossible d’enregistrer le barème. Seuls les admins peuvent le modifier.'),
  })

  function update(patch: Partial<CommissionForm>) {
    setForm((f) => ({ ...f, ...patch }))
    setError(null)
  }

  function updateTier(index: number, patch: Partial<CommissionForm['tiers'][number]>) {
    update({ tiers: form.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) })
  }

  function addTier() {
    // Une tranche plafonnée s'insère avant la dernière, qui reste sans plafond.
    const tiers = [...form.tiers]
    tiers.splice(tiers.length - 1, 0, { upTo: '', rate: '' })
    update({ tiers })
  }

  function submit() {
    const parsed = parseCommissionForm(form)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    save.mutate(parsed.plan)
  }

  const preview = previewCommission(form, amount)
  const parsedAmount = Number(amount.replace(',', '.').replace(/\s/g, ''))

  return (
    <section className={styles.section} aria-label="Barème de commission">
      <h3 className={styles.sectionTitle}>Barème de commission</h3>
      <div className={styles.tiers}>
        {form.tiers.map((tier, index) => {
          const last = index === form.tiers.length - 1
          return (
            <div key={index} className={styles.tier}>
              {last ? (
                <div>
                  <span className={styles.tierOpen}>{form.tiers.length === 1 ? 'Tout montant' : 'Au-delà'} (sans plafond)</span>
                </div>
              ) : (
                <Field label={`Tranche ${index + 1} : jusqu’à (€)`}>
                  <TextInput inputMode="decimal" placeholder="Plafond" value={tier.upTo} onChange={(e) => updateTier(index, { upTo: e.target.value })} />
                </Field>
              )}
              <Field label={last ? `Tranche ${index + 1} : taux (%)` : 'Taux (%)'}>
                <TextInput inputMode="decimal" placeholder="Taux" value={tier.rate} onChange={(e) => updateTier(index, { rate: e.target.value })} />
              </Field>
              {last ? (
                <span />
              ) : (
                <Button variant="ghost" size="sm" onClick={() => update({ tiers: form.tiers.filter((_, i) => i !== index) })} aria-label={`Retirer la tranche ${index + 1}`}>
                  Retirer
                </Button>
              )}
            </div>
          )
        })}
        <div>
          <Button size="sm" onClick={addTier}>
            Ajouter une tranche
          </Button>
        </div>
      </div>

      <div className={styles.twoCols}>
        <Field label="Taux des devis suivants (%)">
          <TextInput inputMode="decimal" placeholder="Taux" value={form.followupRate} onChange={(e) => update({ followupRate: e.target.value })} />
        </Field>
        <Field label="Signature du 1er devis (mois)" hint="Délai après l’enregistrement du prospect.">
          <TextInput inputMode="numeric" value={form.signWindow} onChange={(e) => update({ signWindow: e.target.value })} />
        </Field>
        <Field label="Devis suivants (mois)" hint="Fenêtre après le premier devis.">
          <TextInput inputMode="numeric" value={form.followupWindow} onChange={(e) => update({ followupWindow: e.target.value })} />
        </Field>
      </div>

      <label className={styles.check}>
        <input type="checkbox" checked={form.active} onChange={(e) => update({ active: e.target.checked })} />
        Barème actif
      </label>

      <div className={styles.preview} aria-live="polite">
        <Field label="Aperçu : devis HT de (€)">
          <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <p>
          {preview === null ? (
            'Renseigne un barème valide et un montant pour voir la commission.'
          ) : (
            <>
              Pour un devis de {formatMoney(Math.round(parsedAmount * 100))} : <span className={styles.previewAmount}>{formatMoney(preview)}</span>
            </>
          )}
        </p>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" onClick={submit} loading={save.isPending}>
          Enregistrer le barème
        </Button>
      </div>
    </section>
  )
}
