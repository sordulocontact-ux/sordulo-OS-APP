import table from '../../components/ui/dataTable.module.css'
import { NotesWorkspace } from './NotesWorkspace'

/** Notes : perso ou équipe, rattachables à un projet et / ou un client, épinglées en tête. */
export function NotesPage() {
  return (
    <section className={table.page} aria-labelledby="notes-title">
      <h1 id="notes-title">Notes</h1>
      <NotesWorkspace />
    </section>
  )
}
