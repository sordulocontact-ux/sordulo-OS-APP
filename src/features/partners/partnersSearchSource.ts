import handshakeIcon from '../../assets/icons/handshake.svg'
import { supabase } from '../../lib/supabase'
import type { Partner } from '../../shared/types'
import { CLIENT_READ_ROLES } from '../auth/roles'
import { GROUP_LIMIT, orIlike } from '../search/searchLogic'
import type { SearchResult, SearchSource } from '../search/types'
import { partnerSubtitle } from './partnerLogic'

type Row = Pick<Partner, 'id' | 'name' | 'company' | 'city' | 'category' | 'archived_at'>

/**
 * Source Cmd+K « Réseau » : nom, société ou ville d'un partenaire (archivés exclus). Un résultat ouvre
 * /partners/<id>. À enregistrer avec `registerSearchSource(partnersSearchSource)`.
 */
export const partnersSearchSource: SearchSource = {
  id: 'partners',
  label: 'Réseau',
  // Lecture du réseau : admin, membre, finance (l'apporteur n'y a pas accès, RLS comprise).
  roles: CLIENT_READ_ROLES,
  order: 38,
  async search(query, ctx) {
    const outcome = await supabase
      .from('partners')
      .select('id, name, company, city, category, archived_at')
      .is('archived_at', null)
      .or(orIlike(['name', 'company', 'city'], query))
      .order('name')
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<Row[], { merge: false }>()
    // Saisie changée entre-temps : la requête est abandonnée, ce n'est pas une erreur.
    if (ctx.signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
    if (outcome.error) throw new Error(outcome.error.message)
    return (outcome.data ?? []).map<SearchResult>((row) => ({
      id: row.id,
      title: row.name,
      subtitle: partnerSubtitle(row),
      to: `/partners/${row.id}`,
      icon: handshakeIcon,
    }))
  },
}
