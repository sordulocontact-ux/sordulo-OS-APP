/**
 * Action IA « classify » (POST /api/ai/run, action classify) : rangement d'un fichier déposé.
 *   mode 'classify' : type, client, projet, dossier, numéro, doublon, version → file_intakes.proposal ;
 *                     range seul si une règle « Toujours » s'applique (intake filed + auto_filed).
 *   mode 'import'   : crée le devis / la facture importé(e) d'après le fichier (numéro d'origine gardé).
 * Client : src/lib/filing.ts (startIntake, classifyIntake, importFromIntake), jamais runAi directement.
 */
import { z } from 'zod'
import { FILE_KINDS, type FileIntake } from '../types.js'

export const CLASSIFY_MODES = ['classify', 'import'] as const
export type ClassifyMode = (typeof CLASSIFY_MODES)[number]

export interface ClassifyRequest {
  intakeId: string
  mode: ClassifyMode
}

/** Mode classify : le dépôt à jour (ready avec sa proposition, filed si rangé par une règle, error sinon). */
export interface ClassifyResponse {
  intake: FileIntake
}

/** Mode import : le document créé (un seul des deux est rempli). */
export interface ImportFromIntakeResponse {
  quoteId: string | null
  invoiceId: string | null
  /** Écart de plus de 1 € entre le total calculé et le total lu sur le document (non bloquant). */
  warning?: string
}

/**
 * Sortie structurée de Claude (contraintes compatibles avec l'API : types, enums, nullable).
 * Ids, bornes et rapprochements sont vérifiés ensuite en code (api/_lib/files/proposal.ts).
 */
export const ClassificationSchema = z.object({
  kind: z.enum(FILE_KINDS),
  client_id: z.string().nullable(),
  project_id: z.string().nullable(),
  /** Le document désigne lui-même ce projet (nom, objet, numéro) : faux s'il est choisi seulement parce que c'est un projet du client. */
  project_evidence: z.boolean(),
  folder: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  document_number: z.string().nullable(),
  document_date: z.string().nullable(),
  amount_ttc_cents: z.number().nullable(),
  confidence: z.number(),
  reasons: z.array(z.string()),
  /** Id d'un des fichiers proches fournis dont ce dépôt est la nouvelle version, sinon null. */
  previous_version_file_id: z.string().nullable(),
  /** Ce qui change par rapport à cette version précédente, sinon null. */
  change_summary: z.string().nullable(),
})

export type Classification = z.infer<typeof ClassificationSchema>
