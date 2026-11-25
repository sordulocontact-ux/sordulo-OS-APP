/**
 * Envoi d'une nouvelle version d'un livrable : fichier dans le bucket « files »
 * (`<org>/<project_id>/<uuid>-<nom>`), ligne project_files (dossier Livrables, type deliverable,
 * dans le même groupe de versions que le fichier de la version précédente), puis
 * deliverable_versions (la base numérote V1, V2…). Une étape qui échoue défait les précédentes.
 */
import { supabase } from '../../lib/supabase'
import { DELIVERABLE_FILE_KIND, DELIVERABLE_FOLDER, deliverableStoragePath, validateDeliverableFile } from './deliverableLogic'

export interface UploadVersionInput {
  organizationId: string
  projectId: string
  deliverableId: string
  file: File
  note: string | null
  /** Groupe de versions du fichier de la version précédente (les fichiers du projet suivent les versions). */
  previousVersionGroupId: string | null
}

const BUCKET = 'files'

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

async function removeObject(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path])
}

export async function uploadDeliverableVersion(input: UploadVersionInput): Promise<void> {
  const invalid = validateDeliverableFile(input.file)
  if (invalid) throw new Error(invalid)

  const path = deliverableStoragePath(input.organizationId, input.projectId, crypto.randomUUID(), input.file.name)
  const sha256 = await sha256Hex(input.file)

  const uploaded = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || undefined,
    upsert: false,
  })
  if (uploaded.error) throw new Error(`Envoi du fichier impossible : ${uploaded.error.message}`)

  const fileRow = await supabase
    .from('project_files')
    .insert({
      project_id: input.projectId,
      folder: DELIVERABLE_FOLDER,
      name: input.file.name.slice(0, 255) || 'fichier',
      storage_path: path,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      sha256,
      kind: DELIVERABLE_FILE_KIND,
      ...(input.previousVersionGroupId ? { version_group_id: input.previousVersionGroupId } : {}),
    })
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>()
  if (fileRow.error) {
    await removeObject(path)
    throw fileRow.error
  }

  const version = await supabase
    .from('deliverable_versions')
    .insert({ deliverable_id: input.deliverableId, file_id: fileRow.data.id, note: input.note })
  if (version.error) {
    await supabase.from('project_files').delete().eq('id', fileRow.data.id)
    await removeObject(path)
    throw version.error
  }
}
