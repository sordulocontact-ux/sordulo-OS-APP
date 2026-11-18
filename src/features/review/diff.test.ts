import { describe, expect, it } from 'vitest'
import type { Member, Task, Ticket } from '../../shared/types'
import {
  type TaskDraft,
  changeTaskSkill,
  hasChanges,
  makeNewTaskDraft,
  makeTicketDraft,
  nextPosition,
  planSave,
  validateDraft,
} from './diff'

const members: Pick<Member, 'id' | 'name' | 'skills'>[] = [
  { id: 'mael', name: 'Maël', skills: { dev: 5, design: 2 } },
  { id: 'sacha', name: 'Sacha', skills: { design: 5, dev: 1 } },
]

const ticket: Ticket = {
  id: 't1',
  organization_id: 'o',
  project_id: 'p',
  input_id: 'i',
  title: 'Bouton',
  description: 'desc',
  type: 'modification',
  priority: 'medium',
  source_quote: null,
  status: 'proposed',
  related_ticket_id: null,
  created_at: '2026-11-18T10:00:00Z',
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    organization_id: 'o',
    project_id: 'p',
    ticket_id: 't1',
    title: `Tâche ${id}`,
    skill: 'design',
    estimate_hours: 2,
    assignee_member_id: 'sacha',
    status: 'todo',
    depends_on_task_id: null,
    position: 0,
    created_at: '2026-11-18T10:00:00Z',
    ...over,
  }
}

function at(list: TaskDraft[], index: number): TaskDraft {
  const item = list[index]
  if (!item) throw new Error('missing draft task')
  return item
}

const tasks = [task('a', { position: 0 }), task('b', { skill: 'dev', assignee_member_id: 'mael', depends_on_task_id: 'a', position: 1 })]

describe('planSave', () => {
  it('is empty when nothing changed', () => {
    const draft = makeTicketDraft(ticket, tasks)
    const plan = planSave(ticket, tasks, draft, { startPosition: 2 })
    expect(plan).toEqual({ ticketPatch: {}, taskUpdates: [], taskInserts: [], taskDeletes: [] })
    expect(hasChanges(ticket, tasks, draft)).toBe(false)
  })

  it('detects a modified task and a modified ticket', () => {
    const draft = makeTicketDraft(ticket, tasks)
    draft.title = '  Nouveau titre '
    draft.tasks[0] = { ...at(draft.tasks, 0), title: 'Maquette', estimate: '3,5' }
    const plan = planSave(ticket, tasks, draft, { startPosition: 2, status: 'validated' })
    expect(plan.ticketPatch).toEqual({ title: 'Nouveau titre', status: 'validated' })
    expect(plan.taskUpdates).toEqual([{ id: 'a', patch: { title: 'Maquette', estimate_hours: 3.5 } }])
    expect(hasChanges(ticket, tasks, draft)).toBe(true)
  })

  it('inserts added tasks with consecutive positions and todo status', () => {
    const draft = makeTicketDraft(ticket, tasks)
    draft.tasks.push({ ...makeNewTaskDraft('new-1', members), title: 'Intégration', estimate: '1' })
    draft.tasks.push({ ...makeNewTaskDraft('new-2', members), title: 'Tests' })
    const plan = planSave(ticket, tasks, draft, { startPosition: nextPosition(tasks) })
    expect(plan.taskInserts).toEqual([
      {
        project_id: 'p',
        ticket_id: 't1',
        title: 'Intégration',
        skill: 'dev',
        estimate_hours: 1,
        assignee_member_id: 'mael',
        status: 'todo',
        depends_on_task_id: null,
        position: 2,
      },
      expect.objectContaining({ title: 'Tests', estimate_hours: null, position: 3 }),
    ])
  })

  it('deletes removed tasks and clears dependencies on them', () => {
    const draft = makeTicketDraft(ticket, tasks)
    draft.tasks = draft.tasks.filter((t) => t.id !== 'a')
    const plan = planSave(ticket, tasks, draft, { startPosition: 2 })
    expect(plan.taskDeletes).toEqual(['a'])
    expect(plan.taskUpdates).toEqual([{ id: 'b', patch: { depends_on_task_id: null } }])
  })

  it('re-assigns a task when its skill changes', () => {
    const draft = makeTicketDraft(ticket, tasks)
    draft.tasks[0] = changeTaskSkill(at(draft.tasks, 0), 'dev', members)
    expect(at(draft.tasks, 0).assigneeId).toBe('mael')
    const plan = planSave(ticket, tasks, draft, { startPosition: 2 })
    expect(plan.taskUpdates).toEqual([{ id: 'a', patch: { skill: 'dev', assignee_member_id: 'mael' } }])
  })
})

describe('validateDraft', () => {
  it('rejects empty titles and invalid estimates, accepts empty estimate', () => {
    const draft = makeTicketDraft(ticket, tasks)
    expect(validateDraft(draft).valid).toBe(true)
    draft.title = ' '
    draft.tasks[0] = { ...at(draft.tasks, 0), title: '', estimate: '-1' }
    draft.tasks[1] = { ...at(draft.tasks, 1), estimate: '' }
    const errors = validateDraft(draft)
    expect(errors.valid).toBe(false)
    expect(errors.title).toBeDefined()
    expect(errors.tasks.a?.title).toBeDefined()
    expect(errors.tasks.a?.estimate).toBeDefined()
    expect(errors.tasks.b).toBeUndefined()
  })
})
