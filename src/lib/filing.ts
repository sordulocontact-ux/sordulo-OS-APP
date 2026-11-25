/**
 * Rangement des fichiers déposés : bibliothèque client partagée par l'île (L6) et l'app web (L5b).
 * Sans React : chaque écran l'appelle depuis ses useQuery / useMutation avec les clés `filingKeys`.
 *
 * Parcours :
 *   1. startIntake(file, { source, organizationId, memberId }) ou startBatch(files, …) :
 *      empreinte SHA-256 + texte extrait (PDF, Word, texte) → envoi dans `<org>/inbox/<membre>/` →
 *      ligne file_intakes → action IA classify. Renvoie { intake, classifyError }.
 *   2. needsReview(intake) (src/shared/filing.ts) : faux → l'île propose « Ranger » ; vrai → écran
 *      /files/intake/:intakeId. Si intake.status === 'filed' (auto_filed), une règle « Toujours » l'a déjà rangé.
 *   3. fileIntake(intakeId, choice) : range (déplace l'objet, crée project_files, intake filed), crée la
 *      règle « Toujours » si choice.always. Idempotent.
 *   4. undoFiling(intakeId) : annule un rangement (manuel ou automatique), le dépôt redevient « à ranger ».
 *
 * Annuler un rangement = corbeille, sans toucher au stockage : project_files.deleted_at est posé (la ligne et
 * l'objet restent, la policy d'écriture du dossier inbox d'un autre membre n'est jamais en jeu), le dépôt
 * repasse à ready en gardant filed_file_id. Le ranger de nouveau restaure cette ligne (projet, dossier, nom,
 * type modifiables ; nouvelle version d'un autre groupe = copie de l'objet et nouvelle ligne).
 * Toutes les erreurs sont des FilingError au message en français.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { documentKind, normalizeText } from '../features/inputs/documentText'
import type { AiActionName } from '../shared/ai-actions'
import type { ClassifyRequest, ClassifyResponse, ImportFromIntakeResponse } from '../shared/ai/classify'
import {
  FILES_BUCKET,
  FILE_MAX_BYTES,
  defaultFolderFor,
  fileExtension,
  inboxPath,
  isFileKind,
  projectFilePath,
  truncateExtractedText,
} from '../shared/filing'
import {
  FILE_FOLDER_MAX_LENGTH,
  type FileIntake,
  type FileIntakeSource,
  type FileIntakeStatus,
  type FileKind,
  type FilingRule,
  type ProjectFile,
} from '../shared/types'
import { runAi } from './ai'
import { supabase } from './supabase'

export class FilingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FilingError'
  }
}

/** Clés TanStack Query partagées par l'île et l'app web (invalider `filingKeys.all` après un rangement). */
export const filingKeys = {
  all: ['filing'] as const,
  intake: (intakeId: string) => ['filing', 'intake', intakeId] as const,
  pending: (organizationId: string) => ['filing', 'pending', organizationId] as const,
  batch: (batchId: string) => ['filing', 'batch', batchId] as const,
  rules: (organizationId: string) => ['filing', 'rules', organizationId] as const,
}

/** Statuts d'un dépôt pas encore rangé ni annulé. */
export const PENDING_INTAKE_STATUSES = ['uploaded', 'classifying', 'ready', 'error'] as const satisfies readonly FileIntakeStatus[]

/** Nombre de fichiers traités en même temps par startBatch. */
export const BATCH_CONCURRENCY = 3
const NAME_MAX_LENGTH = 255

/* ---------- Fichier : empreinte et texte ---------- */

/** Empreinte SHA-256 en hexadécimal minuscule (WebCrypto), comme project_files.sha256. */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Texte d'un PDF, d'un document Word ou d'un fichier texte, nettoyé (documentText.ts) et tronqué à 20 000
 * caractères. null pour une image, un format inconnu, un PDF scanné ou un fichier illisible : le serveur
 * envoie alors l'image ou le PDF à Claude, ou seulement le nom.
 */
export async function extractIntakeText(file: File): Promise<string | null> {
  const kind = documentKind(file.name, file.type)
  if (!kind) return null
  try {
    let raw: string
    if (kind === 'pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
      raw = (await extractText(pdf, { mergePages: true })).text
    } else if (kind === 'docx') {
      const mammoth = await import('mammoth')
      raw = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
    } else {
      raw = await file.text()
    }
    return truncateExtractedText(normalizeText(raw, fileExtension(file.name)))
  } catch {
    return null
  }
}

