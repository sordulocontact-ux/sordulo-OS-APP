/**
 * Logique pure du rangement des fichiers déposés sur la zone « Ranger » de l'île : état de chaque fichier
 * d'un lot, ce que l'île annonce (plan), décisions (IslandChoice) et notifications du déroulé.
 * Ni React, ni Tauri, ni Supabase (types seulement) : testée dans filing.test.ts, utilisée par
 * controller/sources/filing.ts et par le labo.
 *
 * Après le classement d'un lot (startBatch de src/lib/filing.ts), chaque fichier est :
 * - auto : déjà rangé par une règle « Toujours » (intake filed, auto_filed) → « Rangé : … » + Annuler ;
 * - ready : l'IA est sûre (needsReview faux) → décision dans l'île, Ranger / Modifier / Toujours ;
 * - review : à vérifier dans l'app (projet à choisir, confiance faible, doublon, import à décider) ;
 * - error : envoi ou classement en échec → Réessayer.
 * Plan : les erreurs ont leur notification ; pour le reste, un fichier à vérifier envoie tout le lot dans l'app
 * (« À vérifier »), sinon un fichier sûr → décision Ranger, plusieurs → « N fichiers prêts à ranger »
 * (Tout ranger / Vérifier), sinon tout est rangé → « Rangé : … ».
 */
import type { BatchItem } from '../../../lib/filing'
import { REVIEW_REASON_LABELS, needsReview, proposalLabel, reviewReasons, type ReviewReason } from '../../../shared/filing'
import { type FileIntake, type FileKind, type FilingRule, type ProjectFile } from '../../../shared/types'
import { LONG_NOTIFICATION_MS, createNotification } from '../catalog'
import type { IslandChoice, IslandNotification, ProgressStage } from '../types'

// ---------------------------------------------------------------------------
// Routes de l'app principale (écran de rangement, lot L5b)
// ---------------------------------------------------------------------------

export function intakeRoute(intakeId: string): string {
  return `/files/intake/${intakeId}`
}

