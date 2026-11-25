import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeStorage, attachFakeStorage } from '../../api/_lib/files/fakeStorage'
import { FakeSupabase } from '../../api/_lib/testing/fake-supabase'
import type { FileIntake, FileIntakeProposal } from '../shared/types'
import { FilingError, choiceFromProposal, createFilingApi, extractIntakeText, mapWithConcurrency, sha256Hex, type FilingApi } from './filing'

const ORG = '11111111-1111-4111-8111-111111111111'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IBE = '21111111-1111-4111-8111-111111111111'
const APP_IBE = '31111111-1111-4111-8111-111111111111'
const SITE_IBE = '31111111-1111-4111-8111-111111111112'
const QUOTE = '41111111-1111-4111-8111-111111111111'
const PREVIOUS = '61111111-1111-4111-8111-111111111111'

let db: FakeSupabase
let storage: FakeStorage
let runAi: ReturnType<typeof vi.fn>
let filing: FilingApi
let counter = 0

function proposal(overrides: Partial<FileIntakeProposal> = {}): FileIntakeProposal {
  return {
    kind: 'quote',
    client_id: IBE,
    project_id: APP_IBE,
    folder: 'Devis',
    title: 'Devis App Ibé',
    summary: 'Devis de la refonte.',
    document_number: 'D-2026-012',
    document_date: null,
    amount_ttc_cents: null,
    confidence: 0.9,
    reasons: [],
    linked_quote_id: QUOTE,
    linked_invoice_id: null,
    duplicate_of_file_id: null,
    previous_version_file_id: null,
    change_summary: null,
    suggest_import: false,
    suggest_tickets: false,
    ...overrides,
  }
}

/** Simule l'action classify : proposition écrite par le serveur, dépôt prêt. */
function serverClassifies(overrides: Partial<FileIntakeProposal> = {}) {
  return async (_action: string, body: { intakeId: string }) => {
    const row = db.rows('file_intakes').find((r) => r.id === body.intakeId)!
    Object.assign(row, { status: 'ready', proposal: proposal(overrides), confidence: 0.9 })
    return { intake: structuredClone(row) as unknown as FileIntake }
  }
}

function file(name: string, content = 'contenu', type = 'text/plain'): File {
  return new File([content], name, { type })
}

const intakes = () => db.rows('file_intakes') as unknown as FileIntake[]
const files = () => db.rows('project_files')

async function readyIntake(overrides: Partial<FileIntakeProposal> = {}): Promise<FileIntake> {
  runAi.mockImplementationOnce(serverClassifies(overrides))
  const { intake } = await filing.startIntake(file('Devis Ibé v3.pdf', '%PDF', 'application/pdf'), {
    source: 'island',
    organizationId: ORG,
    memberId: SACHA,
  })
  return intake
}

beforeEach(() => {
  counter = 0
  db = new FakeSupabase()
  storage = new FakeStorage()
  attachFakeStorage(db.client, storage, ['project_files', 'file_intakes', 'filing_rules'])
  db.seed('projects', [
    { id: APP_IBE, organization_id: ORG, client_id: IBE, name: 'App Ibé' },
    { id: SITE_IBE, organization_id: ORG, client_id: IBE, name: 'Site Ibé' },
  ])
  runAi = vi.fn()
  filing = createFilingApi({
    supabase: db.client as unknown as SupabaseClient,
    runAi: runAi as unknown as Parameters<typeof createFilingApi>[0]['runAi'],
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-25T10:00:00Z'),
    extractText: async (f) => (f.type === 'application/pdf' ? 'DEVIS D-2026-012' : null),
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('fichier : empreinte, texte, parallélisme', () => {
  it('calcule le SHA-256 en hexadécimal', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('extrait le texte d’un fichier texte, rien pour une image, tronque à 20 000 caractères', async () => {
    expect(await extractIntakeText(file('notes.md', '  Retours   du client \n\n\n\nsuite '))).toBe('Retours du client\n\nsuite')
    expect(await extractIntakeText(file('photo.png', 'png', 'image/png'))).toBeNull()
    expect(await extractIntakeText(file('vide.txt', '   '))).toBeNull()
    expect(await extractIntakeText(file('long.txt', 'x'.repeat(30_000)))).toHaveLength(20_000)
  })

  it('limite le nombre de tâches en même temps et garde l’ordre', async () => {
    let running = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - n)))
      running--
      return n * 10
    })
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(peak).toBe(3)
  })
})

