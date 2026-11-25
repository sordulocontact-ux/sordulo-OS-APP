import { describe, expect, it } from 'vitest'
import { groupByDue, nonEmptyGroups } from './myTasksLogic'

const today = '2026-11-25' // mercredi
const t = (id: string, due: string | null, priority: 'low' | 'medium' | 'high' = 'medium') => ({
  id, due_date: due, priority, status: 'todo' as const,
})

describe('groupByDue', () => {
  it('range chaque tâche dans son groupe', () => {
    const groups = groupByDue(
      [t('a', '2026-11-20'), t('b', '2026-11-25'), t('c', '2026-11-28'), t('d', '2026-12-10'), t('e', null)],
      today,
    )
    expect(groups.overdue.map((x) => x.id)).toEqual(['a'])
    expect(groups.today.map((x) => x.id)).toEqual(['b'])
    expect(groups.week.map((x) => x.id)).toEqual(['c'])
    expect(groups.later.map((x) => x.id)).toEqual(['d'])
    expect(groups.none.map((x) => x.id)).toEqual(['e'])
  })
  it('trie dans le groupe par échéance puis priorité', () => {
    const groups = groupByDue([t('a', '2026-11-27', 'low'), t('b', '2026-11-26', 'low'), t('c', '2026-11-27', 'high')], today)
    expect(groups.week.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })
  it('nonEmptyGroups garde l\'ordre et saute les vides', () => {
    const groups = groupByDue([t('a', null), t('b', '2026-11-01')], today)
    expect(nonEmptyGroups(groups).map((g) => g.label)).toEqual(['En retard', 'Sans échéance'])
  })
})