/* ---------- Types publics ---------- */

export interface StartIntakeOptions {
  source: FileIntakeSource
  organizationId: string
  /** Membre connecté : le dépôt va dans son dossier inbox (seul dossier où il peut écrire). */
  memberId: string
  /** Fichiers déposés ensemble (startBatch le pose). */
  batchId?: string | null
}

export interface IntakeOutcome {
  /** Dépôt à jour : ready (proposition), filed (rangé par une règle « Toujours »), error, ou uploaded si l'API n'a pas répondu. */
  intake: FileIntake
  /** Message en français si le classement a échoué (le dépôt existe : classifyIntake pour réessayer). */
  classifyError: string | null
}

export interface BatchItem {
  file: File
  /** null si l'envoi a échoué (rien n'a été créé). */
  outcome: IntakeOutcome | null
  error: string | null
}

export interface BatchProgress {
  done: number
  total: number
  item: BatchItem
}

export interface StartBatchOptions extends Omit<StartIntakeOptions, 'batchId'> {
  /** Lot existant (sinon un nouveau). */
  batchId?: string
  /** 1 à 3 (défaut 3). */
  concurrency?: number
  onProgress?: (progress: BatchProgress) => void
}

export interface BatchResult {
  batchId: string
  /** Dans l'ordre des fichiers donnés. */
  items: BatchItem[]
}

/** Rangement choisi (proposition de l'IA acceptée ou corrigée). */
export interface FilingChoice {
  projectId: string
  folder: string
  kind: FileKind
  /** Nom affiché du fichier rangé (par défaut le nom d'origine du dépôt : defaultFiledName). */
  name: string
  /** undefined = celui de la proposition (devis / facture rapproché), null = aucun. */
  quoteId?: string | null
  invoiceId?: string | null
  /** undefined = groupe de la version précédente proposée (si même projet), null = nouveau fichier. */
  versionGroupId?: string | null
  /** undefined = ceux de la proposition. */
  summary?: string | null
  changeSummary?: string | null
  /** Crée la règle « Toujours » (client + type), en révoquant l'ancienne. */
  always?: boolean
  /** Avec always : la règle garde ce projet (sinon le projet détecté par l'IA à chaque dépôt). */
  alwaysPinProject?: boolean
  /** Client de la règle ; par défaut celui de la proposition, sinon celui du projet. */
  clientId?: string | null
}

export interface FiledResult {
  intake: FileIntake
  file: ProjectFile
  /** Règle créée par always. */
  rule: FilingRule | null
  /** Le rangement a réussi mais la règle n'a pas pu être créée. */
  ruleError: string | null
}

export interface FilingDeps {
  supabase: SupabaseClient
  runAi: <TReq extends object, TRes>(action: AiActionName, body: TReq) => Promise<TRes>
  randomUUID?: () => string
  now?: () => Date
  hash?: (file: Blob) => Promise<string>
  extractText?: (file: File) => Promise<string | null>
}

/** Nom proposé pour le fichier rangé : le nom d'origine du dépôt (il sert à reconnaître les versions suivantes). */
export function defaultFiledName(intake: Pick<FileIntake, 'name'>): string {
  return intake.name
}

/** Choix par défaut à partir de la proposition (null sans projet proposé). */
export function choiceFromProposal(intake: FileIntake): FilingChoice | null {
  const proposal = intake.proposal
  if (!proposal?.project_id) return null
  return { projectId: proposal.project_id, folder: proposal.folder, kind: proposal.kind, name: defaultFiledName(intake) }
}

/** Exécute `task` sur chaque élément, `limit` à la fois, résultats dans l'ordre. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dbError(action: string, error: PostgrestError | { message: string; code?: string }): FilingError {
  if (error.code === '42501') {
    return new FilingError(`${action} : accès refusé (les devis, factures et contrats sont réservés aux admins et à la finance).`, {
      cause: error,
    })
  }
  if (error.code === '23503') return new FilingError(`${action} : un élément lié est introuvable.`, { cause: error })
  return new FilingError(`${action} : ${error.message}`, { cause: error })
}

function cleanName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim()
  if (clean === '') throw new FilingError('Le nom du fichier est vide.')
  return clean
}

function cleanFolder(folder: string, kind: FileKind): string {
  const clean = folder.replace(/\s+/g, ' ').trim()
  if (clean.length > FILE_FOLDER_MAX_LENGTH) throw new FilingError(`Le nom du dossier dépasse ${FILE_FOLDER_MAX_LENGTH} caractères.`)
  return clean === '' ? defaultFolderFor(kind) : clean
}

/* ---------- Bibliothèque ---------- */

