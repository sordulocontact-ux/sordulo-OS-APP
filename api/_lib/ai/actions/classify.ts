/**
 * Action IA « classify » : rangement d'un fichier déposé (île ou app web). Types : src/shared/ai/classify.ts.
 *
 * mode 'classify' (créateur du dépôt, ou admin de l'organisation) :
 *   devis et factures donnés à Claude et rapprochés seulement si l'appelant et l'auteur du dépôt sont admin ou
 *   finance (billingVisible) ; pour un membre : clients, projets et fichiers hors devis / factures, et une
 *   proposition de type quote / invoice sans document relié ;
 *   uploaded / ready / error → classifying → ready (proposition + confiance) ou error (message en français) ;
 *   filed directement quand une règle « Toujours » s'applique (rangement côté serveur, notification file.auto_filed).
 *   Contenu donné à Claude : le texte extrait (rempli par le client) ; à défaut une image (≤ 5 Mo) ou un PDF
 *   (≤ 10 Mo) lu dans le stockage ; sinon le nom et le type seulement. Le fichier est une donnée non fiable.
 * mode 'import' (admin, finance ; créateur du dépôt ou admin) : créer le devis / la facture d'après le fichier,
 *   numéro d'origine gardé (api/_lib/files/importDocument.ts : Claude extrait, le code valide les lignes avec
 *   billing.ts, la RPC import_document_from_file de la migration 0018 crée le document). Client obligatoire
 *   dans la proposition, projet facultatif ; le dépôt (ou le fichier rangé) est relié au document créé.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  CLASSIFY_MODES,
  ClassificationSchema,
  type ClassifyResponse,
  type ImportFromIntakeResponse,
} from '../../../../src/shared/ai/classify.js'
import {
  CLASSIFY_IMAGE_MAX_BYTES,
  CLASSIFY_PDF_MAX_BYTES,
  isClassifiableImage,
  isClassifiablePdf,
} from '../../../../src/shared/filing.js'
import type { FileIntake, Member } from '../../../../src/shared/types.js'
import { callClaudeStructured } from '../../analysis.js'
import { autoFile, planAutoFile } from '../../files/autoFile.js'
import {
  billingVisible,
  findActiveRule,
  filesLinkedTo,
  findDocumentsByNumber,
  loadClassifyContext,
  loadFileRef,
  loadIntake,
} from '../../files/context.js'
import { importDocumentFromIntake } from '../../files/importDocument.js'
import { finalizeProposal, pickLinkedDocument } from '../../files/proposal.js'
import { CLASSIFY_SYSTEM_PROMPT, buildClassifyMessage, type ClassifyContentMode } from '../../files/prompt.js'
import { downloadBase64 } from '../../files/storage.js'
import type { ClassifyContext } from '../../files/types.js'
import { HttpError } from '../../http.js'
import { defineAiAction, type AiActionContext } from '../types.js'

const ERROR_MESSAGE_MAX = 2000
const CLASSIFIABLE_STATUSES = ['uploaded', 'classifying', 'ready', 'error'] as const

const schema = z.object({
  intakeId: z.uuid({ error: 'Identifiant de dépôt invalide.' }),
  mode: z.enum(CLASSIFY_MODES).default('classify'),
})

type Body = z.output<typeof schema>

/** Le dépôt, après contrôle des droits : membre actif (rôles donnés), créateur du dépôt ou admin. */
async function loadOwnedIntake(
  ctx: AiActionContext<Body>,
  roles: readonly Member['role'][],
): Promise<{ intake: FileIntake; member: Member }> {
  const intake = await loadIntake(ctx.admin, ctx.body.intakeId)
  if (!intake) throw new HttpError(404, 'Dépôt introuvable.')
  const member = await ctx.requireMember(intake.organization_id, roles)
  if (member.role !== 'admin' && intake.created_by !== member.id) {
    throw new HttpError(403, 'Accès refusé : ce dépôt appartient à un autre membre.')
  }
  return { intake, member }
}

/** Contenu du message : texte seul, ou bloc image / PDF suivi du texte. */
async function buildContent(
  admin: SupabaseClient,
  intake: FileIntake,
  context: ClassifyContext,
): Promise<{ content: string | Anthropic.ContentBlockParam[]; mode: ClassifyContentMode }> {
  let mode: ClassifyContentMode = 'name'
  let block: Anthropic.ContentBlockParam | null = null
  if (intake.extracted_text?.trim()) {
    mode = 'text'
  } else if (isClassifiableImage(intake.mime_type, intake.size_bytes)) {
    const data = await downloadBase64(admin, intake.storage_path, CLASSIFY_IMAGE_MAX_BYTES)
    if (data) {
      mode = 'image'
      block = { type: 'image', source: { type: 'base64', media_type: intake.mime_type, data } }
    }
  } else if (isClassifiablePdf(intake.name, intake.mime_type, intake.size_bytes)) {
    const data = await downloadBase64(admin, intake.storage_path, CLASSIFY_PDF_MAX_BYTES)
    if (data) {
      mode = 'pdf'
      block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    }
  }
  const text = buildClassifyMessage(context, intake, mode)
  return { content: block ? [block, { type: 'text', text }] : text, mode }
}