describe('startIntake / startBatch', () => {
  it('envoie dans l’inbox du membre, crée le dépôt et le fait classer', async () => {
    const intake = await readyIntake()
    const row = intakes()[0]!
    expect(row.storage_path).toBe(`${ORG}/inbox/${SACHA}/00000000-0000-4000-8000-000000000001-Devis-Ibe-v3.pdf`)
    expect(storage.objects.has(row.storage_path)).toBe(true)
    expect(row).toMatchObject({ organization_id: ORG, source: 'island', name: 'Devis Ibé v3.pdf', mime_type: 'application/pdf', size_bytes: 4, extracted_text: 'DEVIS D-2026-012' })
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(runAi).toHaveBeenCalledWith('classify', { intakeId: row.id, mode: 'classify' })
    expect(intake.status).toBe('ready')
  })

  it('classement en échec : le dépôt relu et le message', async () => {
    runAi.mockImplementationOnce(async (_a: string, body: { intakeId: string }) => {
      Object.assign(db.rows('file_intakes').find((r) => r.id === body.intakeId)!, { status: 'error', error_message: 'Classement impossible : Claude a refusé.' })
      throw new Error('Erreur 502')
    })
    const outcome = await filing.startIntake(file('a.pdf', '%PDF', 'application/pdf'), { source: 'web', organizationId: ORG, memberId: SACHA })
    expect(outcome.intake.status).toBe('error')
    expect(outcome.classifyError).toBe('Classement impossible : Claude a refusé.')
  })

  it('refuse un fichier vide ; envoi refusé : rien n’est créé ; dépôt refusé : l’objet est retiré', async () => {
    await expect(filing.startIntake(file('vide.txt', ''), { source: 'web', organizationId: ORG, memberId: SACHA })).rejects.toThrow('est vide')
    storage.refuse('upload')
    await expect(filing.startIntake(file('a.txt'), { source: 'web', organizationId: ORG, memberId: SACHA })).rejects.toThrow(FilingError)
    expect(intakes()).toHaveLength(0)
    storage.allow('upload')
    db.failNext('file_intakes', 'insert', { message: 'refusé', code: '42501' })
    await expect(filing.startIntake(file('a.txt'), { source: 'web', organizationId: ORG, memberId: SACHA })).rejects.toThrow('accès refusé')
    expect(storage.objects.size).toBe(0)
  })

  it('lot : batch_id commun, progression, une erreur n’arrête pas les autres', async () => {
    runAi.mockImplementation(serverClassifies())
    const progress: number[] = []
    const result = await filing.startBatch([file('a.txt'), file('vide.txt', ''), file('c.txt')], {
      source: 'island',
      organizationId: ORG,
      memberId: SACHA,
      onProgress: ({ done, total }) => progress.push(done / total),
    })
    expect(result.items.map((i) => i.error === null)).toEqual([true, false, true])
    expect(new Set(intakes().map((i) => i.batch_id))).toEqual(new Set([result.batchId]))
    expect(progress).toHaveLength(3)
    expect(progress.at(-1)).toBe(1)
    expect(await filing.listBatch(result.batchId)).toHaveLength(2)
  })
})

