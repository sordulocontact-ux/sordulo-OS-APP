/**
 * Couleurs d'accent de l'île : chaque IslandTone correspond à un token `--island-*` de src/styles/tokens.css.
 * Le rendu pose la couleur dans la variable CSS `--island-tone` de l'élément, le CSS module la lit.
 */
import type { CSSProperties } from 'react'
import type { ActivityKind, IslandIconName, IslandTone, ProgressStage } from '../types'

export const TONE_TOKENS: Record<IslandTone, string> = {
  neutral: '--island-text',
  success: '--island-success',
  alert: '--island-alert',
  danger: '--island-danger',
  info: '--island-info',
  claude: '--island-claude',
  analysis: '--island-analysis',
  call: '--island-call',
}

/** `var(--island-…)` d'un ton. */
export function toneColor(tone: IslandTone): string {
  return `var(${TONE_TOKENS[tone]})`
}

/** Style qui pose la couleur du ton dans `--island-tone`. */
export function toneStyle(tone: IslandTone): CSSProperties {
  const style: Record<string, string> = { '--island-tone': toneColor(tone) }
  return style as CSSProperties
}

/** Icône et couleur d'une étape de progression (prototype : PROGS). */
export const PROGRESS_VISUALS: Record<ProgressStage, { icon: IslandIconName; tone: IslandTone }> = {
  upload: { icon: 'upload', tone: 'neutral' },
  analyse: { icon: 'sun', tone: 'analysis' },
  file: { icon: 'folder', tone: 'neutral' },
  deploy: { icon: 'cloud', tone: 'neutral' },
}

/** Nom d'une activité dans le libellé de la bulle (« Afficher l’appel dans l’île »), prototype : ACT_NAMES. */
export const ACTIVITY_NAMES: Record<ActivityKind, string> = {
  meet: 'l’appel',
  progress: 'la progression',
  agent: 'Claude',
  multi: 'les sessions Claude',
  music: 'la musique',
}
