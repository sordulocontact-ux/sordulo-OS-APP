import { Badge } from '../../components/ui'

/** Étoile des tickets issus d'un moment marqué pendant l'appel (tickets.from_marker). */
export function MarkerBadge() {
  return (
    <Badge tone="warning" title="Issu d'un moment marqué pendant l'appel">
      <span aria-hidden="true">★ Moment marqué</span>
      <span className="visually-hidden">Issu d'un moment marqué</span>
    </Badge>
  )
}