describe('fileIntake', () => {
  it('range : objet déplacé, fichier créé avec le devis relié, dépôt rangé ; idempotent', async () => {
    const intake = await readyIntake()
    const choice = choiceFromProposal(intake)!
    const result = await filing.fileIntake(intake.id, choice)
    expect(result.intake.status).toBe('filed')
    expect(result.intake.filed_file_id).toBe(result.file.id)
    expect(result.file).toMatchObject({ project_id: APP_IBE, folder: 'Devis', kind: 'quote', name: 'Devis Ibé v3.pdf', quote_id: QUOTE, summary: 'Devis de la refonte.' })
    expect(result.file.storage_path.startsWith(`${ORG}/${APP_IBE}/`)).toBe(true)
    expect(storage.objects.has(result.file.storage_path)).toBe(true)
    expect(storage.objects.has(intake.storage_path)).toBe(false)

    const again = await filing.fileIntake(intake.id, choice)
    expect(again.file.id).toBe(result.file.id)
    expect(files()).toHaveLength(1)
  })

  it('nouvelle version : groupe de la version précédente proposée, dans le même projet seulement', async () => {
    db.seed('project_files', [{ id: PREVIOUS, organization_id: ORG, project_id: APP_IBE, version_group_id: PREVIOUS, version: 1, deleted_at: null, storage_path: 'x' }])
    const intake = await readyIntake({ previous_version_file_id: PREVIOUS, change_summary: 'Total revu.' })
    const { file: filed } = await filing.fileIntake(intake.id, choiceFromProposal(intake)!)
    expect(filed.version_group_id).toBe(PREVIOUS)
    expect(filed.change_summary).toBe('Total revu.')

    const other = await readyIntake({ previous_version_file_id: PREVIOUS, change_summary: 'Total revu.' })
    const { file: elsewhere } = await filing.fileIntake(other.id, { ...choiceFromProposal(other)!, projectId: SITE_IBE })
    expect(elsewhere.version_group_id).toBe(elsewhere.id)
    expect(elsewhere.change_summary).toBeNull()
  })

  it('« Toujours » : révoque l’ancienne règle du client et du type, crée la nouvelle', async () => {
    db.seed('filing_rules', [{ id: 'old', organization_id: ORG, client_id: IBE, kind: 'quote', project_id: null, folder: null, revoked_at: null }])
    const intake = await readyIntake()
    const result = await filing.fileIntake(intake.id, { ...choiceFromProposal(intake)!, always: true })
    expect(result.ruleError).toBeNull()
    expect(result.rule).toMatchObject({ client_id: IBE, kind: 'quote', project_id: null, folder: null })
    expect(db.rows('filing_rules').find((r) => r.id === 'old')!.revoked_at).toBe('2026-11-25T10:00:00.000Z')
    expect(result.intake.rule_id).toBe(result.rule!.id)

    const pinned = await readyIntake({ kind: 'mockup', folder: 'Maquettes', linked_quote_id: null })
    const second = await filing.fileIntake(pinned.id, { ...choiceFromProposal(pinned)!, folder: 'Écrans', always: true, alwaysPinProject: true })
    expect(second.rule).toMatchObject({ kind: 'mockup', project_id: APP_IBE, folder: 'Écrans' })
  })

  it('« Toujours » sans client : rangé quand même, règle en erreur', async () => {
    const intake = await readyIntake({ client_id: null })
    db.rows('projects')[0]!.client_id = null
    const result = await filing.fileIntake(intake.id, { ...choiceFromProposal(intake)!, always: true })
    expect(result.intake.status).toBe('filed')
    expect(result.ruleError).toContain('demande un client')
  })

  it('déplacement refusé (admin, inbox d’un autre membre) : l’objet est copié', async () => {
    const intake = await readyIntake()
    storage.refuse('move')
    const { file: filed } = await filing.fileIntake(intake.id, choiceFromProposal(intake)!)
    expect(storage.objects.has(filed.storage_path)).toBe(true)
    expect(storage.objects.has(intake.storage_path)).toBe(true)
  })

  it('création refusée : l’objet revient dans l’inbox et le dépôt reste à ranger', async () => {
    const intake = await readyIntake()
    db.failNext('project_files', 'insert', { message: 'Le devis n’appartient pas à l’organisation du fichier', code: '23514' })
    await expect(filing.fileIntake(intake.id, choiceFromProposal(intake)!)).rejects.toThrow('Rangement impossible')
    expect(storage.objects.has(intake.storage_path)).toBe(true)
    expect(intakes()[0]!.status).toBe('ready')
  })

  it('refuse un dépôt annulé, un nom vide, un dossier trop long', async () => {
    const intake = await readyIntake()
    const choice = choiceFromProposal(intake)!
    await expect(filing.fileIntake(intake.id, { ...choice, name: '  ' })).rejects.toThrow('nom du fichier est vide')
    await expect(filing.fileIntake(intake.id, { ...choice, kind: 'mockup', folder: 'x'.repeat(81) })).rejects.toThrow('80 caractères')
    await filing.cancelIntake(intake.id)
    await expect(filing.fileIntake(intake.id, choice)).rejects.toThrow('annulé')
  })
})

