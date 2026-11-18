import { api, ApiRequestError } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { AUDIO_MAX_BYTES, type CreateInputResponse } from '../../shared/api-contract'
import type { Input } from '../../shared/types'
import { formatFileSize } from './inputUtils'

/** Steps of the upload sequence, in order. */
export type UploadStep = 'creating' | 'uploading' | 'processing'

export const UPLOAD_STEP_LABELS: Record<UploadStep, string> = {
  creating: 'Création…',
  uploading: 'Envoi du fichier…',
  processing: 'Lancement de la transcription…',
}

/** What is already done, to resume after a failure without creating a second input or re-uploading. */
export interface UploadResume {
  created: CreateInputResponse | null
  uploaded: boolean
}

export const EMPTY_RESUME: UploadResume = { created: null, uploaded: false }

/** Thrown on failure; `resume` holds the progress to pass back on the next attempt. */
export class MeetingUploadError extends ApiRequestError {
  readonly resume: UploadResume
  constructor(message: string, status: number, resume: UploadResume) {
    super(message, status)
    this.resume = resume
  }
}

export interface UploadMeetingParams {
  projectId: string
  title?: string
  file: Blob
  fileName: string
  contentType: string
  resume?: UploadResume
  onStep?: (step: UploadStep) => void
  /** Called as soon as the input exists (before the upload). */
  onCreated?: (created: CreateInputResponse) => void
}

/**
 * The single audio-sending sequence of the app (manual upload and desktop recording):
 * create the meeting input, upload the file to the signed URL, start processing.
 * A 409 on processing means a processing is already running, which counts as success.
 */
export async function uploadMeetingRecording(params: UploadMeetingParams): Promise<{ input: Input }> {
  const { projectId, title, file, fileName, contentType, onStep, onCreated } = params
  const resume: UploadResume = { ...(params.resume ?? EMPTY_RESUME) }
  const fail = (e: unknown): never => {
    if (e instanceof ApiRequestError) throw new MeetingUploadError(e.message, e.status, resume)
    throw new MeetingUploadError('Une erreur est survenue. Réessaie.', 0, resume)
  }

  if (file.size <= 0) throw new MeetingUploadError('Ce fichier est vide.', 0, resume)
  if (file.size > AUDIO_MAX_BYTES) {
    throw new MeetingUploadError(
      `Ce fichier est trop volumineux (${formatFileSize(file.size)}). Maximum : ${formatFileSize(AUDIO_MAX_BYTES)}.`,
      0,
      resume,
    )
  }

  try {
    if (!resume.created) {
      onStep?.('creating')
      resume.created = await api.createInput({
        projectId,
        kind: 'meeting',
        title: title?.trim() || undefined,
        fileName,
        contentType,
        sizeBytes: file.size,
      })
      onCreated?.(resume.created)
    }
    const created = resume.created
    if (!resume.uploaded) {
      const { upload } = created
      if (!upload) throw new ApiRequestError("Le serveur n'a pas fourni d'adresse d'envoi.", 500)
      onStep?.('uploading')
      const { error: uploadError } = await supabase.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file, { contentType })
      if (uploadError) {
        throw new ApiRequestError(`L'envoi du fichier a échoué (${uploadError.message}). Réessaie.`, 0)
      }
      resume.uploaded = true
    }
    onStep?.('processing')
    try {
      await api.processInput({ inputId: created.input.id })
    } catch (e) {
      // 409: a processing is already running, which is what we wanted.
      if (!(e instanceof ApiRequestError && e.status === 409)) throw e
    }
    return { input: created.input }
  } catch (e) {
    return fail(e)
  }
}
