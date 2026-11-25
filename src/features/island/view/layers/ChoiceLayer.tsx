/**
 * Décision dans l'île (état `choice`) : composée comme « Transcrire cet appel ? » (AppelLayer). Icône teintée,
 * petite ligne, titre, puis la ligne des actions : case « Toujours » à gauche (facultative), bouton secondaire
 * (Modifier, Vérifier, Refuser) et bouton principal (Ranger, Tout ranger, Valider). Échap = plus tard (Island).
 * La case repart décochée à chaque nouvelle décision.
 */
import { useState } from 'react'
import type { ChoiceDecision, IslandChoice } from '../../types'
import { cx } from '../cx'
import { useLastNonNull } from '../hooks'
import { IslandIcon } from '../icons'
import styles from '../Island.module.css'
import { Layer } from '../Layer'
import { toneStyle } from '../tone'
import type { BaseLayerProps } from './CallLayers'

export function ChoiceLayer({
  choice,
  onChoiceDecision,
  ...base
}: BaseLayerProps & {
  choice: IslandChoice | null
  onChoiceDecision: (decision: ChoiceDecision, choice: IslandChoice, always: boolean) => void
}) {
  const shown = useLastNonNull(choice)
  // Case « Toujours » propre à chaque décision : décochée quand une autre arrive.
  const [checked, setChecked] = useState<{ id: string; on: boolean } | null>(null)
  const always = Boolean(shown?.always && checked?.id === shown.id && checked.on)
  const decide = (decision: ChoiceDecision) => {
    if (shown) onChoiceDecision(decision, shown, always)
  }
  return (
    <Layer
      {...base}
      state="choice"
      className={styles.layerAppel}
      role="dialog"
      label={shown ? `${shown.eyebrow} : ${shown.title}` : 'Décision'}
      replayKey={shown?.id ?? null}
    >
      <div className={styles.head}>
        <span className={styles.choiceIcon} style={shown ? toneStyle(shown.tone) : undefined} aria-hidden="true">
          {shown && <IslandIcon name={shown.icon} />}
        </span>
        <div className={styles.choiceText}>
          <small>{shown?.eyebrow}</small>
          <strong>{shown?.title}</strong>
        </div>
      </div>
      <div className={styles.appelRow}>
        {shown?.always ? (
          <label className={styles.choiceAlways} title={shown.always.hint}>
            <input
              type="checkbox"
              checked={always}
              onChange={(e) => setChecked({ id: shown.id, on: e.target.checked })}
              aria-label={`${shown.always.label} : ${shown.always.hint}`}
            />
            <span aria-hidden="true">{shown.always.label}</span>
          </label>
        ) : (
          <span className={styles.choiceSpacer} aria-hidden="true" />
        )}
        {shown?.secondary && (
          <button type="button" className={cx(styles.btn, styles.btnGhost)} onClick={() => decide('secondary')}>
            {shown.secondary}
          </button>
        )}
        <button type="button" className={cx(styles.btn, styles.btnMain)} onClick={() => decide('primary')}>
          {shown?.primary ?? 'Valider'}
        </button>
      </div>
    </Layer>
  )
}
