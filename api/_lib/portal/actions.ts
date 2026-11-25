/**
 * Actions du client sur le portail. Chaque objet visé (version, devis, contrat) est relu avec la clé
 * service et doit appartenir au projet du jeton : sinon 404, comme s'il n'existait pas.
 * Les déclencheurs de la base font le reste (organisation, numéros, horodatages, statut du projet
 * à l'acceptation d'un devis, statut du livrable qui suit sa dernière version).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { quoteDisplayStatus } from '../../../src/shared/billing.js'
import type { Contract, Deliverable, DeliverableComment, DeliverableVersion, Quote } from '../../../src/shared/types.js'
import type { PortalActionResponse } from '../../../src/features/portal/portalContract.js'
import { HttpError } from '../http.js'
import { notifyProjectTeam } from './notify.js'
import type { PortalActionInput } from './schemas.js'
import { toPortalComment, type PortalProjectRow } from './view.js'

export interface PortalActionContext {
  admin: SupabaseClient
  project: PortalProjectRow
  now: Date
  /** AAAA-MM-JJ, Europe/Paris. */
  today: string
}

type VersionRow = Pick<DeliverableVersion, 'id' | 'deliverable_id' | 'version' | 'status'>
type DeliverableRow = Pick<Deliverable, 'id' | 'project_id' | 'title'>

const CONFLICT_DECIDED = 'Cette version a déjà reçu une réponse. Laissez un commentaire pour ajouter quelque chose.'

async function versionOfProject(
  ctx: PortalActionContext,
  versionId: string,
): Promise<{ version: VersionRow; deliverable: DeliverableRow }> {
  const notFound = new HttpError(404, 'Cette version est introuvable sur ce projet.')
  const versionRes = await ctx.admin
    .from('deliverable_versions')
    .select('id, deliverable_id, version, status')
    .eq('id', versionId)
    .maybeSingle()
  if (versionRes.error) throw new Error(`Portail : lecture de la version impossible : ${versionRes.error.message}`)
  const version = versionRes.data as VersionRow | null
  if (!version) throw notFound
  const deliverableRes = await ctx.admin
    .from('deliverables')
    .select('id, project_id, title')
    .eq('id', version.deliverable_id)
    .maybeSingle()
  if (deliverableRes.error) throw new Error(`Portail : lecture du livrable impossible : ${deliverableRes.error.message}`)
  const deliverable = deliverableRes.data as DeliverableRow | null
  if (!deliverable || deliverable.project_id !== ctx.project.id) throw notFound
  return { version, deliverable }
}

async function insertClientComment(
  ctx: PortalActionContext,
  input: { versionId: string; x: number | null; y: number | null; body: string; authorName: string },
) {
  const { data, error } = await ctx.admin
    .from('deliverable_comments')
    .insert({
      organization_id: ctx.project.organization_id,
      version_id: input.versionId,
      x: input.x,
      y: input.y,
      body: input.body,
      author_name: input.authorName,
      from_client: true,
    })
    .select('id, version_id, x, y, body, author_member_id, author_name, from_client, resolved_at, created_at')
    .single()
  if (error) throw new Error(`Portail : commentaire impossible : ${error.message}`)
  return data as Pick<
    DeliverableComment,
    'id' | 'version_id' | 'x' | 'y' | 'body' | 'author_member_id' | 'author_name' | 'from_client' | 'resolved_at' | 'created_at'
  >
}

async function comment(
  ctx: PortalActionContext,
  input: Extract<PortalActionInput, { action: 'comment' }>,
): Promise<PortalActionResponse> {
  const x = input.x ?? null
  const y = input.y ?? null
  if ((x === null) !== (y === null)) throw new HttpError(400, 'Requête invalide : une épingle a besoin de x et de y.')
  await versionOfProject(ctx, input.versionId)
  // La base notifie l'équipe (tg_notify_deliverable_comment).
  const row = await insertClientComment(ctx, { versionId: input.versionId, x, y, body: input.body, authorName: input.authorName })
  return { ok: true, comment: toPortalComment(row, new Map()) }
}

async function decide(
  ctx: PortalActionContext,
  input: Extract<PortalActionInput, { action: 'approve' | 'request_changes' }>,
): Promise<PortalActionResponse> {
  const { version, deliverable } = await versionOfProject(ctx, input.versionId)

  const siblings = await ctx.admin.from('deliverable_versions').select('id, version').eq('deliverable_id', deliverable.id)
  if (siblings.error) throw new Error(`Portail : lecture des versions impossible : ${siblings.error.message}`)
  const latest = Math.max(...(siblings.data as Pick<DeliverableVersion, 'version'>[]).map((v) => v.version))
  if (version.version < latest) {
    throw new HttpError(409, 'Une version plus récente de ce livrable existe : répondez sur la dernière version.')
  }
  if (version.status !== 'pending') throw new HttpError(409, CONFLICT_DECIDED)

  const status = input.action === 'approve' ? 'approved' : 'changes_requested'
  const updated = await ctx.admin
    .from('deliverable_versions')
    .update({ status, decided_by_name: input.authorName })
    .eq('id', version.id)
    .eq('status', 'pending')
    .select('id')
  if (updated.error) throw new Error(`Portail : décision impossible : ${updated.error.message}`)
  if ((updated.data as unknown[]).length === 0) throw new HttpError(409, CONFLICT_DECIDED)

  const note = input.note?.trim() || null
  if (note) {
    await insertClientComment(ctx, { versionId: version.id, x: null, y: null, body: note, authorName: input.authorName })
  }

  const label = `« ${deliverable.title} » V${version.version}`
  await notifyProjectTeam(ctx.admin, ctx.project, {
    kind: input.action === 'approve' ? 'deliverable.approved' : 'deliverable.changes_requested',
    title:
      input.action === 'approve'
        ? `${input.authorName} a validé ${label}`
        : `${input.authorName} demande des modifications sur ${label}`,
    body: note,
    link: `/projects/${ctx.project.id}/deliverables`,
    payload: { project_id: ctx.project.id, deliverable_id: deliverable.id, version_id: version.id },
    dedupeKey: `portal.${input.action}:${version.id}`,
  })
  return { ok: true }
}

