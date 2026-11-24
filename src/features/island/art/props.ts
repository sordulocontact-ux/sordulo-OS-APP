/**
 * Accessoire d'un Claude selon ce que fait sa session (outil en cours), partagé par le Claude de l'île et ceux
 * du jardin : feuille (lit), dossier (fouille), crayon et carnet (écrit), clavier et invite (commande), loupe
 * (web), engrenages (réfléchit).
 */
import type { ClaudeActivity } from '../types'

export type GardenProp = 'paper' | 'folder' | 'pencil' | 'keyboard' | 'lens' | 'thought'

/** Jardin : un sous-agent qui tourne (ses petits Claude sont déjà là) ou une activité inconnue : il réfléchit. */
export function activityProp(activity: ClaudeActivity | null | undefined): GardenProp {
  switch (activity) {
    case 'read':
      return 'paper'
    case 'search':
      return 'folder'
    case 'write':
      return 'pencil'
    case 'command':
      return 'keyboard'
    case 'web':
      return 'lens'
    default:
      return 'thought'
  }
}
