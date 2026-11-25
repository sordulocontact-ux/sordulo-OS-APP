import { useState } from 'react'
import { Button, Field, TextInput } from '../../components/ui'
import { addAffinity } from './profileLogic'
import styles from './ProfileEditors.module.css'

export interface AffinitiesEditorProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

/** Affinités : étiquettes libres (« branding », « e-commerce »…). Elles départagent l'attribution, sans la décider. */
export function AffinitiesEditor({ value, onChange, disabled }: AffinitiesEditorProps) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const result = addAffinity(value, draft)
    setError(result.error)
    if (result.error === null) {
      onChange(result.list)
      setDraft('')
    }
  }

  return (
    <fieldset className={styles.section} disabled={disabled}>
      <legend className={styles.sectionTitle}>Affinités</legend>
      {value.length > 0 ? (
        <ul className={styles.tags}>
          {value.map((tag) => (
            <li key={tag} className={styles.tag}>
              {tag}
              <button type="button" className={styles.tagRemove} aria-label={`Retirer ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.addRow}>
        <Field label="Ajouter une affinité" hint="Ce que la personne préfère traiter : sert à départager à charge comparable." error={error}>
          <TextInput
            value={draft}
            maxLength={40}
            placeholder="Branding, e-commerce…"
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
        </Field>
        <Button onClick={add}>Ajouter</Button>
      </div>
    </fieldset>
  )
}
