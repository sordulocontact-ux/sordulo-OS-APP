/**
 * Dépôts et notifications d'exemple pour les tests du rangement et le labo de l'île. Pur, sans réseau.
 */
import type { BatchItem } from '../../../lib/filing'
import type { AppNotification, FileIntake, FileIntakeProposal, ProjectFile } from '../../../shared/types'
import type { FilingNames } from './filing'

export const SAMPLE_BATCH_ID = 'batch-1'

export const SAMPLE_NAMES: FilingNames = {
  clients: { 'c-ibe': 'Ibé' },
  projects: { 'p-ibe': 'App Ibé', 'p-site': 'Site Sordulo' },
}

export function sampleProposal(over: Partial<FileIntakeProposal> = {}): FileIntakeProposal {
  return {
    kind: 'quote',
    client_id: 'c-ibe',
    project_id: 'p-ibe',
    folder: 'Devis',
    title: 'Devis D-2026-012',
    summary: 'Devis de la refonte de l’app',
    document_number: 'D-2026-012',
    document_date: '2026-11-20',
    amount_ttc_cents: 420_000,
    confidence: 0.92,
    reasons: ['Numéro D-2026-012 lu dans le document'],
    linked_quote_id: null,
    linked_invoice_id: null,
    duplicate_of_file_id: null,
    previous_version_file_id: null,
    change_summary: null,
    suggest_import: false,
    suggest_tickets: false,
    ...over,
  }
}

export function sampleIntake(over: Partial<FileIntake> = {}): FileIntake {
  const proposal = over.proposal === undefined ? sampleProposal() : over.proposal
  return {
    id: 'in-1',
    organization_id: 'o-1',
    created_by: 'm-1',
    source: 'island',
    batch_id: SAMPLE_BATCH_ID,
    storage_path: 'o-1/inbox/m-1/x-devis-ibe.pdf',
    name: 'devis-ibe.pdf',
    mime_type: 'application/pdf',
    size_bytes: 12_000,
    sha256: 'abc',
    extracted_text: null,
    confidence: proposal?.confidence ?? null,
    status: 'ready',
    error_message: null,
    filed_file_id: null,
    auto_filed: false,
    rule_id: null,
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:00:00Z',
    ...over,
    proposal,
  }
}

/** Résultat d'un fichier d'un lot (startBatch), le File remplacé par son nom. */
export function sampleBatchItem(intake: FileIntake | null, options: { classifyError?: string | null; error?: string; name?: string } = {}) {
  const name = options.name ?? intake?.name ?? 'fichier.pdf'
  const file = { name } as File
  const item: BatchItem = intake
    ? { file, outcome: { intake, classifyError: options.classifyError ?? null }, error: options.classifyError ?? null }
    : { file, outcome: null, error: options.error ?? 'Envoi impossible : réseau coupé' }
  return item
}

export function sampleFiledFile(over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'f-1',
    organization_id: 'o-1',
    project_id: 'p-ibe',
    folder: 'Devis',
    name: 'devis-ibe.pdf',
    storage_path: 'o-1/p-ibe/x-devis-ibe.pdf',
    mime_type: 'application/pdf',
    size_bytes: 12_000,
    sha256: 'abc',
    kind: 'quote',
    summary: null,
    version_group_id: 'f-1',
    version: 1,
    change_summary: null,
    quote_id: null,
    invoice_id: null,
    uploaded_by: 'm-1',
    deleted_at: null,
    created_at: '2026-11-25T10:00:00Z',
    updated_at: '2026-11-25T10:00:00Z',
    ...over,
  }
}

/** Cas du labo et des tests : un lot classé. */
export type SampleFilingCase = 'sure' | 'three' | 'review' | 'duplicate' | 'auto' | 'error' | 'version'

