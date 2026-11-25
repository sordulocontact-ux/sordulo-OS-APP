/**
 * Accès aux fichiers rangés d'un projet (table project_files + bucket « files ») pour l'onglet Fichiers.
 * Le rangement des dépôts reste dans src/lib/filing.ts.
 */
import { supabase } from '../../lib/supabase'
import { sha256Hex } from '../../lib/filing'
import { FILE_MAX_BYTES, FILES_BUCKET, projectFilePath } from '../../shared/filing'
import type { FileKind, ProjectFile } from '../../shared/types'
import { cleanFileName, cleanFolderName, fileErrorText } from './fileLogic'

export class FilesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FilesError'
  }
}

function fail(action: string, error: unknown): FilesError {
  return new FilesError(`${action} : ${fileErrorText(error)}`, { cause: error })
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .overrideTypes<ProjectFile[], { merge: false }>()
  if (error) throw fail('Lecture des fichiers impossible', error)
  return data
}

export interface UploadOptions {
  organizationId: string
  projectId: string
  folder: string
  kind: FileKind
  /** Groupe d'une version précédente : la base numérote la nouvelle version. */
  versionGroupId?: string | null
}

/** Empreinte SHA-256 du fichier (doublons). */
export const hashFile = sha256Hex

/** Envoie un fichier dans `<org>/<projet>/` et crée sa ligne project_files. */
export async function uploadProjectFile(file: File, sha256: string, options: UploadOptions): Promise<ProjectFile> {
  if (file.size === 0) throw new FilesError(`« ${file.name} » est vide.`)
  if (file.size > FILE_MAX_BYTES) throw new FilesError(`« ${file.name} » dépasse 100 Mo.`)
  const name = cleanFileName(file.name || 'fichier')
  if (!name.ok) throw new FilesError(name.error)
  const path = projectFilePath(options.organizationId, options.projectId, crypto.randomUUID(), name.value)
  const bucket = supabase.storage.from(FILES_BUCKET)
  const uploaded = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (uploaded.error) throw fail(`Envoi de « ${name.value} » impossible`, uploaded.error)
  const inserted = await supabase
    .from('project_files')
    .insert({
      project_id: options.projectId,
      folder: options.folder,
      name: name.value,
      kind: options.kind,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      sha256,
      ...(options.versionGroupId ? { version_group_id: options.versionGroupId } : {}),
    })
    .select('*')
    .single()
  if (inserted.error || !inserted.data) {
    await bucket.remove([path])
    throw fail(`Enregistrement de « ${name.value} » impossible`, inserted.error ?? { message: 'réponse vide' })
  }
  return inserted.data as ProjectFile
}

/** Renomme et/ou change de dossier. */
export async function updateProjectFile(fileId: string, changes: { name: string; folder: string }): Promise<ProjectFile> {
  const name = cleanFileName(changes.name)
  if (!name.ok) throw new FilesError(name.error)
  const folder = cleanFolderName(changes.folder)
  if (!folder.ok) throw new FilesError(folder.error)
  const { data, error } = await supabase
    .from('project_files')
    .update({ name: name.value, folder: folder.value })
    .eq('id', fileId)
    .select('*')
    .maybeSingle()
  if (error) throw fail('Modification impossible', error)
  if (!data) throw new FilesError('Modification impossible : fichier introuvable ou accès refusé.')
  return data as ProjectFile
}

/** Corbeille : la ligne et l'objet restent, `deleted_at` est posé. */
export async function trashProjectFile(fileId: string): Promise<void> {
  const { error } = await supabase.from('project_files').update({ deleted_at: new Date().toISOString() }).eq('id', fileId)
  if (error) throw fail('Mise à la corbeille impossible', error)
}

export async function restoreProjectFile(fileId: string): Promise<void> {
  const { error } = await supabase.from('project_files').update({ deleted_at: null }).eq('id', fileId)
  if (error) throw fail('Restauration impossible', error)
}

/** Suppression définitive : la ligne d'abord (un livrable qui l'utilise refuse, 23503), puis l'objet. */
export async function deleteProjectFile(file: Pick<ProjectFile, 'id' | 'storage_path'>): Promise<void> {
  const { data, error } = await supabase.from('project_files').delete().eq('id', file.id).select('id')
  if (error) throw fail('Suppression impossible', error)
  if (!data || data.length === 0) throw new FilesError('Suppression impossible : fichier introuvable ou accès refusé.')
  const removed = await supabase.storage.from(FILES_BUCKET).remove([file.storage_path])
  if (removed.error) console.warn(`[files] objet non supprimé : ${removed.error.message}`)
}

/** URL signée courte (2 minutes) pour l'aperçu ; avec `download`, le navigateur enregistre le fichier sous ce nom. */
export async function signedFileUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, 120, download ? { download } : undefined)
  if (error || !data) throw fail('Ouverture du fichier impossible', error ?? { message: 'réponse vide' })
  return data.signedUrl
}

/** Télécharge le fichier sous son nom. */
export async function downloadProjectFile(path: string, name: string): Promise<void> {
  const url = await signedFileUrl(path, name)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Contenu d'un fichier rangé, en File (pour l'envoyer à l'import d'une entrée). */
export async function fetchFileAsFile(path: string, name: string, mimeType: string | null): Promise<File> {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).download(path)
  if (error || !data) throw fail('Téléchargement du fichier impossible', error ?? { message: 'réponse vide' })
  return new File([data], name, { type: mimeType ?? data.type })
}
