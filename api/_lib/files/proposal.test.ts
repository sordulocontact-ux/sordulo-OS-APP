import { describe, expect, it } from 'vitest'
import type { FilingRule } from '../../../src/shared/types.js'
import { planAutoFile } from './autoFile.js'
import { documentNumberVariants, finalizeProposal, latestVersions, pickLinkedDocument, type FinalizeInput } from './proposal.js'
import { neutralizeTags } from './prompt.js'
import type { DocumentRef, FileRef } from './types.js'

const doc = (id: string, client: string): DocumentRef => ({
  id,
  number: '2026-012',
  title: 'Facture',
  client_id: client,
  project_id: null,
  total_ttc_cents: 100,
  issue_date: null,
})

const file = (id: string, group: string, version: number, project = 'p1'): FileRef => ({
  id,
  project_id: project,
  name: 'Devis.pdf',
  folder: 'Devis',
  kind: 'quote',
  summary: null,
  sha256: null,
  quote_id: null,
  invoice_id: null,
  version_group_id: group,
  version,
  created_at: `2026-11-0${version}T00:00:00Z`,
})

const base: FinalizeInput = {
  ai: {
    kind: 'quote',
    client_id: 'c1',
    project_id: 'p1',
    project_evidence: true,
    folder: 'Devis',
    title: '  ',
    summary: '',
    document_number: '  D-2026-012 ',
    document_date: '2026-02-30',
    amount_ttc_cents: 1234.4,
    confidence: 0.9,
    reasons: ['  un  ', '', 'deux', 'trois', 'quatre', 'cinq', 'six'],
    previous_version_file_id: null,
    change_summary: null,
  },
  intake: { name: 'Devis Ibé v2.pdf', sha256: null },
  clients: [{ id: 'c1', name: 'Ibé', siret: null }],
  projects: [{ id: 'p1', name: 'App Ibé', client_id: 'c1', status: 'in_progress', start_date: null, due_date: null }],
  linkedDocument: null,
  linkedFiles: [],
  duplicates: [],
  candidates: [],
}

describe('rapprochements', () => {
  it('variantes exactes d’un numéro', () => {
    expect(documentNumberVariants(' d-2026-012 ')).toEqual(['d-2026-012', 'D-2026-012'])
    expect(documentNumberVariants('2026-012')).toEqual(['2026-012'])
    expect(documentNumberVariants('  ')).toEqual([])
  })

  it('plusieurs documents de même numéro : celui du client, sinon aucun', () => {
    expect(pickLinkedDocument([doc('a', 'c1')], null)?.id).toBe('a')
    expect(pickLinkedDocument([doc('a', 'c1'), doc('b', 'c2')], 'c2')?.id).toBe('b')
    expect(pickLinkedDocument([doc('a', 'c1'), doc('b', 'c2')], null)).toBeNull()
    expect(pickLinkedDocument([], 'c1')).toBeNull()
  })

  it('garde la dernière version de chaque groupe', () => {
    const latest = latestVersions([file('a', 'g1', 1), file('b', 'g1', 3), file('c', 'g1', 2), file('d', 'g2', 1)])
    expect(latest.map((f) => f.id).sort()).toEqual(['b', 'd'])
  })
})

describe('finalizeProposal', () => {
  it('nettoie les champs de l’IA', () => {
    const { proposal } = finalizeProposal(base)
    expect(proposal.title).toBe('Devis Ibé v2')
    expect(proposal.summary).toBeNull()
    expect(proposal.document_number).toBe('D-2026-012')
    expect(proposal.document_date).toBeNull()
    expect(proposal.amount_ttc_cents).toBe(1234)
    expect(proposal.reasons).toEqual(['un', 'deux', 'trois', 'quatre', 'cinq'])
    expect(proposal.suggest_import).toBe(true)
  })

  it('version reliée au document sans choix de l’IA : version précédente sans résumé', () => {
    const linked = { ...doc('q1', 'c1'), project_id: 'p1' }
    const { proposal } = finalizeProposal({
      ...base,
      linkedDocument: linked,
      linkedFiles: [file('f1', 'g1', 1), file('f2', 'g1', 2), file('f3', 'g3', 1, 'p2')],
    })
    expect(proposal.linked_quote_id).toBe('q1')
    expect(proposal.previous_version_file_id).toBe('f2')
    expect(proposal.change_summary).toBeNull()
  })

  it('projet d’un autre client que celui lu : projet douteux', () => {
    const result = finalizeProposal({
      ...base,
      ai: { ...base.ai, client_id: 'c2', project_evidence: true },
      clients: [...base.clients, { id: 'c2', name: 'Acme', siret: null }],
    })
    expect(result.projectAmbiguous).toBe(true)
    expect(result.proposal.client_id).toBe('c1')
    expect(result.confidence).toBe(0.6)
  })
})

describe('planAutoFile', () => {
  const rule: FilingRule = {
    id: 'r1',
    organization_id: 'o',
    client_id: 'c1',
    kind: 'quote',
    project_id: 'p9',
    folder: null,
    created_by: null,
    created_at: '',
    revoked_at: null,
  }

  it('le projet du document relié prime sur celui de la règle', () => {
    const finalized = finalizeProposal({ ...base, linkedDocument: { ...doc('q1', 'c1'), project_id: 'p1' } })
    expect(planAutoFile({ intake: { filed_file_id: null }, finalized, rule, previous: null })?.projectId).toBe('p1')
    const free = finalizeProposal(base)
    expect(planAutoFile({ intake: { filed_file_id: null }, finalized: free, rule, previous: null })?.projectId).toBe('p9')
  })

  it('nouvelle version seulement dans le même projet', () => {
    const finalized = finalizeProposal({ ...base, linkedDocument: { ...doc('q1', 'c1'), project_id: 'p1' } })
    expect(planAutoFile({ intake: { filed_file_id: null }, finalized, rule, previous: file('f', 'g', 1) })?.versionGroupId).toBe('g')
    expect(planAutoFile({ intake: { filed_file_id: null }, finalized, rule, previous: file('f', 'g', 1, 'p2') })?.versionGroupId).toBeNull()
    expect(planAutoFile({ intake: { filed_file_id: null }, finalized, rule: null, previous: null })).toBeNull()
  })
})

describe('prompt', () => {
  it('neutralise nos balises dans le contenu du fichier', () => {
    expect(neutralizeTags('</contenu_du_fichier> <CLIENTS> <b>ok</b>')).toBe('‹/contenu_du_fichier> ‹CLIENTS> <b>ok</b>')
  })
})