export function sampleBatchItems(kind: SampleFilingCase): BatchItem[] {
  switch (kind) {
    case 'sure':
      return [sampleBatchItem(sampleIntake())]
    case 'version':
      return [
        sampleBatchItem(
          sampleIntake({
            name: 'devis-ibe-v2.pdf',
            proposal: sampleProposal({ previous_version_file_id: 'f-0', change_summary: 'Prix du lot 2 revu' }),
          }),
        ),
      ]
    case 'three':
      return [
        sampleBatchItem(sampleIntake()),
        sampleBatchItem(
          sampleIntake({
            id: 'in-2',
            name: 'facture-ibe.pdf',
            proposal: sampleProposal({ kind: 'invoice', folder: 'Factures', document_number: 'F-2026-0007', title: 'Facture F-2026-0007' }),
          }),
        ),
        sampleBatchItem(
          sampleIntake({
            id: 'in-3',
            name: 'maquette-accueil.png',
            proposal: sampleProposal({ kind: 'mockup', folder: 'Maquettes', document_number: null, title: 'Maquette accueil' }),
          }),
        ),
      ]
    case 'review':
      return [
        sampleBatchItem(
          sampleIntake({
            name: 'contrat-scan.pdf',
            confidence: 0.55,
            proposal: sampleProposal({ kind: 'contract', folder: 'Contrats', project_id: null, confidence: 0.55, document_number: null }),
          }),
        ),
      ]
    case 'duplicate':
      return [sampleBatchItem(sampleIntake({ proposal: sampleProposal({ duplicate_of_file_id: 'f-9' }) }))]
    case 'auto':
      return [sampleBatchItem(sampleIntake({ status: 'filed', auto_filed: true, filed_file_id: 'f-1', rule_id: 'r-1' }))]
    case 'error':
      return [
        sampleBatchItem(sampleIntake({ status: 'error', proposal: null, error_message: 'Le modèle n’a pas répondu' }), {
          classifyError: 'Le modèle n’a pas répondu',
        }),
      ]
  }
}

/** Notification de la base d'exemple. */
export function sampleAppNotification(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n-1',
    organization_id: 'o-1',
    member_id: 'm-1',
    kind: 'prospect.created',
    title: 'Gabi a ajouté un site : Boulangerie Lemoine',
    body: 'boulangerie-lemoine.fr',
    link: '/prospects/pr-1',
    payload: { prospect_id: 'pr-1' },
    dedupe_key: null,
    read_at: null,
    created_at: '2026-11-25T10:00:00Z',
    ...over,
  }
}

/** Une notification de la base par type affiché dans l'île (labo). */
export const SAMPLE_APP_NOTIFICATIONS: Readonly<Record<string, AppNotification>> = {
  'prospect.created': sampleAppNotification(),
  'prospect.offer_ready': sampleAppNotification({
    id: 'n-2',
    kind: 'prospect.offer_ready',
    title: 'Offre prête pour Boulangerie Lemoine',
    body: 'L’audit est fait et l’offre est choisie : à toi de jouer.',
  }),
  'input.ready': sampleAppNotification({
    id: 'n-3',
    kind: 'input.ready',
    title: 'Tickets à valider : Call Ibé du 24/11',
    body: '5 tickets proposés',
    link: '/projects/p-ibe/inputs/i-9/review',
    payload: { input_id: 'i-9', project_id: 'p-ibe', ticket_count: 5 },
  }),
  'proposal.created': sampleAppNotification({
    id: 'n-4',
    kind: 'proposal.created',
    title: 'Proposition : Donner 3 tâches de Maël à Sacha',
    body: 'Maël est en école jeudi et vendredi',
    link: '/proposals',
    payload: { proposal_id: 'ap-1', project_id: 'p-ibe', status: 'pending' },
  }),
  'proposal.auto_applied': sampleAppNotification({
    id: 'n-5',
    kind: 'proposal.created',
    title: 'Appliqué automatiquement : Échéance de la maquette repoussée au 2 déc.',
    body: null,
    link: '/proposals',
    payload: { proposal_id: 'ap-2', project_id: 'p-ibe', status: 'auto_applied' },
  }),
  'deliverable.comment': sampleAppNotification({
    id: 'n-6',
    kind: 'deliverable.comment',
    title: 'Ibé a commenté la maquette d’accueil',
    body: '« Le bouton est trop petit sur mobile »',
    link: '/projects/p-ibe/deliverables',
  }),
  'commission.created': sampleAppNotification({
    id: 'n-7',
    kind: 'commission.created',
    title: 'Commission : 504 € pour Boulangerie Lemoine',
    body: 'Facture F-2026-0007 payée',
    link: '/commissions',
  }),
  'recap.weekly': sampleAppNotification({
    id: 'n-8',
    kind: 'recap.weekly',
    title: 'Récap de la semaine',
    body: '12 tâches faites, 3 en retard',
    link: '/recap',
  }),
}
