import { describe, expect, it } from 'vitest'
import {
  baseName,
  defaultFolderFor,
  fileExtension,
  finalConfidence,
  formatConfidence,
  inboxPath,
  isClassifiableImage,
  isClassifiablePdf,
  isInboxPath,
  needsReview,
  normalizeFolder,
  projectFilePath,
  proposalLabel,
  reviewReasons,
  sameDocumentName,
  sanitizeStorageName,
  truncateExtractedText,
  versionKey,
} from './filing.js'
import type { FileIntake, FileIntakeProposal } from './types.js'

const ORG = '11111111-1111-4111-8111-111111111111'
const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const UUID = '33333333-3333-4333-8333-333333333333'

function proposal(overrides: Partial<FileIntakeProposal> = {}): FileIntakeProposal {
  return {
    kind: 'quote',
    client_id: 'c1',
    project_id: PROJECT,
    folder: 'Devis',
    title: 'Devis App Ibé',
    summary: null,
    document_number: 'D-2026-012',
    document_date: '2026-11-20',
    amount_ttc_cents: 120000,
    confidence: 0.9,
    reasons: [],
    linked_quote_id: 'q1',
    linked_invoice_id: null,
    duplicate_of_file_id: null,
    previous_version_file_id: null,
    change_summary: null,
    suggest_import: false,
    suggest_tickets: false,
    ...overrides,
  }
}

function intake(overrides: Partial<Pick<FileIntake, 'status' | 'proposal' | 'confidence'>> = {}) {
  return { status: 'ready' as const, proposal: proposal(), confidence: 0.9, ...overrides }
}

describe('dossiers', () => {
  it('donne le dossier par défaut de chaque type', () => {
    expect(defaultFolderFor('quote')).toBe('Devis')
    expect(defaultFolderFor('invoice')).toBe('Factures')
    expect(defaultFolderFor('mockup')).toBe('Maquettes')
    expect(defaultFolderFor('other')).toBe('Divers')
  })

  it('normalise un dossier, force Devis et Factures', () => {
    expect(normalizeFolder('  Maquettes   V2 ', 'mockup')).toBe('Maquettes V2')
    expect(normalizeFolder('', 'brief')).toBe('Briefs')
    expect(normalizeFolder(null, 'contract')).toBe('Contrats')
    expect(normalizeFolder('Divers', 'quote')).toBe('Devis')
    expect(normalizeFolder('Compta', 'invoice')).toBe('Factures')
    expect(normalizeFolder('x'.repeat(120), 'asset')).toHaveLength(80)
  })
})

describe('noms et chemins', () => {
  it('lit extension et nom de base', () => {
    expect(fileExtension('Devis Ibé v2.PDF')).toBe('pdf')
    expect(fileExtension('README')).toBe('')
    expect(fileExtension('.env')).toBe('')
    expect(baseName('Devis Ibé v2.pdf')).toBe('Devis Ibé v2')
    expect(baseName('dossier/notes')).toBe('notes')
  })

  it('assainit un nom de fichier', () => {
    expect(sanitizeStorageName('Devis Ibé (v2).pdf')).toBe('Devis-Ibe-v2-.pdf')
    expect(sanitizeStorageName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeStorageName('...')).toBe('fichier')
    const long = sanitizeStorageName(`${'a'.repeat(200)}.pdf`)
    expect(long.length).toBeLessThanOrEqual(100)
    expect(long.endsWith('.pdf')).toBe(true)
  })

  it('construit les chemins inbox et projet', () => {
    expect(inboxPath(ORG, MEMBER, UUID, 'Facture été.pdf')).toBe(`${ORG}/inbox/${MEMBER}/${UUID}-Facture-ete.pdf`)
    expect(projectFilePath(ORG, PROJECT, UUID, 'Facture été.pdf')).toBe(`${ORG}/${PROJECT}/${UUID}-Facture-ete.pdf`)
    expect(isInboxPath(inboxPath(ORG, MEMBER, UUID, 'a.pdf'))).toBe(true)
    expect(isInboxPath(projectFilePath(ORG, PROJECT, UUID, 'a.pdf'))).toBe(false)
  })

  it('tronque le texte extrait', () => {
    expect(truncateExtractedText('   ')).toBeNull()
    expect(truncateExtractedText(null)).toBeNull()
    expect(truncateExtractedText(' abc ')).toBe('abc')
    expect(truncateExtractedText('x'.repeat(25_000))).toHaveLength(20_000)
  })

  it('reconnaît les images et PDF lisibles par Claude', () => {
    expect(isClassifiableImage('image/png', 1000)).toBe(true)
    expect(isClassifiableImage('image/png', 6 * 1024 * 1024)).toBe(false)
    expect(isClassifiableImage('image/svg+xml', 1000)).toBe(false)
    expect(isClassifiableImage(null, 1000)).toBe(false)
    expect(isClassifiablePdf('scan.pdf', null, 1000)).toBe(true)
    expect(isClassifiablePdf('scan.bin', 'application/pdf', 11 * 1024 * 1024)).toBe(false)
    expect(isClassifiablePdf('photo.jpg', 'image/jpeg', 10)).toBe(false)
  })
})

