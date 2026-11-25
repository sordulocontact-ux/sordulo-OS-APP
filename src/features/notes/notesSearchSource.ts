import penFileIcon from '../../assets/icons/pen-file.svg'
import { supabase } from '../../lib/supabase'
import { LABELS, type Note } from '../../shared/types'
import { ALL_ROLES } from '../auth/roles'
import { GROUP_LIMIT, orIlike } from '../search/searchLogic'
import type { SearchResult, SearchSource } from '../search/types'
import { formatNoteDate, noteTitle } from './noteLogic'

type Row = Pick<Note, 'id' | 'title' | 'body' | 'visibility' | 'updated_at'>

/**
 * Source Cmd+K « Notes » : titre ou contenu. La RLS ne renvoie que les notes perso de l'utilisateur et les
 * notes d'équipe qu'il peut lire (l'apporteur : ses notes perso). Un résultat ouvre /notes?note=<id>.
 * À enregistrer avec `registerSearchSource(notesSearchSource)`.
 */
export const notesSearchSource: SearchSource = {
  id: 'notes',
  label: 'Notes',
  roles: ALL_ROLES,
  order: 60,
  async search(query, ctx) {
    const outcome = await supabase
      .from('notes')
      .select('id, title, body, visibility, updated_at')
      .or(orIlike(['title', 'body'], query))
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<Row[], { merge: false }>()
    // Saisie changée entre-temps : la requête est abandonnée, ce n'est pas une erreur.
    if (ctx.signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
    if (outcome.error) throw new Error(outcome.error.message)
    return (outcome.data ?? []).map<SearchResult>((row) => ({
      id: row.id,
      title: noteTitle(row),
      subtitle: [LABELS.noteVisibility[row.visibility], formatNoteDate(row.updated_at)].join(' · '),
      to: `/notes?note=${row.id}`,
      icon: penFileIcon,
    }))
  },
}
