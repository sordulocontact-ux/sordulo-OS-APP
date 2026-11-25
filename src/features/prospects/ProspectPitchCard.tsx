import { useState } from 'react'
import { Button, Field, Modal, Textarea, useToast } from '../../components/ui'
import { pitchBlockerText } from './prospectLogic'
import type { Prospect } from '../../shared/types'
import styles from './prospects.module.css'

const PITCH_MAX = 10_000

export interface ProspectPitchCardProps {
  prospect: Prospect
  generating: boolean
  saving: boolean
  error: string | null
  onGenerate: () => void
  onSave: (pitch: string | null) => void
}

/** Argumentaire : généré à partir de l'audit et de l'offre, repris tel quel ou modifié, copié en un clic. */
export function ProspectPitchCard({ prospect, generating, saving, error, onGenerate, onSave }: ProspectPitchCardProps) {
  const toast = useToast()
  const [draft, setDraft] = useState(prospect.pitch ?? '')
  const [confirm, setConfirm] = useState(false)
  const dirty = draft.trim() !== (prospect.pitch ?? '').trim()
  const blocker = pitchBlockerText(prospect)
  const tooLong = draft.length > PITCH_MAX

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft)
      toast.success('Argumentaire copié')
    } catch {
      toast.error('Copie impossible : sélectionne le texte et copie-le à la main.')
    }
  }

  function generate() {
    // Régénérer écrase le texte : on le demande si l'argumentaire existe déjà.
    if (draft.trim() !== '') setConfirm(true)
    else onGenerate()
  }

  if (prospect.do_not_contact) {
    return (
      <section className={styles.section} aria-labelledby="prospect-pitch">
        <h2 id="prospect-pitch" className={styles.sectionTitle}>
          Argumentaire
        </h2>
        <p className={styles.muted}>Ce prospect s’oppose à tout nouveau contact : l’argumentaire est masqué.</p>
      </section>
    )
  }

  return (
    <section className={styles.section} aria-labelledby="prospect-pitch">
      <h2 id="prospect-pitch" className={styles.sectionTitle}>
        Argumentaire
      </h2>
      <Field
        label="Mail et points pour l’appel"
        hint={
          blocker
            ? `${blocker} Il se génère à partir de l’audit et de l’offre.`
            : 'Tu peux le reprendre tel quel dans ton mail ou ton appel, ou le modifier.'
        }
        error={tooLong ? `${PITCH_MAX} caractères au plus.` : null}
      >
        <Textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={generating} />
      </Field>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant={prospect.pitch ? 'secondary' : 'primary'} onClick={generate} loading={generating} disabled={blocker !== null}>
          {prospect.pitch ? 'Régénérer' : 'Générer l’argumentaire'}
        </Button>
        <Button variant="secondary" onClick={() => void copy()} disabled={draft.trim() === ''}>
          Copier
        </Button>
        <Button
          variant="primary"
          onClick={() => onSave(draft.trim() === '' ? null : draft.trim())}
          disabled={!dirty || tooLong}
          loading={saving}
        >
          Enregistrer mes modifications
        </Button>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Remplacer l’argumentaire ?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(false)
                onGenerate()
              }}
            >
              Régénérer
            </Button>
          </>
        }
      >
        <p>
          Le texte actuel
          {dirty ? ' (y compris tes modifications non enregistrées)' : ''} sera remplacé par un nouvel argumentaire.
        </p>
      </Modal>
    </section>
  )
}
