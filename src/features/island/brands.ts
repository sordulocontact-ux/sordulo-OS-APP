/**
 * Marques des services d'appel : libellé, logo et couleur de l'île (icône, onde, minuteur).
 * Service inconnu (null) : icône d'appel générique et couleur `--island-call` (le jaune historique).
 * Les couleurs sont les tokens `--island-brand-<service>` de src/styles/tokens.css.
 */
import type { CSSProperties } from 'react'
import type { CallService } from '../../shared/desktop-contract'
import { BRAND_ICON_PATHS, BRAND_ICON_VIEWBOX } from './brandIcons'

export interface CallBrand {
  /** null : service inconnu (appel lancé à la main, app non reconnue). */
  service: CallService | null
  label: string
  /** Tracé plein du logo (viewBox 24), null : icône d'appel générique. */
  iconPath: string | null
  iconViewBox: string
  /** Token CSS de la couleur (`--island-brand-discord`, ou `--island-call` si inconnu). */
  token: string
}

/** Tous les services, dans l'ordre d'affichage du labo. */
export const CALL_SERVICES: readonly CallService[] = [
  'meet',
  'teams',
  'zoom',
  'discord',
  'slack',
  'whatsapp',
  'webex',
  'skype',
  'signal',
  'telegram',
  'facetime',
  'whereby',
  'jitsi',
]

const LABELS: Record<CallService, string> = {
  meet: 'Google Meet',
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  webex: 'Webex',
  skype: 'Skype',
  signal: 'Signal',
  telegram: 'Telegram',
  facetime: 'FaceTime',
  whereby: 'Whereby',
  jitsi: 'Jitsi',
}

/** Nom du token de couleur de l'île pour un service (`null` : couleur d'appel générique). */
export const CALL_TONE_VARIABLE = '--island-call-tone'
const DEFAULT_TOKEN = '--island-call'

export function callBrand(service: CallService | null | undefined): CallBrand {
  if (!service) {
    return { service: null, label: 'Appel', iconPath: null, iconViewBox: '0 0 16 16', token: DEFAULT_TOKEN }
  }
  const iconPath = BRAND_ICON_PATHS[service] ?? null
  return {
    service,
    label: LABELS[service],
    iconPath,
    iconViewBox: iconPath ? BRAND_ICON_VIEWBOX : '0 0 16 16',
    token: `--island-brand-${service}`,
  }
}

/** Style qui pose la couleur du service dans `--island-call-tone` (onde, minuteur, icône d'appel). */
export function callToneStyle(service: CallService | null | undefined): CSSProperties {
  const style: Record<string, string> = { [CALL_TONE_VARIABLE]: `var(${callBrand(service).token})` }
  return style as CSSProperties
}
