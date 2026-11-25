import { useId, useState } from 'react'
import { Button, Field, Select, TextInput } from '../../components/ui'
import { SKILL_LEVEL_MAX } from '../../shared/types'
import { CORE_SKILLS, normalizeSkillName, skillLabel, skillNameError, suggestSkills, type SkillRow } from './profileLogic'
import styles from './ProfileEditors.module.css'

const LEVELS = Array.from({ length: SKILL_LEVEL_MAX }, (_, i) => i + 1)

export interface SkillsEditorProps {
  rows: SkillRow[]
  onChange: (rows: SkillRow[]) => void
  disabled?: boolean
}

/** Compétences ouvertes : design et dev toujours là, les autres s'ajoutent par leur nom (suggestions) et se retirent. */
export function SkillsEditor({ rows, onChange, disabled }: SkillsEditorProps) {
  const listId = useId()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const names = rows.map((r) => r.name)

  function add() {
    const problem = skillNameError(draft, names)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    onChange([...rows, { name: normalizeSkillName(draft), level: 3 }])
    setDraft('')
  }

  return (
    <fieldset className={styles.section} disabled={disabled}>
      <legend className={styles.sectionTitle}>Compétences</legend>
      <ul className={styles.rows}>
        {rows.map((row) => {
          const core = (CORE_SKILLS as readonly string[]).includes(row.name)
          return (
            <li key={row.name} className={styles.row}>
              <span className={styles.rowName}>{skillLabel(row.name)}</span>
              <Select
                className={styles.level}
                aria-label={`Niveau ${row.name}`}
                value={String(row.level)}
                onChange={(e) => onChange(rows.map((r) => (r.name === row.name ? { ...r, level: Number(e.target.value) } : r)))}
              >
                <option value="0">Ne pratique pas</option>
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} sur {SKILL_LEVEL_MAX}
                  </option>
                ))}
              </Select>
              {core ? null : (
                <Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((r) => r.name !== row.name))} aria-label={`Retirer ${row.name}`}>
                  Retirer
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className={styles.addRow}>
        <Field label="Ajouter une compétence" error={error}>
          <TextInput
            list={listId}
            value={draft}
            maxLength={40}
            placeholder="Motion, branding…"
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
      <datalist id={listId}>
        {suggestSkills(draft, names).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </fieldset>
  )
}
