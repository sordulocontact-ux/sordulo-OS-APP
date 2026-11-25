import type { MemberRole } from '../../shared/types'

/** Contexte passé à chaque source : rôle du membre, organisation et signal d'annulation. */
export interface SearchContext {
  role: MemberRole
  organizationId: string | null
  signal: AbortSignal
}

/** Une ligne de résultat. `to` est une route de l'app (ouverte avec React Router). */
export interface SearchResult {
  id: string
  title: string
  subtitle?: string
  to: string
  /** URL d'un SVG importé (`import usersIcon from '…/users.svg'`), peint dans la couleur du texte. */
  icon?: string
}

/** Un groupe de résultats (Clients, Projets, Devis…), alimenté par une source du registre. */
export interface SearchSource {
  /** Identifiant unique : enregistrer deux fois le même id remplace la source. */
  id: string
  /** Titre du groupe, au pluriel (« Clients »). */
  label: string
  /** Rôles autorisés à voir ce groupe. */
  roles: readonly MemberRole[]
  /** Ordre d'affichage des groupes (croissant). Défaut : ordre d'enregistrement après les sources initiales. */
  order?: number
  search: (query: string, ctx: SearchContext) => Promise<SearchResult[]>
}

/** Action rapide, proposée quand la saisie est vide. */
export interface QuickAction {
  id: string
  title: string
  subtitle?: string
  to: string
  icon?: string
  roles: readonly MemberRole[]
}

export interface SearchGroup {
  id: string
  label: string
  items: SearchResult[]
}

export interface HighlightPart {
  text: string
  match: boolean
}
