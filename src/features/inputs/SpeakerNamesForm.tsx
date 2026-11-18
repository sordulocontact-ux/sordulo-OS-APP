import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field, TextInput, useToast } from '../../components/ui'
import { queryKeys } from '../../lib/queryKeys'
import { supabase } from '../../lib/supabase'
import type { Input, SpeakerNames } from '../../shared/types'
import styles from './SpeakerNamesForm.module.css'

export interface SpeakerNamesFormProps {
  input: Input
  /** Voice indexes found in the transcript, sorted. */
  speakers: number[]
}

export function SpeakerNamesForm({ input, speakers }: SpeakerNamesFormProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...input.speaker_names }))
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const speakerNames: SpeakerNames = {}
    for (const speaker of speakers) {
      const value = names[String(speaker)]?.trim()
      if (value) speakerNames[String(speaker)] = value
    }
    setSaving(true)
    const { error } = await supabase.from('inputs').update({ speaker_names: speakerNames }).eq('id', input.id)
    setSaving(false)
    if (error) {
      toast.error('Impossible d\'enregistrer les noms. Réessaie.')
      return
    }
    toast.success('Noms enregistrés.')
    await queryClient.invalidateQueries({ queryKey: queryKeys.input(input.id) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.inputs(input.project_id) })
  }

  return (
    <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
      <h3 className={styles.title}>Nommer les voix</h3>
      <p className={styles.help}>
        Les noms sont utilisés à l'affichage et lors de la prochaine analyse. Relance l'analyse pour que l'IA en tienne
        compte.
      </p>
      <div className={styles.fields}>
        {speakers.map((speaker) => (
          <Field key={speaker} label={`Voix ${speaker + 1}`}>
            <TextInput
              value={names[String(speaker)] ?? ''}
              placeholder={`Voix ${speaker + 1}`}
              onChange={(e) => setNames((prev) => ({ ...prev, [String(speaker)]: e.target.value }))}
              disabled={saving}
            />
          </Field>
        ))}
      </div>
      <div>
        <Button type="submit" variant="secondary" loading={saving}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}