export function batchRoute(batchId: string): string {
  return `/files/inbox?batch=${encodeURIComponent(batchId)}`
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export const FILING_PROGRESS_ID = 'prog:filing'
/** Étape de progression du classement (icône dossier, voir PROGRESS_VISUALS). */
export const FILING_PROGRESS_STAGE = 'file' satisfies ProgressStage
/** Durée estimée du classement d'un fichier (envoi, texte, Claude), pour l'anneau avant le premier résultat. */
export const FILING_MS_PER_FILE = 9000

/** « Classement du fichier », « Classement de 3 fichiers », puis « Classement… 2 / 3 ». */
export function filingProgressLabel(done: number, total: number): string {
  if (done <= 0) return total <= 1 ? 'Classement du fichier' : `Classement de ${total} fichiers`
  return `Classement… ${Math.min(done, total)} / ${total}`
}

/** Anneau estimé : 3 fichiers classés en même temps (BATCH_CONCURRENCY). */
export function estimateFilingMs(total: number): number {
  return FILING_MS_PER_FILE * Math.max(1, Math.ceil(Math.max(1, total) / 3))
}

// ---------------------------------------------------------------------------
// État de chaque fichier d'un lot
// ---------------------------------------------------------------------------

export type FilingItemKind = 'auto' | 'ready' | 'review' | 'error'

export interface FilingItem {
  fileName: string
  kind: FilingItemKind
  /** null : l'envoi a échoué (rien n'a été créé). */
  intake: FileIntake | null
  /** Message en français (kind error). */
  error: string | null
  /** Pourquoi le vérifier (kind review). */
  reasons: readonly ReviewReason[]
}

/** Noms affichés : clients et projets par id. */
export interface FilingNames {
  clients: Readonly<Record<string, string>>
  projects: Readonly<Record<string, string>>
}

export const NO_NAMES: FilingNames = { clients: {}, projects: {} }

/** Résultat d'un fichier du lot → son état. Null : dépôt annulé entre-temps (on n'en parle plus). */
export function filingItemOf(item: Pick<BatchItem, 'outcome' | 'error'> & { file: { name: string } }): FilingItem | null {
  const fileName = item.file.name
  const outcome = item.outcome
  if (!outcome) {
    return { fileName, kind: 'error', intake: null, error: item.error ?? `Envoi de « ${fileName} » impossible.`, reasons: [] }
  }
  const { intake, classifyError } = outcome
  const name = intake.name || fileName
  if (intake.status === 'cancelled') return null
  if (classifyError || intake.status === 'error') {
    const error = classifyError ?? intake.error_message ?? 'Le classement a échoué.'
    return { fileName: name, kind: 'error', intake, error, reasons: [] }
  }
  if (intake.status === 'filed') return { fileName: name, kind: 'auto', intake, error: null, reasons: [] }
  if (needsReview(intake)) return { fileName: name, kind: 'review', intake, error: null, reasons: reviewReasons(intake) }
  return { fileName: name, kind: 'ready', intake, error: null, reasons: [] }
}

export function filingItemsOf(items: readonly Parameters<typeof filingItemOf>[0][]): FilingItem[] {
  return items.flatMap((item) => {
    const state = filingItemOf(item)
    return state ? [state] : []
  })
}

/** Ids des clients et projets à nommer (propositions des dépôts). */
export function idsToName(items: readonly FilingItem[]): { clientIds: string[]; projectIds: string[] } {
  const clients = new Set<string>()
  const projects = new Set<string>()
  for (const item of items) {
    const proposal = item.intake?.proposal
    if (proposal?.client_id) clients.add(proposal.client_id)
    if (proposal?.project_id) projects.add(proposal.project_id)
  }
  return { clientIds: [...clients], projectIds: [...projects] }
}

// ---------------------------------------------------------------------------
// Plan : ce que l'île annonce
// ---------------------------------------------------------------------------

export type FilingMain =
  | { type: 'none' }
  /** Tout est rangé par des règles « Toujours ». */
  | { type: 'auto'; items: readonly FilingItem[] }
  /** Un fichier sûr : décision Ranger / Modifier / Toujours. */
  | { type: 'readyOne'; item: FilingItem; auto: readonly FilingItem[] }
  /** Plusieurs fichiers sûrs : Tout ranger / Vérifier. */
  | { type: 'readyMany'; items: readonly FilingItem[]; auto: readonly FilingItem[] }
  /** Au moins un fichier à vérifier : le lot s'ouvre dans l'app. */
  | { type: 'review'; review: readonly FilingItem[]; ready: readonly FilingItem[]; auto: readonly FilingItem[] }

export interface FilingPlan {
  /** Fichiers en échec (notification avec Réessayer), vide sinon. */
  errors: readonly FilingItem[]
  main: FilingMain
}

export function planBatch(items: readonly FilingItem[]): FilingPlan {
  const of = (kind: FilingItemKind) => items.filter((item) => item.kind === kind)
  const errors = of('error')
  const auto = of('auto')
  const ready = of('ready')
  const review = of('review')
  let main: FilingMain
  if (review.length > 0) main = { type: 'review', review, ready, auto }
  else if (ready.length === 1 && ready[0]) main = { type: 'readyOne', item: ready[0], auto }
  else if (ready.length > 1) main = { type: 'readyMany', items: ready, auto }
  else if (auto.length > 0) main = { type: 'auto', items: auto }
  else main = { type: 'none' }
  return { errors, main }
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

const KIND_PLURAL: Record<FileKind, string> = {
  quote: 'devis',
  invoice: 'factures',
  contract: 'contrats',
  brief: 'briefs',
  mockup: 'maquettes',
  feedback: 'retours',
  deliverable: 'livrables',
  asset: 'ressources',
  other: 'documents',
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
}

/** « de Sordulo », « d’Ibé » (élision devant une voyelle). */
export function ofName(name: string): string {
  return /^[aeiouyàâäéèêëîïôöùûü]/iu.test(name) ? `d’${name}` : `de ${name}`
}

function clientNameOf(intake: FileIntake | null, names: FilingNames): string | null {
  const id = intake?.proposal?.client_id
  return id ? (names.clients[id] ?? null) : null
}

function projectNameOf(projectId: string | null | undefined, names: FilingNames): string | null {
  return projectId ? (names.projects[projectId] ?? null) : null
}

/** « Devis D-2026-012 · Ibé › App Ibé » ; sans proposition : le nom du fichier. */
export function itemLabel(item: FilingItem, names: FilingNames): string {
  const proposal = item.intake?.proposal
  if (!proposal) return item.fileName
  return proposalLabel(proposal, {
    clientName: clientNameOf(item.intake, names),
    projectName: projectNameOf(proposal.project_id, names),
  })
}

/** « App Ibé › Devis ». */
export function destinationLabel(projectName: string | null, folder: string): string {
  return projectName ? `${projectName} › ${folder}` : folder
}

/** « 2 rangés automatiquement » : rappel des fichiers déjà rangés du même lot, ou null. */
function autoNote(auto: readonly FilingItem[]): string | null {
  return auto.length > 0 ? `${plural(auto.length, 'rangé', 'rangés')} automatiquement` : null
}

// ---------------------------------------------------------------------------
// Décisions dans l'île
// ---------------------------------------------------------------------------

export const FILING_CHOICE_PREFIX = 'filing:'

export function singleChoiceId(intakeId: string): string {
  return `${FILING_CHOICE_PREFIX}${intakeId}`
}

export function batchChoiceId(batchId: string): string {
  return `${FILING_CHOICE_PREFIX}batch:${batchId}`
}

/**
 * Un fichier sûr : « Classé par l'IA · devis-ibe.pdf » (ou « Nouvelle version · … »), titre = libellé de la
 * proposition, case « Toujours » quand le client est connu (la règle est par client et type), Modifier, Ranger.
 */
export function readyChoice(item: FilingItem, names: FilingNames, auto: readonly FilingItem[] = []): IslandChoice {
  const intake = item.intake
  const proposal = intake?.proposal ?? null
  const client = clientNameOf(intake, names)
  const lead = proposal?.previous_version_file_id ? 'Nouvelle version' : 'Classé par l’IA'
  const note = autoNote(auto)
  return {
    id: singleChoiceId(intake?.id ?? item.fileName),
    icon: 'folder',
    tone: 'info',
    eyebrow: [lead, item.fileName, note].filter(Boolean).join(' · '),
    title: itemLabel(item, names),
    always:
      proposal && proposal.client_id
        ? {
            label: 'Toujours',
            hint: `Ranger seuls les prochains ${KIND_PLURAL[proposal.kind]} ${client ? ofName(client) : 'de ce client'}`,
          }
        : null,
    secondary: 'Modifier',
    primary: 'Ranger',
  }
}

/** Plusieurs fichiers sûrs : « 3 fichiers prêts à ranger », Vérifier (écran du lot), Tout ranger. */
export function readyManyChoice(
  items: readonly FilingItem[],
  batchId: string,
  names: FilingNames,
  auto: readonly FilingItem[] = [],
): IslandChoice {
  const projects = [...new Set(items.map((item) => projectNameOf(item.intake?.proposal?.project_id, names)).filter(Boolean))]
  const where = projects.length === 1 ? `Dans ${projects[0]}` : projects.length > 1 ? `${projects.length} projets` : 'Classés par l’IA'
  return {
    id: batchChoiceId(batchId),
    icon: 'folder',
    tone: 'info',
    eyebrow: [where, autoNote(auto)].filter(Boolean).join(' · '),
    title: `${items.length} fichiers prêts à ranger`,
    always: null,
    secondary: 'Vérifier',
    primary: 'Tout ranger',
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Rangés par des règles « Toujours » : « Rangé : Devis D-2026-012 · Ibé › App Ibé » ou « 3 fichiers rangés », Annuler. */
export function autoFiledNotification(items: readonly FilingItem[], names: FilingNames): IslandNotification {
  const [first] = items
  const ids = items.flatMap((item) => (item.intake ? [item.intake.id] : []))
  const single = items.length === 1 && first
  return createNotification('filing', {
    icon: 'check',
    tone: 'success',
    title: single ? `Rangé : ${itemLabel(first, names)}` : `${items.length} fichiers rangés`,
    subtitle: single
      ? `Automatiquement, dossier ${first.intake?.proposal?.folder ?? 'du projet'}`
      : 'Automatiquement, grâce à tes règles « Toujours »',
    button: 'Annuler',
    action: { type: 'undoFiling', intakeIds: ids, ruleIds: [] },
    durationMs: LONG_NOTIFICATION_MS,
  })
}

/** Au moins un fichier à vérifier, doublon compris : « À vérifier », bouton Vérifier (app principale). */
export function reviewNotification(
  main: Extract<FilingMain, { type: 'review' }>,
  batchId: string,
): IslandNotification {
  const { review, ready, auto } = main
  const [first] = review
  const single = review.length === 1 && ready.length === 0 && first?.intake
  const reason = first?.reasons.find((r) => r !== 'low_confidence') ?? first?.reasons[0] ?? null
  const reasonLabel = reason ? REVIEW_REASON_LABELS[reason] : 'À vérifier'
  const others = [ready.length > 0 ? `${ready.length} prêt${ready.length > 1 ? 's' : ''}` : null, autoNote(auto)].filter(Boolean)
  return createNotification('filing', {
    icon: 'folder',
    tone: 'alert',
    title: review.length === 1 && first ? `À vérifier : ${first.fileName}` : `À vérifier : ${review.length} fichiers`,
    subtitle: [review.length === 1 ? reasonLabel : null, ...others].filter(Boolean).join(', ') || reasonLabel,
    button: 'Vérifier',
    action: { type: 'openMain', route: single && first.intake ? intakeRoute(first.intake.id) : batchRoute(batchId) },
    durationMs: LONG_NOTIFICATION_MS,
  })
}

/** Envoi ou classement en échec : « Le classement a échoué », Réessayer (seulement les fichiers en échec). */
export function filingErrorNotification(errors: readonly FilingItem[], batchId: string): IslandNotification {
  const [first] = errors
  const uploadOnly = errors.every((item) => item.intake === null)
  return createNotification('filing', {
    icon: 'alert',
    tone: 'danger',
    title:
      errors.length === 1
        ? uploadOnly
          ? 'L’envoi du fichier a échoué'
          : 'Le classement a échoué'
        : `${errors.length} fichiers non classés`,
    subtitle: first ? (errors.length === 1 ? `${first.fileName} : ${first.error ?? 'erreur inconnue'}` : (first.error ?? '')) : '',
    button: 'Réessayer',
    action: { type: 'retryFiling', batchId },
  })
}

/** Après « Ranger » : « Rangé dans App Ibé › Devis », Annuler ; avec « Toujours », ce qui se passera ensuite. */
export function filedNotification(params: {
  intake: FileIntake
  file: Pick<ProjectFile, 'project_id' | 'folder' | 'name' | 'kind'>
  rule: Pick<FilingRule, 'id'> | null
  ruleError: string | null
  names: FilingNames
}): IslandNotification {
  const { intake, file, rule, ruleError, names } = params
  const client = clientNameOf(intake, names)
  let subtitle = file.name
  if (rule) subtitle = `Les prochains ${KIND_PLURAL[file.kind]}${client ? ` ${ofName(client)}` : ''} seront rangés seuls`
  else if (ruleError) subtitle = `« Toujours » non enregistré : ${ruleError}`
  return createNotification('filing', {
    icon: 'check',
    tone: 'success',
    title: `Rangé dans ${destinationLabel(projectNameOf(file.project_id, names), file.folder)}`,
    subtitle,
    button: 'Annuler',
    action: { type: 'undoFiling', intakeIds: [intake.id], ruleIds: rule ? [rule.id] : [] },
    durationMs: LONG_NOTIFICATION_MS,
  })
}

/** Après « Tout ranger ». Tout rangé : Annuler ; sinon le reste est à vérifier dans l'app. */
export function filedManyNotification(params: {
  filed: readonly { intake: FileIntake; file: Pick<ProjectFile, 'project_id'> }[]
  failed: number
  batchId: string
  names: FilingNames
}): IslandNotification {
  const { filed, failed, batchId, names } = params
  const projects = [...new Set(filed.map(({ file }) => projectNameOf(file.project_id, names)).filter(Boolean))]
  if (failed > 0) {
    return createNotification('filing', {
      icon: 'folder',
      tone: 'alert',
      title: `${plural(filed.length, 'fichier rangé', 'fichiers rangés')}, ${failed} à vérifier`,
      subtitle: 'Le rangement de certains fichiers a échoué',
      button: 'Vérifier',
      action: { type: 'openMain', route: batchRoute(batchId) },
      durationMs: LONG_NOTIFICATION_MS,
    })
  }
  return createNotification('filing', {
    icon: 'check',
    tone: 'success',
    title: `${plural(filed.length, 'fichier rangé', 'fichiers rangés')}`,
    subtitle: projects.length === 1 ? `Dans ${projects[0]}` : projects.length > 1 ? projects.join(', ') : 'Dans leurs projets',
    button: 'Annuler',
    action: { type: 'undoFiling', intakeIds: filed.map(({ intake }) => intake.id), ruleIds: [] },
    durationMs: LONG_NOTIFICATION_MS,
  })
}

/** Rangement impossible (« Ranger » ou annulation) : le message, Ouvrir l'écran de rangement. */
export function filingFailedNotification(params: { title: string; message: string; route: string }): IslandNotification {
  return createNotification('filing', {
    icon: 'alert',
    tone: 'danger',
    title: params.title,
    subtitle: params.message,
    button: 'Ouvrir',
    action: { type: 'openMain', route: params.route },
  })
}

/** Rangement annulé : le fichier attend dans « Fichiers à ranger ». */
export function undoneNotification(params: { count: number; ruleRevoked: boolean; route: string }): IslandNotification {
  const what = params.count > 1 ? `${params.count} fichiers à ranger` : 'Le fichier est à ranger'
  return createNotification('filing', {
    icon: 'folder',
    tone: 'neutral',
    title: 'Rangement annulé',
    subtitle: params.ruleRevoked ? `${what}, règle « Toujours » retirée` : what,
    button: 'Ouvrir',
    action: { type: 'openMain', route: params.route },
  })
}

/** Décision mise de côté (personne sur l'île) : « Fichier prêt à ranger », bouton Voir qui la remontre. */
export function setAsideNotification(choice: IslandChoice, count: number): IslandNotification {
  return createNotification('filing', {
    icon: 'folder',
    tone: 'info',
    title: count > 1 ? `${count} fichiers prêts à ranger` : 'Fichier prêt à ranger',
    subtitle: count > 1 ? choice.eyebrow : choice.title,
    button: 'Voir',
    action: { type: 'showChoice', choiceId: choice.id },
    durationMs: LONG_NOTIFICATION_MS,
  })
}