async function classify(admin: SupabaseClient, intake: FileIntake, billing: boolean): Promise<ClassifyResponse> {
  if (intake.status === 'filed') throw new HttpError(409, 'Ce fichier est déjà rangé.')
  if (intake.status === 'cancelled') throw new HttpError(409, 'Ce dépôt a été annulé.')

  const started = await admin
    .from('file_intakes')
    .update({ status: 'classifying', error_message: null })
    .eq('id', intake.id)
    .in('status', [...CLASSIFIABLE_STATUSES])
    .select('*')
    .maybeSingle()
  if (started.error) throw new Error(`Mise à jour du dépôt impossible : ${started.error.message}`)
  if (!started.data) throw new HttpError(409, 'Ce dépôt vient d’être rangé ou annulé.')
  const current = started.data as FileIntake

  let result: Awaited<ReturnType<typeof analyse>>
  try {
    result = await analyse(admin, current, billing)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const message = `Classement impossible : ${reason}`.slice(0, ERROR_MESSAGE_MAX)
    const failed = await admin
      .from('file_intakes')
      .update({ status: 'error', error_message: message })
      .eq('id', current.id)
      .eq('status', 'classifying')
    if (failed.error) console.error(`[classify] statut d'erreur non enregistré : ${failed.error.message}`)
    throw new HttpError(502, message)
  }
  const { finalized } = result

  // Règle « Toujours » : un échec ici n'empêche pas la proposition (le dépôt reste à ranger).
  try {
    const rule = await findActiveRule(admin, current.organization_id, finalized.proposal.client_id, finalized.proposal.kind)
    const previousId = finalized.proposal.previous_version_file_id
    const previous = previousId ? await loadFileRef(admin, previousId) : null
    const plan = planAutoFile({ intake: current, finalized, rule, previous })
    if (rule && plan) {
      const filed = await autoFile(admin, current, finalized, rule, plan)
      if (filed) return { intake: filed }
    }
  } catch (error) {
    console.error(`[classify] règle « Toujours » non appliquée : ${error instanceof Error ? error.message : String(error)}`)
  }

  const ready = await admin
    .from('file_intakes')
    .update({ proposal: finalized.proposal, confidence: finalized.confidence, status: 'ready', error_message: null })
    .eq('id', current.id)
    .eq('status', 'classifying')
    .select('*')
    .maybeSingle()
  if (ready.error) throw new Error(`Enregistrement de la proposition impossible : ${ready.error.message}`)
  if (ready.data) return { intake: ready.data as FileIntake }
  // Rangé ou annulé pendant l'analyse : on renvoie l'état actuel sans l'écraser.
  const latest = await loadIntake(admin, current.id)
  if (!latest) throw new HttpError(404, 'Dépôt introuvable.')
  return { intake: latest }
}

/** Contexte → Claude → rapprochements → proposition finale. Toute erreur est en français. */
async function analyse(admin: SupabaseClient, intake: FileIntake, billing: boolean) {
  const context = await loadClassifyContext(admin, intake, { billing })
  const { content, mode } = await buildContent(admin, intake, context)
  const ai = await callClaudeStructured({
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM_PROMPT,
    content,
    logTag: '[classify]',
    refusal: 'Claude a refusé de classer ce fichier',
    truncated: 'la réponse de Claude a été coupée (limite de longueur atteinte).',
    retryHint: 'Relance le classement.',
    maxTokens: 4000,
  })
  const matches = billing ? await findDocumentsByNumber(admin, intake.organization_id, ai.kind, ai.document_number) : []
  const linkedDocument = pickLinkedDocument(matches, ai.client_id)
  const linkedFiles = linkedDocument
    ? await filesLinkedTo(admin, intake.organization_id, {
        quoteId: ai.kind === 'quote' ? linkedDocument.id : null,
        invoiceId: ai.kind === 'invoice' ? linkedDocument.id : null,
      })
    : []
  const finalized = finalizeProposal({
    ai,
    intake,
    clients: context.clients,
    projects: context.projects,
    linkedDocument,
    linkedFiles,
    duplicates: context.duplicates,
    candidates: context.candidates,
    contentReadable: mode !== 'name',
    billing,
  })
  console.log(
    `[classify] type=${finalized.proposal.kind} confiance=${finalized.confidence} projet=${finalized.proposal.project_id ? 'oui' : 'non'} relié=${linkedDocument ? 'oui' : 'non'} doublon=${finalized.proposal.duplicate_of_file_id ? 'oui' : 'non'} version=${finalized.proposal.previous_version_file_id ? 'oui' : 'non'}`,
  )
  return { finalized }
}

export default defineAiAction({
  schema,
  async run(ctx): Promise<ClassifyResponse | ImportFromIntakeResponse> {
    if (ctx.body.mode === 'import') {
      const { intake, member } = await loadOwnedIntake(ctx, ['admin', 'finance'])
      return importDocumentFromIntake(ctx.admin, intake, member.id)
    }
    const { intake, member } = await loadOwnedIntake(ctx, ['admin', 'membre', 'finance'])
    return classify(ctx.admin, intake, await billingVisible(ctx.admin, member, intake))
  },
})