describe('versions', () => {
  it('reconnaît deux versions d’un même document', () => {
    expect(versionKey('Devis Ibé v2.pdf')).toBe('devis ibe')
    expect(versionKey('devis-ibe-v3.pdf')).toBe('devis ibe')
    expect(versionKey('Devis_Ibé_version 4 FINAL.pdf')).toBe('devis ibe')
    expect(versionKey('Devis Ibé (1).pdf')).toBe('devis ibe')
    expect(sameDocumentName('Devis Ibé v2.pdf', 'devis-ibe-v3.pdf')).toBe(true)
    expect(sameDocumentName('Maquette accueil rev2.png', 'maquette_accueil.png')).toBe(true)
  })

  it('garde les numéros qui distinguent deux documents', () => {
    expect(sameDocumentName('Facture 2026-012.pdf', 'Facture 2026-013.pdf')).toBe(false)
    expect(sameDocumentName('v2.pdf', 'v3.pdf')).toBe(false)
  })
})

describe('confiance et vérification', () => {
  it('abaisse la confiance sans projet ou avec un projet ambigu', () => {
    expect(finalConfidence({ aiConfidence: 0.93, hasProject: true, projectAmbiguous: false })).toBe(0.93)
    expect(finalConfidence({ aiConfidence: 0.93, hasProject: true, projectAmbiguous: true })).toBe(0.6)
    expect(finalConfidence({ aiConfidence: 0.93, hasProject: false, projectAmbiguous: false })).toBe(0.5)
    expect(finalConfidence({ aiConfidence: 1.7, hasProject: true, projectAmbiguous: false })).toBe(1)
    expect(finalConfidence({ aiConfidence: Number.NaN, hasProject: true, projectAmbiguous: false })).toBe(0)
    expect(finalConfidence({ aiConfidence: 0.876, hasProject: true, projectAmbiguous: false })).toBe(0.88)
  })

  it('valide dans l’île une proposition sûre', () => {
    expect(reviewReasons(intake())).toEqual([])
    expect(needsReview(intake())).toBe(false)
    expect(needsReview(intake({ confidence: 0.75 }))).toBe(false)
  })

  it('demande une vérification dans les autres cas', () => {
    expect(reviewReasons(intake({ status: 'classifying' }))).toEqual(['not_ready'])
    expect(reviewReasons(intake({ proposal: null }))).toEqual(['no_proposal'])
    expect(reviewReasons(intake({ confidence: 0.74 }))).toEqual(['low_confidence'])
    expect(reviewReasons(intake({ confidence: null, proposal: proposal({ confidence: 0.5 }) }))).toEqual(['low_confidence'])
    expect(reviewReasons(intake({ proposal: proposal({ project_id: null }), confidence: 0.5 }))).toEqual(['no_project', 'low_confidence'])
    expect(reviewReasons(intake({ proposal: proposal({ duplicate_of_file_id: 'f1' }) }))).toEqual(['duplicate'])
    expect(reviewReasons(intake({ proposal: proposal({ suggest_import: true, linked_quote_id: null }) }))).toEqual(['import_suggested'])
  })
})

describe('libellés', () => {
  it('écrit le libellé court de l’île', () => {
    expect(proposalLabel(proposal(), { clientName: 'Ibé', projectName: 'App Ibé' })).toBe('Devis D-2026-012 · Ibé › App Ibé')
    expect(proposalLabel(proposal({ kind: 'mockup', document_number: null }), { clientName: 'Ibé', projectName: 'App Ibé' })).toBe(
      'Maquette · Ibé › App Ibé',
    )
    expect(proposalLabel(proposal({ project_id: null }), { clientName: 'Ibé', projectName: 'App Ibé' })).toBe(
      'Devis D-2026-012 · Ibé › projet à choisir',
    )
    expect(proposalLabel(proposal({ kind: 'other', document_number: null, project_id: null, client_id: null }))).toBe(
      'Autre · projet à choisir',
    )
    expect(proposalLabel(proposal(), { projectName: 'App Ibé' })).toBe('Devis D-2026-012 · App Ibé')
  })

  it('formate la confiance', () => {
    expect(formatConfidence(0.823)).toBe('82 %')
    expect(formatConfidence(null)).toBe('non évaluée')
  })
})
