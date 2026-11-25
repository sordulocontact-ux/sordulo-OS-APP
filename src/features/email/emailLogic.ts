/** Logique pure de la page Email : choix du projet où coller un mail client, contenu de présentation. */
import type { Client, Project } from '../../shared/types'

type ProjectLike = Pick<Project, 'id' | 'name' | 'status'> & { client: Pick<Client, 'name'> | null }

export interface ProjectChoice {
  id: string
  label: string
}

/** « Ibé · App Ibé », triés par libellé ; les projets terminés ou payés passent après les autres. */
export function projectChoices(projects: readonly ProjectLike[]): ProjectChoice[] {
  const closed = new Set<string>(['delivered', 'paid', 'archived'])
  return projects
    .map((project) => ({
      id: project.id,
      label: project.client ? `${project.client.name} · ${project.name}` : project.name,
      closed: closed.has(project.status),
    }))
    .sort((a, b) => Number(a.closed) - Number(b.closed) || a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
    .map(({ id, label }) => ({ id, label }))
}

export interface EmailPromise {
  title: string
  text: string
}

/** Ce que fera la boîte mail une fois Gmail relié. */
export const EMAIL_PROMISES: readonly EmailPromise[] = [
  { title: 'Trier les mails clients par projet', text: 'Chaque message rejoint le projet et le client concernés, sans copier-coller.' },
  { title: 'Transformer un retour en tickets', text: 'Un mail de retour devient une entrée : l\'IA propose les tickets, vous validez.' },
  { title: 'Envoyer les relances', text: 'Les relances de devis et de factures partent depuis l\'app, dans le ton du projet.' },
]
