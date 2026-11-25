import fileTextIcon from '../../assets/icons/file-text.svg'
import { supabase } from '../../lib/supabase'
import { LABELS, type Contract } from '../../shared/types'
import { containsPattern } from '../search/searchLogic'
import type { SearchResult, SearchSource } from '../search/types'

const GROUP_LIMIT = 5

/** Source Cmd+K « Contrats » : titre du contrat ; admin, membre et finance. */
export const contractsSearchSource: SearchSource = {
  id: 'contracts',
  label: 'Contrats',
  roles: ['admin', 'finance'],
  order: 45,
  async search(query, ctx) {
    const outcome = await supabase
      .from('contracts')
      .select('id, title, status, client:clients(name)')
      .ilike('title', containsPattern(query))
      .order('created_at', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<(Pick<Contract, 'id' | 'title' | 'status'> & { client: { name: string } | null })[], { merge: false }>()
    if (ctx.signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
    if (outcome.error) throw new Error(outcome.error.message)
    return (outcome.data ?? []).map<SearchResult>((row) => ({
      id: row.id,
      title: row.title,
      subtitle: [LABELS.contractStatus[row.status], row.client?.name].filter(Boolean).join(' · '),
      to: `/contracts/${row.id}`,
      icon: fileTextIcon,
    }))
  },
}
