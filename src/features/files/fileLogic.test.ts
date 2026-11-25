import { describe, expect, it } from 'vitest'
import type { FileIntake, ProjectFile } from '../../shared/types'
import {
  alwaysLabel,
  cleanFolderName,
  confidenceWord,
  fileErrorText,
  filesInFolder,
  folderCounts,
  folderList,
  formatSize,
  initialDraft,
  intakeState,
  kindForFolder,
  latestVersions,
  planUpload,
  planUploadAsVersion,
  previewKind,
  resolveVersionGroup,
  sureIntakes,
  versionHistory,
  versionLabel,
} from './fileLogic'

function file(overrides: Partial<ProjectFile> & { id: string }): ProjectFile {
  return {
    organization_id: 'o',
    project_id: 'p1',
    folder: 'Devis',
    name: 'Devis Ibé.pdf',
    storage_path: `o/p1/${overrides.id}`,
    mime_type: 'application/pdf',
    size_bytes: 1000,
    sha256: overrides.id,
    kind: 'quote',
    summary: null,
    version_group_id: overrides.id,
    version: 1,
    change_summary: null,
    quote_id: null,
    invoice_id: null,
    uploaded_by: null,
    deleted_at: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

function intake(overrides: Partial<FileIntake> = {}): FileIntake {
  return {
    id: 'i1',
    organization_id: 'o',
    created_by: 'm',
    source: 'web',
    batch_id: null,
    storage_path: 'o/inbox/m/x',
    name: 'devis.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    sha256: 'abc',
    extracted_text: null,
    proposal: {
      kind: 'quote',
      client_id: 'c1',
      project_id: 'p1',
      folder: 'Devis',
      title: 'Devis',
      summary: null,
      document_number: null,
      document_date: null,
      amount_ttc_cents: null,
      confidence: 0.9,
      reasons: [],
      linked_quote_id: 'q1',
      linked_invoice_id: null,
      duplicate_of_file_id: null,
      previous_version_file_id: 'f1',
      change_summary: null,
      suggest_import: false,
      suggest_tickets: false,
    },
    confidence: 0.9,
    status: 'ready',
    error_message: null,
    filed_file_id: null,
    auto_filed: false,
    rule_id: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

describe('versions et dossiers', () => {
  const v1 = file({ id: 'a', created_at: '2026-11-01T10:00:00Z' })
  const v2 = file({ id: 'b', version_group_id: 'a', version: 2, created_at: '2026-11-02T10:00:00Z' })
  const other = file({ id: 'c', name: 'Moodboard.png', folder: 'Idées', kind: 'other', created_at: '2026-11-03T10:00:00Z' })
  const trashed = file({ id: 'd', deleted_at: '2026-11-04T10:00:00Z', folder: 'Contrats' })
  const all = [v1, v2, other, trashed]

  it('garde la dernière version vivante par groupe', () => {
    expect(latestVersions(all).map((f) => f.id).sort()).toEqual(['b', 'c'])
  })

  it('retombe sur la version précédente si la dernière est en corbeille', () => {
    const gone = { ...v2, deleted_at: '2026-11-05T10:00:00Z' }
    expect(latestVersions([v1, gone]).map((f) => f.id)).toEqual(['a'])
  })

  it('liste les dossiers types puis les dossiers libres présents', () => {
    const list = folderList(all)
    expect(list.slice(0, 8)).toEqual(['Devis', 'Factures', 'Contrats', 'Briefs', 'Maquettes', 'Retours', 'Livrables', 'Divers'])
    expect(list.at(-1)).toBe('Idées')
    expect(list).not.toContain('Contrats ')
  })

  it('compte les fichiers par dossier sans la corbeille ni les anciennes versions', () => {
    const counts = folderCounts(all)
    expect(counts.get('Devis')).toBe(1)
    expect(counts.get('Contrats')).toBeUndefined()
    expect(counts.get('Idées')).toBe(1)
  })

  it('trie un dossier par date ou par nom', () => {
    const a = file({ id: 'x', name: 'b.pdf', created_at: '2026-11-01T00:00:00Z' })
    const b = file({ id: 'y', name: 'a.pdf', created_at: '2026-11-02T00:00:00Z' })
    expect(filesInFolder([a, b], 'Devis', 'recent').map((f) => f.id)).toEqual(['y', 'x'])
    expect(filesInFolder([a, b], 'Devis', 'name').map((f) => f.id)).toEqual(['y', 'x'])
    expect(filesInFolder([a, b], 'Devis', 'name')[0]?.name).toBe('a.pdf')
  })

  it('historique : plus récente d’abord, corbeille comprise', () => {
    expect(versionHistory(all, 'a').map((f) => f.version)).toEqual([2, 1])
  })

  it('libelle les versions à partir de la 2e', () => {
    expect(versionLabel(1)).toBe('')
    expect(versionLabel(3)).toBe('V3')
  })

  it('déduit le type du dossier', () => {
    expect(kindForFolder('Devis')).toBe('quote')
    expect(kindForFolder('Divers')).toBe('other')
    expect(kindForFolder('Idées')).toBe('other')
  })

  it('valide un nom de dossier', () => {
    expect(cleanFolderName('  Photos   terrain ')).toEqual({ ok: true, value: 'Photos terrain' })
    expect(cleanFolderName('   ').ok).toBe(false)
    expect(cleanFolderName('x'.repeat(81)).ok).toBe(false)
  })
})

describe('planUpload', () => {
  const existing = [file({ id: 'a', name: 'Devis Ibé v2.pdf', sha256: 'h1' }), file({ id: 'b', name: 'Moodboard.png', sha256: 'h2' })]

  it('signale un doublon par empreinte, même avec un autre nom', () => {
    expect(planUpload(existing, { name: 'copie.pdf', sha256: 'h2' })).toEqual({ type: 'duplicate', file: existing[1] })
  })

  it('propose une nouvelle version pour un nom proche', () => {
    const plan = planUpload(existing, { name: 'devis-ibe-v3.pdf', sha256: 'new' })
    expect(plan).toEqual({ type: 'version', file: existing[0] })
  })

  it('un nouveau nom est un nouveau fichier', () => {
    expect(planUpload(existing, { name: 'Contrat.pdf', sha256: 'new' })).toEqual({ type: 'new' })
  })

  it('ignore la corbeille', () => {
    const trashed = [file({ id: 'z', sha256: 'h9', deleted_at: '2026-11-02T00:00:00Z' })]
    expect(planUpload(trashed, { name: 'Autre.pdf', sha256: 'h9' })).toEqual({ type: 'new' })
  })

  it('version demandée : doublon exact seulement, sinon dernière version du groupe', () => {
    const v1 = file({ id: 'a', sha256: 'h1' })
    const v2 = file({ id: 'b', version_group_id: 'a', version: 2, sha256: 'h2' })
    expect(planUploadAsVersion([v1, v2], v1, 'h2')).toEqual({ type: 'duplicate', file: v2 })
    expect(planUploadAsVersion([v1, v2], v1, 'h3')).toEqual({ type: 'version', file: v2 })
  })

  it('résout le groupe de version dans le bon projet', () => {
    const f = file({ id: 'a', version_group_id: 'g' })
    expect(resolveVersionGroup([f], 'a', 'p1')).toBe('g')
    expect(resolveVersionGroup([f], 'a', 'p2')).toBeNull()
    expect(resolveVersionGroup([f], '', 'p1')).toBeNull()
  })
})

describe('libellés', () => {
  it('formate les tailles', () => {
    expect(formatSize(null)).toBe('')
    expect(formatSize(12)).toBe('12 o')
    expect(formatSize(340_000)).toBe('340 Ko')
    expect(formatSize(1_200_000)).toBe('1,2 Mo')
    expect(formatSize(100_000_000)).toBe('100 Mo')
  })

  it('reconnaît les aperçus possibles', () => {
    expect(previewKind('a.pdf', null)).toBe('pdf')
    expect(previewKind('a.PNG', null)).toBe('image')
    expect(previewKind('a', 'image/jpeg')).toBe('image')
    expect(previewKind('a.docx', null)).toBe('none')
    expect(previewKind('a.svg', 'image/svg+xml')).toBe('none')
  })

  it('formule la règle « Toujours »', () => {
    expect(alwaysLabel('quote', 'Ibé')).toBe('Toujours ranger les devis de Ibé ainsi')
    expect(alwaysLabel('other', null)).toBe('Toujours ranger les autres documents de ce client ainsi')
  })

  it('explique l’erreur 23503', () => {
    expect(fileErrorText({ code: '23503', message: 'fk' })).toContain('livrable')
    expect(fileErrorText(new Error('boum'))).toBe('boum')
    expect(fileErrorText(null)).toContain('erreur')
  })
})

describe('dépôts', () => {
  it('classe l’état d’un dépôt', () => {
    expect(intakeState(intake())).toBe('sure')
    expect(intakeState(intake({ confidence: 0.4 }))).toBe('check')
    expect(intakeState(intake({ status: 'classifying' }))).toBe('pending')
    expect(intakeState(intake({ status: 'error' }))).toBe('error')
    expect(intakeState(intake({ status: 'filed', auto_filed: true }))).toBe('auto')
    expect(intakeState(intake({ status: 'filed' }))).toBe('filed')
    expect(intakeState(intake({ status: 'cancelled' }))).toBe('cancelled')
  })

  it('dit Sûr ou À vérifier', () => {
    expect(confidenceWord(intake())).toBe('Sûr')
    expect(confidenceWord(intake({ confidence: 0.2 }))).toBe('À vérifier')
  })

  it('ne garde que les dépôts sûrs pour « Tout ranger »', () => {
    const list = [intake({ id: 'a' }), intake({ id: 'b', confidence: 0.1 }), intake({ id: 'c', status: 'error' })]
    expect(sureIntakes(list).map((i) => i.id)).toEqual(['a'])
  })

  it('construit le brouillon depuis la proposition', () => {
    const draft = initialDraft(intake(), [{ id: 'p1', name: 'App', client_id: 'c1' }])
    expect(draft).toMatchObject({ clientId: 'c1', projectId: 'p1', kind: 'quote', folder: 'Devis', name: 'devis.pdf', quoteId: 'q1', versionFileId: 'f1' })
  })

  it('retrouve le client par le projet si la proposition n’en donne pas', () => {
    const base = intake()
    const draft = initialDraft({ ...base, proposal: { ...base.proposal!, client_id: null } }, [{ id: 'p1', name: 'App', client_id: 'cX' }])
    expect(draft.clientId).toBe('cX')
  })
})
