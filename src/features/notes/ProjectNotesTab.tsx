import { useProjectContext } from '../projects/useProjectContext'
import { NotesWorkspace } from './NotesWorkspace'
import styles from './notes.module.css'

/** Onglet « Notes » de la page projet : notes rattachées au projet (nouvelles notes partagées avec l'équipe). */
export function ProjectNotesTab() {
  const { project } = useProjectContext()
  return (
    <section className={styles.tab} aria-label="Notes du projet">
      <NotesWorkspace fixedProjectId={project.id} fixedClientId={project.client_id} />
    </section>
  )
}