async function acceptQuote(
  ctx: PortalActionContext,
  input: Extract<PortalActionInput, { action: 'accept_quote' }>,
): Promise<PortalActionResponse> {
  const res = await ctx.admin
    .from('quotes')
    .select('id, project_id, number, title, status, valid_until')
    .eq('id', input.quoteId)
    .eq('project_id', ctx.project.id)
    .maybeSingle()
  if (res.error) throw new Error(`Portail : lecture du devis impossible : ${res.error.message}`)
  const quote = res.data as Pick<Quote, 'id' | 'project_id' | 'number' | 'title' | 'status' | 'valid_until'> | null
  // Brouillon = invisible pour le client : même réponse qu'un devis inexistant.
  if (!quote || quote.project_id !== ctx.project.id || quote.status === 'draft') {
    throw new HttpError(404, 'Ce devis est introuvable sur ce projet.')
  }
  if (quote.status !== 'sent') throw new HttpError(409, 'Ce devis n’attend plus de réponse.')
  if (quoteDisplayStatus(quote, ctx.today) === 'expired') {
    throw new HttpError(409, 'Ce devis a expiré : demandez à l’agence une version à jour.')
  }

  // Même écriture que l'app (transitionPatch de src/features/quotes/quoteLogic.ts) ; le déclencheur
  // pose accepted_at et fait passer le projet « en cours ».
  const updated = await ctx.admin
    .from('quotes')
    .update({ status: 'accepted', accepted_at: ctx.now.toISOString() })
    .eq('id', quote.id)
    .eq('status', 'sent')
    .select('id')
  if (updated.error) throw new Error(`Portail : acceptation du devis impossible : ${updated.error.message}`)
  if ((updated.data as unknown[]).length === 0) throw new HttpError(409, 'Ce devis n’attend plus de réponse.')

  // Tickets proposés sur l'écran de validation (idempotent) : l'équipe valide ensuite.
  const proposal = await ctx.admin.rpc('propose_tasks_from_quote', { p_quote_id: quote.id })
  if (proposal.error) console.error('[portal] propose_tasks_from_quote', proposal.error.message)

  await notifyProjectTeam(ctx.admin, ctx.project, {
    kind: 'quote.accepted',
    title: `${input.authorName} a accepté le devis ${quote.number}`,
    body: `« ${quote.title} », bon pour accord donné sur le portail client.`,
    link: `/quotes/${quote.id}`,
    payload: { project_id: ctx.project.id, quote_id: quote.id },
    dedupeKey: `portal.accept_quote:${quote.id}`,
  })
  return { ok: true }
}

async function signContract(
  ctx: PortalActionContext,
  input: Extract<PortalActionInput, { action: 'sign_contract' }>,
): Promise<PortalActionResponse> {
  const res = await ctx.admin
    .from('contracts')
    .select('id, project_id, title, status')
    .eq('id', input.contractId)
    .eq('project_id', ctx.project.id)
    .maybeSingle()
  if (res.error) throw new Error(`Portail : lecture du contrat impossible : ${res.error.message}`)
  const contract = res.data as Pick<Contract, 'id' | 'project_id' | 'title' | 'status'> | null
  if (!contract || contract.project_id !== ctx.project.id || contract.status === 'draft') {
    throw new HttpError(404, 'Ce contrat est introuvable sur ce projet.')
  }
  if (contract.status !== 'sent') throw new HttpError(409, 'Ce contrat n’attend plus de signature.')

  const updated = await ctx.admin
    .from('contracts')
    .update({ status: 'signed', signed_by_name: input.signerName, signed_via: 'portal', signed_at: ctx.now.toISOString() })
    .eq('id', contract.id)
    .eq('status', 'sent')
    .select('id')
  if (updated.error) throw new Error(`Portail : signature impossible : ${updated.error.message}`)
  if ((updated.data as unknown[]).length === 0) throw new HttpError(409, 'Ce contrat n’attend plus de signature.')

  await notifyProjectTeam(ctx.admin, ctx.project, {
    kind: 'contract.signed',
    title: `${input.signerName} a signé « ${contract.title} »`,
    body: 'Signature simple sur le portail client (nom tapé et « Bon pour accord »).',
    link: `/contracts/${contract.id}`,
    payload: { project_id: ctx.project.id, contract_id: contract.id },
    dedupeKey: `portal.sign_contract:${contract.id}`,
  })
  return { ok: true }
}

export function runPortalAction(ctx: PortalActionContext, input: PortalActionInput): Promise<PortalActionResponse> {
  switch (input.action) {
    case 'comment':
      return comment(ctx, input)
    case 'approve':
    case 'request_changes':
      return decide(ctx, input)
    case 'accept_quote':
      return acceptQuote(ctx, input)
    case 'sign_contract':
      return signContract(ctx, input)
  }
}
