/**
 * Règle « Toujours » appliquée par le serveur : le dépôt est rangé seul (inbox → projet), le fichier
 * créé dans project_files et le dépôt passé à filed + auto_filed (la base notifie file.auto_filed, et
 * le rangement s'annule ensuite comme un rangement manuel : undoFiling de src/lib/filing.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FILING_CONFIDENCE_THRESHOLD, projectFilePath } from '../../../src/shared/filing.js'
import type { FileIntake, FilingRule, ProjectFile } from '../../../src/shared/types.js'
import type { FinalizedProposal } from './proposal.js'
import { moveObject } from './storage.js'
import type { FileRef } from './types.js'

export interface AutoFilePlan {
  projectId: string
  folder: string
  versionGroupId: string | null
  changeSummary: string | null
}

/**
 * Décide si la règle range seule ce dépôt : règle active, confiance ≥ seuil, pas de doublon, dépôt jamais
 * rangé (un rangement annulé n'est pas refait dans le dos de l'équipe), projet connu. Le projet d'un devis /
 * d'une facture rapproché(e) prime sur celui de la règle ; sinon celui de la règle, sinon celui de l'IA.
 */
export function planAutoFile(input: {
  intake: Pick<FileIntake, 'filed_file_id'>
  finalized: FinalizedProposal
  rule: FilingRule | null
  previous: FileRef | null
}): AutoFilePlan | null {
  const { intake, finalized, rule, previous } = input
  const { proposal } = finalized
  if (!rule || rule.revoked_at !== null) return null
  if (intake.filed_file_id !== null) return null
  if (finalized.confidence < FILING_CONFIDENCE_THRESHOLD) return null
  if (proposal.duplicate_of_file_id) return null
  const projectId = finalized.projectFromDocument ? proposal.project_id : (rule.project_id ?? proposal.project_id)
  if (!projectId) return null
  const isVersion = previous !== null && previous.project_id === projectId
  return {
    projectId,
    folder: rule.folder ?? proposal.folder,
    versionGroupId: isVersion ? previous.version_group_id : null,
    changeSummary: isVersion ? proposal.change_summary : null,
  }
}

/** Range le dépôt selon le plan. Renvoie le dépôt à jour (filed), ou null si rien n'a pu être fait (tout est défait). */
export async function autoFile(
  admin: SupabaseClient,
  intake: FileIntake,
  finalized: FinalizedProposal,
  rule: FilingRule,
  plan: AutoFilePlan,
): Promise<FileIntake | null> {
  const { proposal } = finalized
  const fileId = crypto.randomUUID()
  const destination = projectFilePath(intake.organization_id, plan.projectId, crypto.randomUUID(), intake.name)
  try {
    await moveObject(admin, intake.storage_path, destination)
  } catch (error) {
    console.error(`[classify] rangement automatique impossible : ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  const moveBack = async () => {
    try {
      await moveObject(admin, destination, intake.storage_path)
    } catch (error) {
      console.error(`[classify] fichier laissé dans le projet : ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const inserted = await admin
    .from('project_files')
    .insert({
      id: fileId,
      organization_id: intake.organization_id,
      project_id: plan.projectId,
      folder: plan.folder,
      name: intake.name,
      storage_path: destination,
      mime_type: intake.mime_type,
      size_bytes: intake.size_bytes,
      sha256: intake.sha256,
      kind: proposal.kind,
      summary: proposal.summary,
      ...(plan.versionGroupId ? { version_group_id: plan.versionGroupId } : {}),
      change_summary: plan.changeSummary,
      quote_id: proposal.linked_quote_id,
      invoice_id: proposal.linked_invoice_id,
      uploaded_by: intake.created_by,
    })
    .select('*')
    .single()
  if (inserted.error || !inserted.data) {
    console.error(`[classify] fichier rangé non créé : ${inserted.error?.message ?? 'réponse vide'}`)
    await moveBack()
    return null
  }
  const file = inserted.data as ProjectFile

  const updated = await admin
    .from('file_intakes')
    .update({
      proposal,
      confidence: finalized.confidence,
      status: 'filed',
      filed_file_id: file.id,
      auto_filed: true,
      rule_id: rule.id,
      error_message: null,
    })
    .eq('id', intake.id)
    .eq('status', 'classifying')
    .select('*')
    .maybeSingle()
  if (updated.error || !updated.data) {
    console.error(`[classify] dépôt non mis à jour après le rangement : ${updated.error?.message ?? 'statut changé entre-temps'}`)
    const removed = await admin.from('project_files').delete().eq('id', file.id)
    if (removed.error) console.error(`[classify] fichier rangé non supprimé : ${removed.error.message}`)
    await moveBack()
    return null
  }
  console.log(`[classify] rangé automatiquement par la règle ${rule.id}`)
  return updated.data as FileIntake
}
