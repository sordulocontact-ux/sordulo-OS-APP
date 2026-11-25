/** Logique pure des commandes vocales (sans React ni navigateur) : textes, détails de la tâche, ligne à insérer. */
import { VOICE_ERRORS } from '../review/voiceNote'
import { LABELS, type Task } from '../../shared/types'
import type { VoiceTaskDraft } from '../../shared/ai/voiceCommand'

/** Appui plus long que ce délai : on parle tant que le bouton est maintenu, et le relâcher termine. */
export const PUSH_TO_TALK_MS = 400

export function isHold(pressedMs: number): boolean {
  return pressedMs >= PUSH_TO_TALK_MS
}

/** Messages du micro adaptés à une commande (ceux de la note vocale parlent de « taper la note »). */
const COMMAND_ERRORS: Record<keyof typeof VOICE_ERRORS, string> = {
  denied: 'Accès au micro refusé. Autorise le micro dans le navigateur, ou tape ta recherche.',
  noMicrophone: 'Aucun micro trouvé. Branche un micro, ou tape ta recherche.',
  unsupported: "Ce navigateur ne permet pas d'enregistrer le micro. Tape ta recherche.",
  busy: 'Le micro est déjà utilisé par une autre application. Ferme-la, puis réessaie.',
  tooLarge: 'Commande trop longue. Dis-la en une phrase.',
  empty: "Rien n'a été enregistré. Réessaie.",
  failed: "L'enregistrement a échoué. Réessaie.",
}

export function commandErrorMessage(message: string): string {
  const key = (Object.keys(VOICE_ERRORS) as (keyof typeof VOICE_ERRORS)[]).find((k) => VOICE_ERRORS[k] === message)
  return key ? COMMAND_ERRORS[key] : message
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** « 2026-11-27 » → « vendredi 27 novembre ». */
export function formatDueDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}

export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(hours)} h`
}

/** Lignes « libellé : valeur » de la carte de confirmation. */
export function taskDetails(task: VoiceTaskDraft): { label: string; value: string }[] {
  return [
    { label: 'Projet', value: task.projectName },
    { label: 'Compétence', value: LABELS.skill[task.skill] },
    { label: 'Priorité', value: LABELS.taskPriority[task.priority] },
    { label: 'Échéance', value: task.dueDate ? formatDueDate(task.dueDate) : 'Aucune' },
    { label: 'Estimation', value: task.estimateHours !== null ? formatHours(task.estimateHours) : 'Aucune' },
    { label: 'Attribuée à', value: task.assigneeName ?? 'Personne pour l’instant' },
  ]
}

export type VoiceTaskInsert = Pick<
  Task,
  'project_id' | 'title' | 'skill' | 'estimate_hours' | 'due_date' | 'priority' | 'assignee_member_id' | 'status' | 'position'
>

/** Ligne insérée par le client Supabase (organisation posée par la base à partir du projet), en fin de colonne. */
export function taskInsert(task: VoiceTaskDraft, lastPosition: number | null): VoiceTaskInsert {
  return {
    project_id: task.projectId,
    title: task.title,
    skill: task.skill,
    estimate_hours: task.estimateHours,
    due_date: task.dueDate,
    priority: task.priority,
    assignee_member_id: task.assigneeMemberId,
    status: 'todo',
    position: (lastPosition ?? 0) + 1,
  }
}
