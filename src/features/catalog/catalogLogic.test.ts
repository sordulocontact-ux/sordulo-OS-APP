import { describe, expect, it } from 'vitest'
import type { DocumentLine, Service } from '../../shared/types'
import {
  countTaskTemplates,
  draftFromService,
  emptyServiceDraft,
  filterServices,
  insertCatalogLines,
  nextServicePosition,
  parseEstimate,
  removeTaskDraft,
  serviceCategories,
  servicePayload,
  snapEstimate,
  taskTemplatesFromDrafts,
  ticketsToValidateText,
  validateServiceDraft,
  validateTaskDrafts,
  type TaskTemplateDraft,
} from './catalogLogic'

const ORG = { default_daily_rate: 500, default_hourly_rate: 70, default_vat_rate: 20 }

function service(patch: Partial<Service> = {}): Service {
  return {
    id: 's1',
    organization_id: 'o1',
    name: 'Site vitrine',
    description: null,
    category: 'Web',
    unit: 'flat',
    unit_price_cents: 300000,
    vat_rate: 20,
    lines: [],
    task_templates: [],
    active: true,
    position: 0,
    created_at: '',
    updated_at: '',
    ...patch,
  }
}

function line(label: string, patch: Partial<DocumentLine> = {}): DocumentLine {
  return { label, description: null, quantity: 1, unit: 'day', unit_price_cents: 50000, vat_rate: 20, ...patch }
}

function task(title: string, dependsOn: number | null = null): TaskTemplateDraft {
  return { title, skill: 'dev', estimate: '', dependsOn }
}

