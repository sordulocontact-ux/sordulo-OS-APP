/**
 * Ordre des activités (prototype : RANK, sortedActs, stateOf).
 * L'épinglée passe devant ; sinon appel, progression, Claude, musique ; à rang égal, la plus récente.
 */
import type { Activity, ActivityKind, IslandState } from '../types'

export const ACTIVITY_RANK: Readonly<Record<ActivityKind, number>> = {
  meet: 1,
  progress: 2,
  agent: 3,
  multi: 3,
  music: 4,
}

/** Activités triées : la première est la principale (île), la deuxième la secondaire (bulle). */
export function sortActivities(activities: Iterable<Activity>, pinnedId: string | null): Activity[] {
  return [...activities].sort((a, b) => {
    if (a.id === pinnedId) return -1
    if (b.id === pinnedId) return 1
    return ACTIVITY_RANK[a.kind] - ACTIVITY_RANK[b.kind] || b.order - a.order
  })
}

/** État affiché pour une activité principale (repos s'il n'y en a pas). */
export function stateOfActivity(activity: Activity | null): IslandState {
  return activity ? activity.kind : 'repos'
}
