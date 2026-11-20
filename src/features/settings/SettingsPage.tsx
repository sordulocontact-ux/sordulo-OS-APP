import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, ErrorState, Field, LoadingState, Textarea, TextInput, useToast } from '../../components/ui'
import { useAuth, useCurrentMember } from '../auth'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Organization } from '../../shared/types'
import { buildPatch, LEGAL_FORMS, toForm, type SettingsErrors, type SettingsForm } from './settingsLogic'
import styles from './SettingsPage.module.css'

function useOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.organization(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', organizationId ?? '')
        .single<Organization>()
      if (error) throw error
      return data
    },
  })
}

export function SettingsPage() {
  const { organization } = useCurrentMember()
  const { data, isLoading, isError, refetch } = useOrganization(organization?.id)

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <h1 id="settings-title">Paramètres</h1>
      <p className={styles.intro}>Ces informations serviront aux devis et factures.</p>
      {isLoading || !organization ? (
        <LoadingState label="Chargement des paramètres…" />
      ) : isError || !data ? (
        <ErrorState message="Impossible de charger les paramètres." onRetry={() => void refetch()} />
      ) : (
        <SettingsForm key={data.id} organization={data} />
      )}
    </section>
  )
}

function SettingsForm({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { user } = useAuth()
  const [saved, setSaved] = useState(organization)
  const [form, setForm] = useState<SettingsForm>(() => toForm(organization))
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  function set<K extends keyof SettingsForm>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
    setUnchanged(false)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setUnchanged(false)
    const result = buildPatch(form, saved)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    if (Object.keys(result.patch).length === 0) {
      setUnchanged(true)
      return
    }
    setBusy(true)
    try {
      const { data, error: dbError } = await supabase
        .from('organizations')
        .update(result.patch)
        .eq('id', saved.id)
        .select('*')
        .overrideTypes<Organization[], { merge: false }>()
      if (dbError) throw dbError
      // La RLS ne renvoie pas d'erreur quand elle refuse un update : zéro ligne modifiée.
      const updated = data?.[0]
      if (!updated) {
        setError('Seuls les admins peuvent modifier les paramètres.')
        return
      }
      setSaved(updated)
      setForm(toForm(updated))
      void queryClient.invalidateQueries({ queryKey: queryKeys.organization(saved.id) })
      if (user) void queryClient.invalidateQueries({ queryKey: queryKeys.currentMember(user.id) })
      toast.success('Modifications enregistrées')
    } catch {
      setError('Impossible d’enregistrer les modifications. Réessaie.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
      <Card role="group" aria-labelledby="org-title" className={styles.section}>
        <h2 id="org-title">Organisation</h2>
        <Field label="Nom" error={errors.name}>
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} disabled={busy} required />
        </Field>
        <Field label="Raison sociale">
          <TextInput value={form.legalName} onChange={(e) => set('legalName', e.target.value)} disabled={busy} />
        </Field>
        <Field label="Forme juridique" hint="Choisis dans la liste ou saisis la tienne.">
          <TextInput list="legal-forms" value={form.legalForm} onChange={(e) => set('legalForm', e.target.value)} disabled={busy} />
        </Field>
        <datalist id="legal-forms">
          {LEGAL_FORMS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <Field label="SIRET" hint="14 chiffres, avec ou sans espaces." error={errors.siret}>
          <TextInput inputMode="numeric" value={form.siret} onChange={(e) => set('siret', e.target.value)} disabled={busy} />
        </Field>
      </Card>

      <Card role="group" aria-labelledby="address-title" className={styles.section}>
        <h2 id="address-title">Adresse</h2>
        <Field label="Rue">
          <TextInput value={form.street} onChange={(e) => set('street', e.target.value)} autoComplete="street-address" disabled={busy} />
        </Field>
        <div className={styles.pair}>
          <Field label="Code postal">
            <TextInput value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} autoComplete="postal-code" disabled={busy} />
          </Field>
          <Field label="Ville">
            <TextInput value={form.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" disabled={busy} />
          </Field>
        </div>
        <Field label="Pays">
          <TextInput value={form.country} onChange={(e) => set('country', e.target.value)} autoComplete="country-name" disabled={busy} />
        </Field>
      </Card>

      <Card role="group" aria-labelledby="billing-title" className={styles.section}>
        <h2 id="billing-title">Facturation</h2>
        <Field label="Mention TVA" hint="Par exemple : TVA non applicable, art. 293 B du CGI.">
          <Textarea rows={3} value={form.vatMention} onChange={(e) => set('vatMention', e.target.value)} disabled={busy} />
        </Field>
        <div className={styles.pair}>
          <Field label="Taux journalier par défaut (€ HT)" error={errors.dailyRate}>
            <TextInput type="number" min={0} step={0.01} inputMode="decimal" value={form.dailyRate} onChange={(e) => set('dailyRate', e.target.value)} disabled={busy} />
          </Field>
          <Field label="Taux horaire par défaut (€ HT)" error={errors.hourlyRate}>
            <TextInput type="number" min={0} step={0.01} inputMode="decimal" value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} disabled={busy} />
          </Field>
        </div>
      </Card>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.footer}>
        <Button variant="primary" type="submit" loading={busy}>
          Enregistrer les modifications
        </Button>
        {unchanged ? (
          <p className={styles.info} role="status">
            Aucune modification
          </p>
        ) : null}
      </div>
    </form>
  )
}