describe('undoFiling, cancelIntake, règles', () => {
  it('annule un rangement (corbeille) puis le range ailleurs en restaurant la même ligne', async () => {
    const intake = await readyIntake()
    const { file: filed } = await filing.fileIntake(intake.id, choiceFromProposal(intake)!)
    const undone = await filing.undoFiling(intake.id)
    expect(undone.status).toBe('ready')
    expect(undone.filed_file_id).toBe(filed.id)
    expect(files()[0]!.deleted_at).toBe('2026-11-25T10:00:00.000Z')
    expect(await filing.undoFiling(intake.id)).toMatchObject({ status: 'ready' })

    const calls = storage.calls.length
    const again = await filing.fileIntake(intake.id, { ...choiceFromProposal(intake)!, projectId: SITE_IBE, folder: 'Devis signés', kind: 'contract' })
    expect(again.file.id).toBe(filed.id)
    expect(again.file).toMatchObject({ project_id: SITE_IBE, folder: 'Devis signés', kind: 'contract', deleted_at: null, quote_id: null })
    expect(storage.calls.length).toBe(calls)
    expect(again.intake.status).toBe('filed')
  })

  it('annule un rangement automatique comme un rangement manuel', async () => {
    const intake = await readyIntake()
    const { file: filed } = await filing.fileIntake(intake.id, choiceFromProposal(intake)!)
    Object.assign(intakes()[0]!, { auto_filed: true, rule_id: 'r1' })
    const undone = await filing.undoFiling(intake.id)
    expect(undone).toMatchObject({ status: 'ready', auto_filed: true, rule_id: 'r1', filed_file_id: filed.id })
  })

  it('refuse d’annuler ce qui n’est pas rangé', async () => {
    const intake = await readyIntake()
    await expect(filing.undoFiling(intake.id)).rejects.toThrow('n’est pas rangé')
  })

  it('abandonne un dépôt : statut annulé, objet de l’inbox supprimé ; refus si rangé', async () => {
    const intake = await readyIntake()
    const cancelled = await filing.cancelIntake(intake.id)
    expect(cancelled.status).toBe('cancelled')
    expect(storage.objects.has(intake.storage_path)).toBe(false)
    expect(await filing.listPendingIntakes(ORG)).toHaveLength(0)

    const other = await readyIntake()
    expect((await filing.listPendingIntakes(ORG)).map((i) => i.id)).toEqual([other.id])
    await filing.fileIntake(other.id, choiceFromProposal(other)!)
    await expect(filing.cancelIntake(other.id)).rejects.toThrow('annule d’abord le rangement')
  })

  it('révoque une règle et ne liste que les règles actives', async () => {
    db.seed('filing_rules', [
      { id: 'r1', organization_id: ORG, client_id: IBE, kind: 'quote', revoked_at: null, created_at: '2026-11-01' },
      { id: 'r2', organization_id: ORG, client_id: IBE, kind: 'invoice', revoked_at: null, created_at: '2026-11-02' },
    ])
    await filing.revokeFilingRule('r1')
    expect((await filing.listFilingRules(ORG)).map((r) => r.id)).toEqual(['r2'])
  })

  it('import : message du serveur en FilingError', async () => {
    runAi.mockRejectedValueOnce(new Error('L’import d’un devis ou d’une facture depuis un fichier n’est pas encore disponible'))
    await expect(filing.importFromIntake('x')).rejects.toThrow(FilingError)
  })
})
