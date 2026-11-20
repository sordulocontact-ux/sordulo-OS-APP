import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../components/ui'
import { ApiRequestError } from '../../lib/api'
import { queryKeys } from '../../lib/queryKeys'
import { createWrittenInputFromDocument } from './createDocumentInput'
import { DocumentError, documentKind } from './documentText'

export interface DocumentImportState {
  /** Files left to import in the current batch (0 = idle). */
  remaining: number
  importFiles: (files: File[]) => Promise<void>
}

/**
 * One written entry per document (text extracted in the browser), analysed like a pasted feedback.
 * Unsupported files of a folder are skipped silently; the others report their own error.
 */
export function useDocumentImport(projectId: string): DocumentImportState {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [remaining, setRemaining] = useState(0)

  const importFiles = useCallback(
    async (files: File[]) => {
      const supported = files.filter((file) => documentKind(file.name, file.type))
      if (supported.length === 0) {
        toast.error(
          files.length === 1
            ? `« ${files[0]?.name ?? ''} » : format non pris en charge (PDF, Word .docx ou texte).`
            : 'Aucun document pris en charge (PDF, Word .docx ou texte).',
        )
        return
      }
      setRemaining(supported.length)
      let created = 0
      for (const file of supported) {
        try {
          await createWrittenInputFromDocument(file, projectId)
          created += 1
          void queryClient.invalidateQueries({ queryKey: queryKeys.inputs(projectId) })
        } catch (e) {
          toast.error(
            e instanceof DocumentError || e instanceof ApiRequestError
              ? e.message
              : `« ${file.name} » : une erreur est survenue.`,
          )
        } finally {
          setRemaining((n) => n - 1)
        }
      }
      if (created > 0) {
        toast.success(created === 1 ? 'Document ajouté, analyse en cours.' : `${created} documents ajoutés, analyse en cours.`)
      }
    },
    [projectId, queryClient, toast],
  )

  return { remaining, importFiles }
}
