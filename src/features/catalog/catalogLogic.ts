import {
  defaultLine,
  hasLineErrors,
  parseMoneyInput,
  parseVatRate,
  validateLines,
  moneyInputValue,
  formatQuantity,
} from '../../shared/billing'
import type { DocumentLine, LineUnit, Organization, Service, Skill, TaskTemplate } from '../../shared/types'

/** Pas de saisie de la durée estimée d'une tâche type, en heures. */
export const ESTIMATE_STEP = 0.25
/** Durée maximale d'une tâche type, en heures (garde-fou de saisie). */
export const ESTIMATE_MAX = 1000

export type OrgDefaults = Pick<Organization, 'default_daily_rate' | 'default_hourly_rate' | 'default_vat_rate'>

/* ---------- Tâches types ---------- */

/** Tâche type en cours d'édition : la durée est un texte tant qu'elle n'est pas validée. */
export interface TaskTemplateDraft {
  title: string
  skill: Skill
  estimate: string
  /** Index d'une autre tâche type de la liste, ou null. */
  dependsOn: number | null
}

export function emptyTaskDraft(): TaskTemplateDraft {
  return { title: '', skill: 'dev', estimate: '', dependsOn: null }
}

export function taskDraftsFromTemplates(templates: readonly TaskTemplate[]): TaskTemplateDraft[] {
  return templates.map((t) => ({
    title: t.title,
    skill: t.skill,
    estimate: t.estimate_hours === null ? '' : formatQuantity(t.estimate_hours),
    dependsOn: t.depends_on,
  }))
}

export type EstimateResult = { ok: true; value: number | null } | { ok: false; error: string }

/** Durée en heures : vide = non estimée, sinon un multiple de 0,25 entre 0 et 1000. Virgule ou point. */
export function parseEstimate(raw: string): EstimateResult {
  const text = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (text === '') return { ok: true, value: null }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, error: 'Durée invalide (ex. 1,5).' }
  const value = Number(text)
  if (value > ESTIMATE_MAX) return { ok: false, error: `Au plus ${ESTIMATE_MAX} heures.` }
  // Les flottants sont exacts pour les multiples de 0,25 : pas de tolérance à prévoir.
  if (Math.round(value / ESTIMATE_STEP) * ESTIMATE_STEP !== value) return { ok: false, error: 'Par pas de 0,25 heure (15 min).' }
  return { ok: true, value }
}

/** Arrondit une durée au pas de 0,25 le plus proche (boutons + / −). */
export function snapEstimate(hours: number): number {
  return Math.max(0, Math.min(ESTIMATE_MAX, Math.round(hours / ESTIMATE_STEP) * ESTIMATE_STEP))
}

/** Retire une tâche type et recale les dépendances : celles qui visaient la tâche retirée sont levées. */
export function removeTaskDraft(tasks: readonly TaskTemplateDraft[], index: number): TaskTemplateDraft[] {
  return tasks
    .filter((_, i) => i !== index)
    .map((t) => {
      if (t.dependsOn === null) return t
      if (t.dependsOn === index) return { ...t, dependsOn: null }
      return t.dependsOn > index ? { ...t, dependsOn: t.dependsOn - 1 } : t
    })
}

export interface TaskErrors {
  title?: string
  estimate?: string
  dependsOn?: string
}

/** Vrai si suivre les dépendances depuis `start` revient à `start` (boucle A → B → A). */
function inCycle(tasks: readonly TaskTemplateDraft[], start: number): boolean {
  const seen = new Set<number>()
  let current = tasks[start]?.dependsOn ?? null
  while (current !== null && !seen.has(current)) {
    if (current === start) return true
    seen.add(current)
    current = tasks[current]?.dependsOn ?? null
  }
  return false
}

/** Mêmes règles que `private.validate_task_templates` (titre, durée, dépendance valide), plus le refus des boucles. */
export function validateTaskDrafts(tasks: readonly TaskTemplateDraft[]): TaskErrors[] {
  return tasks.map((task, index) => {
    const errors: TaskErrors = {}
    const title = task.title.trim()
    if (title === '') errors.title = 'Indique un titre.'
    else if (title.length > 200) errors.title = '200 caractères au plus.'
    const estimate = parseEstimate(task.estimate)
    if (!estimate.ok) errors.estimate = estimate.error
    if (task.dependsOn !== null) {
      if (!Number.isInteger(task.dependsOn) || task.dependsOn < 0 || task.dependsOn >= tasks.length || task.dependsOn === index) {
        errors.dependsOn = 'Dépendance invalide.'
      } else if (inCycle(tasks, index)) {
        errors.dependsOn = 'Cette dépendance forme une boucle.'
      }
    }
    return errors
  })
}

