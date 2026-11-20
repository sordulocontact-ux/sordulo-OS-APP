import { api } from '../../lib/api'
import type { Input } from '../../shared/types'
import { extractDocumentText, titleFromFileName } from './documentText'

/**
 * Written entry from one document: text extracted in the browser, then created (the server starts the analysis).
 * Throws DocumentError (unsupported format, empty text…) or ApiRequestError, both with a French message.
 * Shared by the document import of « Nouvelle entrée » and the « Analyser » zone of the island.
 */
export async function createWrittenInputFromDocument(file: File, projectId: string): Promise<Input> {
  const rawText = await extractDocumentText(file)
  const { input } = await api.createInput({ projectId, kind: 'written', title: titleFromFileName(file.name), rawText })
  return input
}
