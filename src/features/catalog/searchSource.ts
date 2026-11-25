import layersIcon from '../../assets/icons/layers.svg'
import { supabase } from '../../lib/supabase'
import { GROUP_LIMIT, orIlike } from '../search/searchLogic'
import type { SearchResult, SearchSource } from '../search/types'
import { CLIENT_READ_ROLES } from '../auth/roles'
import { formatMoney } from '../../shared/billing'
import { LABELS, type LineUnit } from '../../shared/types'

interface Row {
  id: string
  name: string
  category: string | null
  unit: LineUnit
  unit_price_cents: number
  active: boolean
}

/**
 * Source Cmd+K « Prestations » : nom, catégorie ou description. Un résultat ouvre /catalog?service=<id>
 * (la page ouvre la fiche). À enregistrer avec `registerSearchSource(catalogSearchSource)`.
 */
export const catalogSearchSource: SearchSource = {
  id: 'services',
  label: 'Prestations',
  // Lecture du catalogue : toute l'organisation, mais la page /catalog est réservée à ces rôles.
  roles: CLIENT_READ_ROLES,
  order: 35,
  async search(query, ctx) {
    const outcome = await supabase
      .from('services')
      .select('id, name, category, unit, unit_price_cents, active')
      .eq('active', true)
      .or(orIlike(['name', 'category', 'description'], query))
      .order('position')
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
      subtitle: [row.category, `${formatMoney(row.unit_price_cents)} / ${LABELS.lineUnit[row.unit]}`].filter(Boolean).join(' · '),
      to: `/catalog?service=${row.id}`,
      icon: layersIcon,
    }))
  },
}
