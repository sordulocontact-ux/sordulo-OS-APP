import { useState } from 'react'
import { Button, Field, Modal, Select } from '../../components/ui'
import type { UploadPlan } from './fileLogic'
import styles from './files.module.css'

export type ConflictAction = 'skip' | 'anyway' | 'version' | 'separate'

export interface UploadConflict {
  id: string
  file: File
  sha256: string
  plan: Exclude<UploadPlan, { type: 'new' }>
}

export interface UploadConflictModalProps {
  conflicts: readonly UploadConflict[]
  busy: boolean
  onConfirm: (decisions: Map<string, ConflictAction>) => void
  onCancel: () => void
}

function defaultAction(conflict: UploadConflict): ConflictAction {
  return conflict.plan.type === 'version' ? 'version' : 'skip'
}

/** Doublons (même empreinte) et noms proches signalés avant l'envoi : chaque fichier a sa décision. */
export function UploadConflictModal({ conflicts, busy, onConfirm, onCancel }: UploadConflictModalProps) {
  const [decisions, setDecisions] = useState<Map<string, ConflictAction>>(() => new Map())

  const choose = (conflict: UploadConflict) => decisions.get(conflict.id) ?? defaultAction(conflict)

  return (
    <Modal
      open={conflicts.length > 0}
      onClose={onCancel}
      title="Avant d’envoyer"
      dismissible={!busy}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Tout ignorer
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => onConfirm(new Map(conflicts.map((conflict) => [conflict.id, choose(conflict)])))}
          >
            Envoyer
          </Button>
        </>
      }
    >
      <ul className={styles.conflicts}>
        {conflicts.map((conflict) => (
          <li key={conflict.id} className={styles.conflict}>
            <p className={styles.conflictText}>
              {conflict.plan.type === 'duplicate' ? (
                <>
                  <strong>{conflict.file.name}</strong> est identique à « {conflict.plan.file.name} », déjà dans le projet.
                </>
              ) : (
                <>
                  <strong>{conflict.file.name}</strong> ressemble à « {conflict.plan.file.name} » (V{conflict.plan.file.version}).
                </>
              )}
            </p>
            <Field label="Que faire ?">
              <Select
                value={choose(conflict)}
                onChange={(event) => setDecisions((current) => new Map(current).set(conflict.id, event.target.value as ConflictAction))}
              >
                {conflict.plan.type === 'duplicate' ? (
                  <>
                    <option value="skip">Ne pas envoyer</option>
                    <option value="anyway">Envoyer quand même</option>
                  </>
                ) : (
                  <>
                    <option value="version">Nouvelle version de « {conflict.plan.file.name} »</option>
                    <option value="separate">Fichier séparé</option>
                    <option value="skip">Ne pas envoyer</option>
                  </>
                )}
              </Select>
            </Field>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
