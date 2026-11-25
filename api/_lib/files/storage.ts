/**
 * Bucket « files » côté serveur (clé service, contourne les policies) : lecture d'un dépôt pour Claude et
 * déplacement inbox → projet du rangement automatique. Le bucket audio reste dans api/_lib/storage.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FILES_BUCKET } from '../../../src/shared/types.js'

/** Contenu d'un objet en base64 (blocs image / PDF de Claude), ou null s'il est illisible ou trop gros. */
export async function downloadBase64(admin: SupabaseClient, path: string, maxBytes: number): Promise<string | null> {
  const { data, error } = await admin.storage.from(FILES_BUCKET).download(path)
  if (error || !data) {
    console.warn(`[classify] fichier illisible dans le stockage : ${error?.message ?? 'réponse vide'}`)
    return null
  }
  if (data.size > maxBytes) return null
  return Buffer.from(await data.arrayBuffer()).toString('base64')
}

/** Déplace un objet du bucket. Erreur en français. */
export async function moveObject(admin: SupabaseClient, from: string, to: string): Promise<void> {
  const { error } = await admin.storage.from(FILES_BUCKET).move(from, to)
  if (error) throw new Error(`déplacement du fichier impossible (${error.message})`)
}