export function hasTaskErrors(errors: readonly TaskErrors[]): boolean {
  return errors.some((e) => Object.keys(e).length > 0)
}

/** Tâches types à enregistrer. À n'appeler qu'avec des brouillons valides. */
export function taskTemplatesFromDrafts(tasks: readonly TaskTemplateDraft[]): TaskTemplate[] {
  return tasks.map((t) => {
    const estimate = parseEstimate(t.estimate)
    return {
      title: t.title.trim(),
      skill: t.skill,
      estimate_hours: estimate.ok ? estimate.value : null,
      depends_on: t.dependsOn,
    }
  })
}

/* ---------- Prestation : brouillon du formulaire ---------- */

export interface ServiceDraft {
  name: string
  category: string
  description: string
  unit: LineUnit
  price: string
  vat: string
  lines: DocumentLine[]
  tasks: TaskTemplateDraft[]
  active: boolean
  position: string
}

export function emptyServiceDraft(org: OrgDefaults, nextPosition: number): ServiceDraft {
  const line = defaultLine(org, 'flat')
  return {
    name: '',
    category: '',
    description: '',
    unit: 'flat',
    price: moneyInputValue(0),
    vat: formatQuantity(line.vat_rate),
    lines: [],
    tasks: [],
    active: true,
    position: String(nextPosition),
  }
}

export function draftFromService(service: Service): ServiceDraft {
  return {
    name: service.name,
    category: service.category ?? '',
    description: service.description ?? '',
    unit: service.unit,
    price: moneyInputValue(service.unit_price_cents),
    vat: formatQuantity(service.vat_rate),
    lines: service.lines,
    tasks: taskDraftsFromTemplates(service.task_templates),
    active: service.active,
    position: String(service.position),
  }
}

export interface ServiceErrors {
  name?: string
  category?: string
  description?: string
  price?: string
  vat?: string
  position?: string
  lines?: string
  tasks?: TaskErrors[]
  /** Vrai si au moins une erreur (champs, lignes ou tâches). */
  any: boolean
}

export function parsePosition(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d{1,6}$/.test(text)) return null
  return Number(text)
}

export function validateServiceDraft(draft: ServiceDraft): ServiceErrors {
  const errors: ServiceErrors = { any: false }
  const name = draft.name.trim()
  if (name === '') errors.name = 'Indique un nom.'
  else if (name.length > 200) errors.name = '200 caractères au plus.'
  if (draft.category.trim().length > 80) errors.category = '80 caractères au plus.'
  if (draft.description.trim().length > 4000) errors.description = '4 000 caractères au plus.'
  const price = parseMoneyInput(draft.price)
  if (!price.ok) errors.price = price.error
  else if (price.value < 0) errors.price = 'Le prix ne peut pas être négatif.'
  const vat = parseVatRate(draft.vat)
  if (!vat.ok) errors.vat = vat.error
  if (parsePosition(draft.position) === null) errors.position = 'Entier positif ou nul.'
  if (hasLineErrors(validateLines(draft.lines))) errors.lines = 'Corrige les lignes signalées.'
  const taskErrors = validateTaskDrafts(draft.tasks)
  if (hasTaskErrors(taskErrors)) errors.tasks = taskErrors
  errors.any = Object.keys(errors).some((k) => k !== 'any')
  return errors
}

/** Colonnes à écrire (sans organization_id). À n'appeler qu'avec un brouillon valide. */
export interface ServicePayload {
  name: string
  category: string | null
  description: string | null
  unit: LineUnit
  unit_price_cents: number
  vat_rate: number
  lines: DocumentLine[]
  task_templates: TaskTemplate[]
  active: boolean
  position: number
}

