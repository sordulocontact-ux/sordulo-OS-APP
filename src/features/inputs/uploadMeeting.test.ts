import { beforeEach, describe, expect, it, vi } from 'vitest'

const createInput = vi.fn()
const processInput = vi.fn()
const uploadToSignedUrl = vi.fn()

vi.mock('../../lib/api', () => {
  class ApiRequestError extends Error {
    readonly status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { ApiRequestError, api: { createInput, processInput } }
})
vi.mock('../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl }) } },
}))

const { ApiRequestError } = await import('../../lib/api')
const { MeetingUploadError, uploadMeetingRecording } = await import('./uploadMeeting')
const { AUDIO_MAX_BYTES } = await import('../../shared/api-contract')

const created = {
  input: { id: 'input-1' },
  upload: { path: 'org/input-1.mp3', token: 'tok', bucket: 'audio' },
}

function params(overrides = {}) {
  return {
    projectId: 'p1',
    title: ' Appel ',
    file: new Blob(['abc'], { type: 'audio/mpeg' }),
    fileName: 'appel.mp3',
    contentType: 'audio/mpeg',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  createInput.mockResolvedValue(created)
  uploadToSignedUrl.mockResolvedValue({ error: null })
  processInput.mockResolvedValue({})
})

describe('uploadMeetingRecording', () => {
  it('creates, uploads, processes and reports the steps', async () => {
    const steps: string[] = []
    const result = await uploadMeetingRecording(params({ onStep: (s: string) => steps.push(s) }))
    expect(result.input.id).toBe('input-1')
    expect(steps).toEqual(['creating', 'uploading', 'processing'])
    expect(createInput).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'meeting', title: 'Appel', sizeBytes: 3, fileName: 'appel.mp3' }),
    )
    expect(uploadToSignedUrl).toHaveBeenCalledWith('org/input-1.mp3', 'tok', expect.any(Blob), { contentType: 'audio/mpeg' })
    expect(processInput).toHaveBeenCalledWith({ inputId: 'input-1' })
  })

  it('resumes after an upload failure without creating a second input', async () => {
    uploadToSignedUrl.mockResolvedValueOnce({ error: { message: 'réseau' } })
    const failure = await uploadMeetingRecording(params()).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(MeetingUploadError)
    const resume = (failure as InstanceType<typeof MeetingUploadError>).resume
    expect(resume.created).toEqual(created)
    expect(resume.uploaded).toBe(false)
    expect(processInput).not.toHaveBeenCalled()

    await uploadMeetingRecording(params({ resume }))
    expect(createInput).toHaveBeenCalledTimes(1)
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(2)
    expect(processInput).toHaveBeenCalledTimes(1)
  })

  it('skips create and upload when both are already done', async () => {
    await uploadMeetingRecording(params({ resume: { created, uploaded: true } }))
    expect(createInput).not.toHaveBeenCalled()
    expect(uploadToSignedUrl).not.toHaveBeenCalled()
    expect(processInput).toHaveBeenCalledTimes(1)
  })

  it('treats a 409 on processing as a success', async () => {
    processInput.mockRejectedValueOnce(new ApiRequestError('déjà en cours', 409))
    const result = await uploadMeetingRecording(params())
    expect(result.input.id).toBe('input-1')
  })

  it('propagates other processing errors with the resume state', async () => {
    processInput.mockRejectedValueOnce(new ApiRequestError('boom', 500))
    const failure = await uploadMeetingRecording(params()).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(MeetingUploadError)
    expect((failure as InstanceType<typeof MeetingUploadError>).resume.uploaded).toBe(true)
  })

  it('rejects an oversized file before any call', async () => {
    const big = { size: AUDIO_MAX_BYTES + 1 } as Blob
    await expect(uploadMeetingRecording(params({ file: big }))).rejects.toBeInstanceOf(MeetingUploadError)
    expect(createInput).not.toHaveBeenCalled()
  })
})
