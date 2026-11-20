/**
 * Glisser-déposer : « Dépose ici » (dragWake), puis les zones (dragOver). La flèche est un élément partagé.
 * Chaque zone porte `data-zone` pour le test de position (controller/sources/drop.ts). Les zones non proposées
 * (`drop.zones`) ne sont pas rendues du tout ; « Transcrire » affiche le projet qui recevra l'entrée.
 */
import { cx } from '../cx'
import { useLastNonNull } from '../hooks'
import { ClaudeIcon, IslandIcon, MicIcon } from '../icons'
import styles from '../Island.module.css'
import { Layer } from '../Layer'
import type { IslandDropInfo, IslandDropZone } from '../types'
import type { BaseLayerProps } from './CallLayers'

export function DragWakeLayer(base: BaseLayerProps) {
  return (
    <Layer {...base} state="dragWake" label="Dépose un fichier sur l’île">
      <span className={styles.dragHint}>Dépose ici</span>
    </Layer>
  )
}

const ZONE_ORDER: IslandDropZone[] = ['transcribe', 'files', 'claude']

function ZoneContent({ zone, projectName }: { zone: IslandDropZone; projectName: string | null }) {
  if (zone === 'transcribe') {
    return (
      <>
        <MicIcon />
        <b>Transcrire</b>
        <small>{projectName ?? 'Nouvelle entrée'}</small>
      </>
    )
  }
  if (zone === 'files') {
    return (
      <>
        <IslandIcon name="folder" />
        <b>Fichiers</b>
        <small>{projectName ?? 'Projet'}</small>
      </>
    )
  }
  return (
    <>
      <ClaudeIcon />
      <b>Claude Code</b>
      <small>Session en cours</small>
    </>
  )
}

export function DragOverLayer({
  drop,
  hotZone,
  ...base
}: BaseLayerProps & { drop: IslandDropInfo | null; hotZone: IslandDropZone | null }) {
  const shown = useLastNonNull(drop)
  const zones = ZONE_ORDER.filter((z) => shown?.zones[z])
  return (
    <Layer {...base} state="dragOver" role="region" label="Où envoyer le fichier">
      <span className={styles.dropName}>{shown?.fileName ?? 'Fichier'}</span>
      <div className={styles.zones}>
        {zones.length === 0 && <p className={styles.zonesEmpty}>Aucune zone ne peut recevoir ce fichier</p>}
        {zones.map((z) => (
          <div key={z} className={cx(styles.zone, hotZone === z && styles.zoneHot)} data-zone={z} data-hot={hotZone === z || undefined}>
            <ZoneContent zone={z} projectName={shown?.projectName ?? null} />
          </div>
        ))}
      </div>
    </Layer>
  )
}