describe('parseEstimate', () => {
  it('accepte vide, entiers, virgule et pas de 0,25', () => {
    expect(parseEstimate('')).toEqual({ ok: true, value: null })
    expect(parseEstimate('2')).toEqual({ ok: true, value: 2 })
    expect(parseEstimate('1,25')).toEqual({ ok: true, value: 1.25 })
    expect(parseEstimate('0.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseEstimate('0')).toEqual({ ok: true, value: 0 })
  })
  it('refuse les pas non multiples de 0,25, le texte et l’excès', () => {
    expect(parseEstimate('1,3').ok).toBe(false)
    expect(parseEstimate('abc').ok).toBe(false)
    expect(parseEstimate('-1').ok).toBe(false)
    expect(parseEstimate('1001').ok).toBe(false)
  })
  it('snapEstimate arrondit au quart d’heure', () => {
    expect(snapEstimate(1.1)).toBe(1)
    expect(snapEstimate(1.2)).toBe(1.25)
    expect(snapEstimate(-3)).toBe(0)
  })
})

describe('tâches types', () => {
  it('retirer une tâche recale les dépendances', () => {
    const tasks = [task('a'), task('b', 0), task('c', 1), task('d', 2)]
    const result = removeTaskDraft(tasks, 1)
    expect(result.map((t) => t.title)).toEqual(['a', 'c', 'd'])
    // c dépendait de b (retirée) : levée ; d dépendait de c (2 → 1).
    expect(result.map((t) => t.dependsOn)).toEqual([null, null, 1])
  })

  it('valide titre, durée et dépendance', () => {
    const errors = validateTaskDrafts([
      task(' '),
      { ...task('ok'), estimate: '1,3' },
      task('self', 2),
      task('hors', 9),
    ])
    expect(errors[0]?.title).toBeDefined()
    expect(errors[1]?.estimate).toBeDefined()
    expect(errors[2]?.dependsOn).toBeDefined()
    expect(errors[3]?.dependsOn).toBeDefined()
  })

  it('refuse une boucle de dépendances', () => {
    const errors = validateTaskDrafts([task('a', 1), task('b', 0), task('c')])
    expect(errors[0]?.dependsOn).toMatch(/boucle/)
    expect(errors[1]?.dependsOn).toMatch(/boucle/)
    expect(errors[2]).toEqual({})
  })

  it('accepte une chaîne sans boucle', () => {
    expect(validateTaskDrafts([task('a'), task('b', 0), task('c', 1)])).toEqual([{}, {}, {}])
  })

  it('convertit en TaskTemplate', () => {
    expect(taskTemplatesFromDrafts([{ title: ' Maquette ', skill: 'design', estimate: '3,5', dependsOn: null }])).toEqual([
      { title: 'Maquette', skill: 'design', estimate_hours: 3.5, depends_on: null },
    ])
  })
})

describe('formulaire de prestation', () => {
  it('un brouillon neuf demande un nom, pas de prix', () => {
    const errors = validateServiceDraft(emptyServiceDraft(ORG, 3))
    expect(errors.name).toBeDefined()
    expect(errors.price).toBeUndefined()
    expect(errors.vat).toBeUndefined()
    expect(errors.any).toBe(true)
  })

  it('aller-retour service → brouillon → colonnes', () => {
    const s = service({
      description: 'Desc',
      lines: [line('Design', { service_id: 'x', rebilled: true })],
      task_templates: [{ title: 'Intégrer', skill: 'dev', estimate_hours: 4, depends_on: null }],
      position: 2,
    })
    const draft = draftFromService(s)
    expect(validateServiceDraft(draft).any).toBe(false)
    const payload = servicePayload(draft)
    expect(payload).toMatchObject({ name: 'Site vitrine', unit_price_cents: 300000, vat_rate: 20, position: 2, category: 'Web' })
    expect(payload.task_templates).toEqual(s.task_templates)
    // service_id retiré des lignes types, rebilled gardé.
    expect(payload.lines[0]).toEqual({
      label: 'Design',
      description: null,
      quantity: 1,
      unit: 'day',
      unit_price_cents: 50000,
      vat_rate: 20,
      rebilled: true,
    })
  })

  it('signale prix, TVA, ordre, lignes et tâches invalides', () => {
    const draft = { ...emptyServiceDraft(ORG, 0), name: 'X', price: 'abc', vat: '150', position: '-1', lines: [line('')], tasks: [task('')] }
    const errors = validateServiceDraft(draft)
    expect(errors.price).toBeDefined()
    expect(errors.vat).toBeDefined()
    expect(errors.position).toBeDefined()
    expect(errors.lines).toBeDefined()
    expect(errors.tasks?.[0]?.title).toBeDefined()
  })
})

describe('liste', () => {
  const list = [
    service({ id: 'a', name: 'Logo', category: 'Branding', position: 2 }),
    service({ id: 'b', name: 'Site', category: 'web', position: 1, description: 'Éco-conçu' }),
    service({ id: 'c', name: 'Ancien', category: 'Web', position: 0, active: false }),
  ]
  it('trie par ordre puis nom et filtre', () => {
    expect(filterServices(list, { query: '', category: '', status: '' }).map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(filterServices(list, { query: '', category: '', status: 'active' }).map((s) => s.id)).toEqual(['b', 'a'])
    expect(filterServices(list, { query: '', category: '', status: 'archived' }).map((s) => s.id)).toEqual(['c'])
    expect(filterServices(list, { query: 'eco', category: '', status: '' }).map((s) => s.id)).toEqual(['b'])
    expect(filterServices(list, { query: '', category: 'WEB', status: '' }).map((s) => s.id)).toEqual(['c', 'b'])
  })
  it('catégories sans doublon de casse, position suivante', () => {
    expect(serviceCategories(list)).toEqual(['Branding', 'web'])
    expect(nextServicePosition(list)).toBe(3)
    expect(nextServicePosition([])).toBe(0)
  })
})

describe('insertCatalogLines', () => {
  it('ajoute une ligne bâtie sur le prix quand la prestation n’a pas de lignes types', () => {
    const result = insertCatalogLines([line('Existante')], [service({ description: 'D' })])
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ label: 'Site vitrine', description: 'D', quantity: 1, unit: 'flat', unit_price_cents: 300000, service_id: 's1' })
  })

  it('reprend les lignes types, service_id sur la première seulement, rebilled gardé', () => {
    const s = service({ lines: [line('Design'), line('Frais', { rebilled: true })] })
    const result = insertCatalogLines([], [s])
    expect(result.map((l) => l.service_id)).toEqual(['s1', null])
    expect(result[1]?.rebilled).toBe(true)
  })

  it('plusieurs prestations dans l’ordre du choix, sans modifier les lignes existantes', () => {
    const existing = [line('A')]
    const result = insertCatalogLines(existing, [service({ id: 'x', name: 'X' }), service({ id: 'y', name: 'Y' })])
    expect(result.map((l) => l.label)).toEqual(['A', 'X', 'Y'])
    expect(existing).toHaveLength(1)
  })
})

describe('countTaskTemplates', () => {
  const withTasks = service({
    id: 't',
    task_templates: [
      { title: 'a', skill: 'dev', estimate_hours: null, depends_on: null },
      { title: 'b', skill: 'design', estimate_hours: 1, depends_on: 0 },
    ],
  })
  const without = service({ id: 'n' })
  it('compte un ticket par ligne portant une prestation avec des tâches types', () => {
    const lines = [line('1', { service_id: 't' }), line('2', { service_id: 'n' }), line('3'), line('4', { service_id: 't' }), line('5', { service_id: 'inconnue' })]
    expect(countTaskTemplates(lines, [withTasks, without])).toEqual({ tickets: 2, tasks: 4 })
  })
  it('zéro sans prestation', () => {
    expect(countTaskTemplates([line('x')], [withTasks])).toEqual({ tickets: 0, tasks: 0 })
  })
  it('texte au singulier et au pluriel', () => {
    expect(ticketsToValidateText(1)).toBe('1 ticket à valider')
    expect(ticketsToValidateText(3)).toBe('3 tickets à valider')
  })
})