export function servicePayload(draft: ServiceDraft): ServicePayload {
  const price = parseMoneyInput(draft.price)
  const vat = parseVatRate(draft.vat)
  const category = draft.category.trim()
  const description = draft.description.trim()
  return {
    name: draft.name.trim(),
    category: category === '' ? null : category,
    description: description === '' ? null : description,
    unit: draft.unit,
    unit_price_cents: price.ok ? price.value : 0,
    vat_rate: vat.ok ? vat.value : 0,
    // Une ligne type ne porte jamais de service_id : il est posé à l'insertion dans un devis.
    lines: draft.lines.map<DocumentLine>((line) => ({
      label: line.label.trim(),
      description: line.description?.trim() || null,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_cents: line.unit_price_cents,
      vat_rate: line.vat_rate,
      ...(line.rebilled ? { rebilled: true } : {}),
    })),
    task_templates: taskTemplatesFromDrafts(draft.tasks),
    active: draft.active,
    position: parsePosition(draft.position) ?? 0,
  }
}

/* ---------- Liste ---------- */

export type ServiceStatusFilter = '' | 'active' | 'archived'

export const STATUS_FILTER_LABELS: Record<ServiceStatusFilter, string> = {
  '': 'Toutes',
  active: 'Actives',
  archived: 'Archivées',
}

export interface ServiceFilters {
  query: string
  category: string
  status: ServiceStatusFilter
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Catégories existantes, triées, sans doublon (casse et accents ignorés). */
export function serviceCategories(services: readonly Service[]): string[] {
  const byKey = new Map<string, string>()
  for (const s of services) {
    const category = s.category?.trim()
    if (category && !byKey.has(normalize(category))) byKey.set(normalize(category), category)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'fr'))
}

/** Recherche (nom, catégorie, description), catégorie et statut ; tri par ordre puis par nom. */
export function filterServices(services: readonly Service[], filters: ServiceFilters): Service[] {
  const query = normalize(filters.query)
  const category = normalize(filters.category)
  return services
    .filter((s) => {
      if (filters.status === 'active' && !s.active) return false
      if (filters.status === 'archived' && s.active) return false
      if (category && normalize(s.category ?? '') !== category) return false
      if (!query) return true
      return [s.name, s.category ?? '', s.description ?? ''].some((text) => normalize(text).includes(query))
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
}

export function nextServicePosition(services: readonly Service[]): number {
  return services.reduce((max, s) => Math.max(max, s.position), -1) + 1
}

/* ---------- Devis : insertion des lignes du catalogue ---------- */

/** Lignes qu'une prestation ajoute à un devis : ses lignes types, ou à défaut une ligne bâtie sur son prix. */
export function linesOfService(service: Service): DocumentLine[] {
  const base: DocumentLine[] =
    service.lines.length > 0
      ? service.lines
      : [
          {
            label: service.name,
            description: service.description,
            quantity: 1,
            unit: service.unit,
            unit_price_cents: service.unit_price_cents,
            vat_rate: service.vat_rate,
          },
        ]
  // service_id sur la première ligne seulement : le serveur crée un ticket par ligne qui le porte,
  // une prestation de trois lignes ne doit donner qu'un ticket.
  return base.map((line, i) => ({ ...line, service_id: i === 0 ? service.id : null }))
}

/** Ajoute à la fin d'un devis les lignes des prestations choisies (dans l'ordre du choix). */
export function insertCatalogLines(lines: readonly DocumentLine[], chosen: readonly Service[]): DocumentLine[] {
  return [...lines, ...chosen.flatMap(linesOfService)]
}

export interface TaskCount {
  /** Tickets que le serveur proposera : une ligne qui porte une prestation avec des tâches types. */
  tickets: number
  /** Tâches types correspondantes. */
  tasks: number
}

/** Compte ce que `propose_tasks_from_quote` créera pour ces lignes (même règle que la fonction SQL). */
export function countTaskTemplates(lines: readonly DocumentLine[], services: readonly Pick<Service, 'id' | 'task_templates'>[]): TaskCount {
  const byId = new Map(services.map((s) => [s.id, s]))
  let tickets = 0
  let tasks = 0
  for (const line of lines) {
    if (!line.service_id) continue
    const count = byId.get(line.service_id)?.task_templates.length ?? 0
    if (count === 0) continue
    tickets += 1
    tasks += count
  }
  return { tickets, tasks }
}

/** « 2 tickets à valider » / « 1 ticket à valider ». */
export function ticketsToValidateText(count: number): string {
  return `${count} ${count > 1 ? 'tickets' : 'ticket'} à valider`
}