export function createFilingApi(deps: FilingDeps) {
  const db = deps.supabase
  const uuid = deps.randomUUID ?? (() => crypto.randomUUID())
  const now = deps.now ?? (() => new Date())
  const hash = deps.hash ?? sha256Hex
  const extractText = deps.extractText ?? extractIntakeText
  const bucket = () => db.storage.from(FILES_BUCKET)

  async function getIntake(intakeId: string): Promise<FileIntake | null> {
    const { data, error } = await db.from('file_intakes').select('*').eq('id', intakeId).maybeSingle()
    if (error) throw dbError('Lecture du dépôt impossible', error)
    return (data as FileIntake | null) ?? null
  }

  async function requireIntake(intakeId: string): Promise<FileIntake> {
    const intake = await getIntake(intakeId)
    if (!intake) throw new FilingError('Dépôt introuvable, ou réservé au membre qui l’a déposé.')
    return intake
  }

  async function getFile(fileId: string): Promise<ProjectFile | null> {
    const { data, error } = await db.from('project_files').select('*').eq('id', fileId).maybeSingle()
    if (error) throw dbError('Lecture du fichier impossible', error)
    return (data as ProjectFile | null) ?? null
  }

  /** Dépôts pas encore rangés de l'organisation (les siens ; tous pour un admin, par la RLS), récents d'abord. */
  async function listPendingIntakes(organizationId: string, options: { createdBy?: string } = {}): Promise<FileIntake[]> {
    let query = db.from('file_intakes').select('*').eq('organization_id', organizationId).in('status', [...PENDING_INTAKE_STATUSES])
    if (options.createdBy) query = query.eq('created_by', options.createdBy)
    const { data, error } = await query.order('created_at', { ascending: false }).limit(100)
    if (error) throw dbError('Lecture des dépôts impossible', error)
    return (data ?? []) as FileIntake[]
  }

  /** Dépôts d'un même lot, dans l'ordre d'envoi. */
  async function listBatch(batchId: string): Promise<FileIntake[]> {
    const { data, error } = await db.from('file_intakes').select('*').eq('batch_id', batchId).order('created_at', { ascending: true })
    if (error) throw dbError('Lecture du lot impossible', error)
    return (data ?? []) as FileIntake[]
  }

  /** Règles « Toujours » actives de l'organisation. */
  async function listFilingRules(organizationId: string): Promise<FilingRule[]> {
    const { data, error } = await db
      .from('filing_rules')
      .select('*')
      .eq('organization_id', organizationId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    if (error) throw dbError('Lecture des règles impossible', error)
    return (data ?? []) as FilingRule[]
  }

  /** (Re)lance le classement par l'IA. Un échec n'est pas levé : il revient dans classifyError avec le dépôt relu. */
  async function classifyIntake(intakeId: string): Promise<IntakeOutcome> {
    try {
      const { intake } = await deps.runAi<ClassifyRequest, ClassifyResponse>('classify', { intakeId, mode: 'classify' })
      return { intake, classifyError: null }
    } catch (error) {
      const intake = await requireIntake(intakeId)
      return { intake, classifyError: intake.error_message ?? messageOf(error) }
    }
  }

  /** Envoie un fichier dans l'inbox du membre, crée le dépôt et le fait classer. */
  async function startIntake(file: File, options: StartIntakeOptions): Promise<IntakeOutcome> {
    if (file.size === 0) throw new FilingError(`« ${file.name} » est vide.`)
    if (file.size > FILE_MAX_BYTES) throw new FilingError(`« ${file.name} » dépasse 100 Mo.`)
    const [sha256, extractedText] = await Promise.all([hash(file), extractText(file).catch(() => null)])
    const name = cleanName(file.name || 'fichier')
    const path = inboxPath(options.organizationId, options.memberId, uuid(), name)

    const uploaded = await bucket().upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (uploaded.error) throw new FilingError(`Envoi de « ${name} » impossible : ${uploaded.error.message}`, { cause: uploaded.error })

    const inserted = await db
      .from('file_intakes')
      .insert({
        organization_id: options.organizationId,
        source: options.source,
        batch_id: options.batchId ?? null,
        storage_path: path,
        name,
        mime_type: file.type || null,
        size_bytes: file.size,
        sha256,
        extracted_text: truncateExtractedText(extractedText),
      })
      .select('*')
      .single()
    if (inserted.error || !inserted.data) {
      await bucket().remove([path])
      throw dbError(`Dépôt de « ${name} » impossible`, inserted.error ?? { message: 'réponse vide' })
    }
    return classifyIntake((inserted.data as FileIntake).id)
  }

  /** Plusieurs fichiers d'un coup : lot commun, 3 à la fois, progression fichier par fichier. Ne lève pas. */
  async function startBatch(files: readonly File[], options: StartBatchOptions): Promise<BatchResult> {
    const batchId = options.batchId ?? uuid()
    const limit = Math.min(BATCH_CONCURRENCY, Math.max(1, Math.floor(options.concurrency ?? BATCH_CONCURRENCY)))
    let done = 0
    const items = await mapWithConcurrency(files, limit, async (file) => {
      let item: BatchItem
      try {
        const outcome = await startIntake(file, { ...options, batchId })
        item = { file, outcome, error: outcome.classifyError }
      } catch (error) {
        item = { file, outcome: null, error: messageOf(error) }
      }
      done++
      options.onProgress?.({ done, total: files.length, item })
      return item
    })
    return { batchId, items }
  }

  /** Groupe de version à utiliser : explicite, sinon celui de la version précédente proposée dans le même projet. */
  async function resolveVersionGroup(intake: FileIntake, choice: FilingChoice): Promise<string | null> {
    if (choice.versionGroupId !== undefined) return choice.versionGroupId
    const previousId = intake.proposal?.previous_version_file_id
    if (!previousId) return null
    const previous = await getFile(previousId)
    return previous && previous.project_id === choice.projectId && previous.deleted_at === null ? previous.version_group_id : null
  }

  async function createRule(intake: FileIntake, choice: FilingChoice, kind: FileKind, folder: string): Promise<FilingRule> {
    let clientId = choice.clientId ?? intake.proposal?.client_id ?? null
    if (!clientId) {
      const { data, error } = await db.from('projects').select('id, client_id').eq('id', choice.projectId).maybeSingle()
      if (error) throw dbError('Lecture du projet impossible', error)
      clientId = (data as { client_id: string | null } | null)?.client_id ?? null
    }
    if (!clientId) throw new FilingError('« Toujours » demande un client : ce projet n’en a pas.')
    const revoked = await db
      .from('filing_rules')
      .update({ revoked_at: now().toISOString() })
      .eq('client_id', clientId)
      .eq('kind', kind)
      .is('revoked_at', null)
    if (revoked.error) throw dbError('Remplacement de l’ancienne règle impossible', revoked.error)
    const inserted = await db
      .from('filing_rules')
      .insert({
        client_id: clientId,
        kind,
        project_id: choice.alwaysPinProject ? choice.projectId : null,
        folder: folder === defaultFolderFor(kind) ? null : folder,
      })
      .select('*')
      .single()
    if (inserted.error || !inserted.data) throw dbError('Création de la règle impossible', inserted.error ?? { message: 'réponse vide' })
    const rule = inserted.data as FilingRule
    const linked = await db.from('file_intakes').update({ rule_id: rule.id }).eq('id', intake.id)
    if (linked.error) console.warn(`[filing] règle non reliée au dépôt : ${linked.error.message}`)
    return rule
  }

  /**
   * Range un dépôt : déplace l'objet de l'inbox vers `<org>/<projet>/`, crée la ligne project_files, passe le
   * dépôt à filed et crée la règle « Toujours » si demandé. Déjà rangé → renvoie le fichier existant.
   * Un admin qui range le dépôt d'un autre membre ne peut pas vider l'inbox de ce membre : l'objet est copié
   * (l'original y reste).
   */
  async function fileIntake(intakeId: string, choice: FilingChoice): Promise<FiledResult> {
    const intake = await requireIntake(intakeId)
    if (intake.status === 'filed') {
      const existing = intake.filed_file_id ? await getFile(intake.filed_file_id) : null
      if (!existing) throw new FilingError('Ce dépôt est marqué rangé mais son fichier a été supprimé.')
      return { intake, file: existing, rule: null, ruleError: null }
    }
    if (intake.status === 'cancelled') throw new FilingError('Ce dépôt a été annulé.')
    if (!isFileKind(choice.kind)) throw new FilingError('Type de document inconnu.')
    if (!choice.projectId) throw new FilingError('Choisis un projet.')

    const kind = choice.kind
    const folder = cleanFolder(choice.folder, kind)
    const name = cleanName(choice.name)
    const proposal = intake.proposal
    const versionGroupId = await resolveVersionGroup(intake, choice)
    const fields = {
      project_id: choice.projectId,
      folder,
      name,
      kind,
      summary: choice.summary !== undefined ? choice.summary : (proposal?.summary ?? null),
      change_summary: choice.changeSummary !== undefined ? choice.changeSummary : versionGroupId ? (proposal?.change_summary ?? null) : null,
      quote_id: choice.quoteId !== undefined ? choice.quoteId : kind === 'quote' ? (proposal?.linked_quote_id ?? null) : null,
      invoice_id: choice.invoiceId !== undefined ? choice.invoiceId : kind === 'invoice' ? (proposal?.linked_invoice_id ?? null) : null,
    }

    // Rangement annulé auparavant : la ligne est dans la corbeille avec son objet.
    const trashed = intake.filed_file_id ? await getFile(intake.filed_file_id) : null
    let file: ProjectFile
    let rollback: () => Promise<void>

    if (trashed && (versionGroupId === null || versionGroupId === trashed.version_group_id)) {
      const restored = await db
        .from('project_files')
        .update({ ...fields, deleted_at: null })
        .eq('id', trashed.id)
        .select('*')
        .single()
      if (restored.error || !restored.data) throw dbError('Rangement impossible', restored.error ?? { message: 'réponse vide' })
      file = restored.data as ProjectFile
      rollback = async () => {
        await db.from('project_files').update({ deleted_at: trashed.deleted_at ?? now().toISOString() }).eq('id', trashed.id)
      }
    } else {
      const source = trashed ? trashed.storage_path : intake.storage_path
      const destination = projectFilePath(intake.organization_id, choice.projectId, uuid(), name)
      let copied = Boolean(trashed)
      if (trashed) {
        const copy = await bucket().copy(source, destination)
        if (copy.error) throw new FilingError(`Copie du fichier impossible : ${copy.error.message}`, { cause: copy.error })
      } else {
        const moved = await bucket().move(source, destination)
        if (moved.error) {
          const copy = await bucket().copy(source, destination)
          if (copy.error) throw new FilingError(`Déplacement du fichier impossible : ${moved.error.message}`, { cause: moved.error })
          copied = true
        }
      }
      const undoObject = async () => {
        if (copied) await bucket().remove([destination])
        else await bucket().move(destination, source)
      }
      const inserted = await db
        .from('project_files')
        .insert({
          ...fields,
          storage_path: destination,
          mime_type: intake.mime_type,
          size_bytes: intake.size_bytes,
          sha256: intake.sha256,
          ...(versionGroupId ? { version_group_id: versionGroupId } : {}),
        })
        .select('*')
        .single()
      if (inserted.error || !inserted.data) {
        await undoObject()
        throw dbError('Rangement impossible', inserted.error ?? { message: 'réponse vide' })
      }
      file = inserted.data as ProjectFile
      rollback = async () => {
        await db.from('project_files').delete().eq('id', file.id)
        await undoObject()
      }
    }

    const updated = await db
      .from('file_intakes')
      .update({ status: 'filed', filed_file_id: file.id })
      .eq('id', intake.id)
      .select('*')
      .single()
    if (updated.error || !updated.data) {
      await rollback()
      throw dbError('Rangement impossible', updated.error ?? { message: 'réponse vide' })
    }
    let filed = updated.data as FileIntake

    let rule: FilingRule | null = null
    let ruleError: string | null = null
    if (choice.always) {
      try {
        rule = await createRule(filed, choice, kind, folder)
        filed = { ...filed, rule_id: rule.id }
      } catch (error) {
        ruleError = messageOf(error)
      }
    }
    return { intake: filed, file, rule, ruleError }
  }

  /**
   * Annule un rangement (manuel ou automatique) : le fichier passe à la corbeille, le dépôt redevient « à
   * ranger » avec sa proposition. Déjà annulé → renvoie le dépôt. Pour ne plus ranger seul, revokeFilingRule(intake.rule_id).
   */
  async function undoFiling(intakeId: string): Promise<FileIntake> {
    const intake = await requireIntake(intakeId)
    if (intake.status === 'ready' && intake.filed_file_id) return intake
    if (intake.status !== 'filed') throw new FilingError('Ce fichier n’est pas rangé.')
    if (!intake.filed_file_id) throw new FilingError('Le fichier rangé a été supprimé définitivement : ce rangement ne peut plus être annulé.')

    const deletedAt = now().toISOString()
    const trashed = await db.from('project_files').update({ deleted_at: deletedAt }).eq('id', intake.filed_file_id).select('id').maybeSingle()
    if (trashed.error) throw dbError('Annulation impossible', trashed.error)
    if (!trashed.data) throw new FilingError('Annulation impossible : le fichier rangé est introuvable.')

    const updated = await db.from('file_intakes').update({ status: 'ready' }).eq('id', intake.id).select('*').single()
    if (updated.error || !updated.data) {
      await db.from('project_files').update({ deleted_at: null }).eq('id', intake.filed_file_id)
      throw dbError('Annulation impossible', updated.error ?? { message: 'réponse vide' })
    }
    return updated.data as FileIntake
  }

  /** Abandonne un dépôt pas rangé (l'objet de l'inbox est supprimé si possible). Déjà annulé → renvoie le dépôt. */
  async function cancelIntake(intakeId: string): Promise<FileIntake> {
    const intake = await requireIntake(intakeId)
    if (intake.status === 'cancelled') return intake
    if (intake.status === 'filed') throw new FilingError('Ce fichier est rangé : annule d’abord le rangement.')
    const updated = await db.from('file_intakes').update({ status: 'cancelled' }).eq('id', intake.id).select('*').single()
    if (updated.error || !updated.data) throw dbError('Annulation du dépôt impossible', updated.error ?? { message: 'réponse vide' })
    if (!intake.filed_file_id) {
      // Seul le membre qui a déposé peut vider son inbox : pour un admin, l'objet reste (sans conséquence).
      const removed = await bucket().remove([intake.storage_path])
      if (removed.error) console.warn(`[filing] objet de l'inbox non supprimé : ${removed.error.message}`)
    }
    return updated.data as FileIntake
  }

  /** Crée le devis / la facture importé(e) d'après le dépôt (admin, finance). 501 tant que la base ne le permet pas. */
  async function importFromIntake(intakeId: string): Promise<ImportFromIntakeResponse> {
    try {
      return await deps.runAi<ClassifyRequest, ImportFromIntakeResponse>('classify', { intakeId, mode: 'import' })
    } catch (error) {
      throw new FilingError(messageOf(error), { cause: error })
    }
  }

  /** Révoque une règle « Toujours » (les dépôts suivants ne sont plus rangés seuls). */
  async function revokeFilingRule(ruleId: string): Promise<void> {
    const { error } = await db.from('filing_rules').update({ revoked_at: now().toISOString() }).eq('id', ruleId).is('revoked_at', null)
    if (error) throw dbError('Révocation de la règle impossible', error)
  }

  return {
    startIntake,
    startBatch,
    classifyIntake,
    fileIntake,
    undoFiling,
    cancelIntake,
    importFromIntake,
    revokeFilingRule,
    getIntake,
    getFile,
    listPendingIntakes,
    listBatch,
    listFilingRules,
  }
}

export type FilingApi = ReturnType<typeof createFilingApi>

/** Bibliothèque branchée sur le client Supabase de l'app et sur /api/ai/run. */
const filing = createFilingApi({ supabase, runAi })

export const startIntake = filing.startIntake
export const startBatch = filing.startBatch
export const classifyIntake = filing.classifyIntake
export const fileIntake = filing.fileIntake
export const undoFiling = filing.undoFiling
export const cancelIntake = filing.cancelIntake
export const importFromIntake = filing.importFromIntake
export const revokeFilingRule = filing.revokeFilingRule
export const getIntake = filing.getIntake
export const getFile = filing.getFile
export const listPendingIntakes = filing.listPendingIntakes
export const listBatch = filing.listBatch
export const listFilingRules = filing.listFilingRules
