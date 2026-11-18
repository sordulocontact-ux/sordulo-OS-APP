/**
 * Task assignment, done by code (not by the AI): the member with the best level in the
 * requested skill gets the task. Shared by the API (proposed tickets) and the front
 * (validation screen, when the skill of a task is changed). No Node dependency.
 */
import type { Member, Skill } from './types.js'

export type AssignableMember = Pick<Member, 'id' | 'name' | 'skills'>

/** Level of a member in a skill. Missing or invalid level = 0. */
export function skillLevel(member: Pick<Member, 'skills'>, skill: Skill): number {
  const level = member.skills?.[skill]
  return typeof level === 'number' && Number.isFinite(level) ? level : 0
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Best member for a skill. Ties are broken deterministically: name, then id
 * (plain code-point order, independent of the runtime locale). `null` if there is no member.
 */
export function pickAssignee<T extends AssignableMember>(skill: Skill, members: readonly T[]): T | null {
  let best: T | null = null
  for (const member of members) {
    if (best === null) {
      best = member
      continue
    }
    const diff = skillLevel(member, skill) - skillLevel(best, skill)
    if (diff > 0) best = member
    else if (diff === 0) {
      const byName = compareText(member.name, best.name)
      if (byName < 0 || (byName === 0 && compareText(member.id, best.id) < 0)) best = member
    }
  }
  return best
}
