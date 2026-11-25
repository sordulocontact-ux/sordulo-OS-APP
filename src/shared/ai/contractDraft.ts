/** Action IA « contractDraft » : devis accepté → contrat de prestation brouillon (POST /api/ai/run, action contractDraft). */
import { z } from 'zod'
import { formatDate, formatMoney, formatQuantity, lineHtCents } from '../billing.js'
import { LABELS, type DocumentLine, type InvoiceBuyer, type InvoiceSeller, type Quote } from '../types.js'
import { sellerDisplayName } from '../vat.js'

export interface ContractDraftRequest {
  quoteId: string
}

export interface ContractDraftResponse {
  contractId: string
}

/**
 * Ce que Claude rédige : les clauses de texte. Le prix, les prestations, les parties et les rounds de retours
 * ne passent jamais par lui : le code les reprend du devis et du projet.
 */
export const ContractDraftOutputSchema = z.object({
  /** Objet du contrat : une à trois phrases. */
  object: z.string(),
  /** Livrables attendus, tels que le devis ou le projet les nomment. */
  deliverables: z.array(z.string()),
  /** Délais : seulement ceux des données ; sinon une mention « à compléter ». */
  timeline: z.string(),
  intellectual_property: z.string(),
  confidentiality: z.string(),
  termination: z.string(),
})
export type ContractDraftOutput = z.infer<typeof ContractDraftOutputSchema>

/** Texte qui ressemble à un montant (un chiffre suivi de € ou euro) : interdit dans les clauses rédigées par Claude. */
export function mentionsMoney(text: string): boolean {
  return /\d[\d\s.,]*\s*(€|euros?\b|eur\b)/iu.test(text) || /(€|\beuros?\b)\s*\d/iu.test(text)
}

/** Champs de texte de la sortie de Claude qui contiennent un montant. */
export function fieldsWithMoney(output: ContractDraftOutput): string[] {
  const entries: [string, string][] = [
    ['objet', output.object],
    ['livrables', output.deliverables.join('\n')],
    ['délais', output.timeline],
    ['propriété intellectuelle', output.intellectual_property],
    ['confidentialité', output.confidentiality],
    ['résiliation', output.termination],
  ]
  return entries.filter(([, text]) => mentionsMoney(text)).map(([name]) => name)
}

export interface ContractBodyInput {
  seller: InvoiceSeller
  buyer: InvoiceBuyer
  quote: Pick<Quote, 'number' | 'title' | 'lines' | 'notes' | 'valid_until' | 'total_ht_cents' | 'total_vat_cents' | 'total_ttc_cents'>
  projectName: string | null
  /** projects.feedback_rounds_included ; null : pas de projet. */
  feedbackRounds: number | null
  /** Délai de paiement en jours (organisation). */
  paymentTermsDays: number
  output: ContractDraftOutput
}

const clean = (text: string): string => text.replace(/\r/g, '').trim()
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

function partyLines(p: { name: string; siret: string | null; street: string | null; postal: string | null; city: string | null }): string {
  const address = [p.street, [p.postal, p.city].filter(Boolean).join(' ')].filter((x): x is string => Boolean(x && x.trim())).join(', ')
  return [p.name, p.siret ? `SIRET ${p.siret}` : null, address === '' ? null : address].filter(Boolean).join(', ')
}

function lineText(line: DocumentLine): string {
  const head = `**${oneLine(line.label)}**${line.description ? ` : ${oneLine(line.description)}` : ''}`
  return `- ${head} (${formatQuantity(line.quantity)} ${LABELS.lineUnit[line.unit].toLowerCase()} à ${formatMoney(line.unit_price_cents)} HT, soit ${formatMoney(lineHtCents(line))} HT)`
}

/** « Plan » du contrat : parties, objet, prestations, livrables, délais, prix, retours, PI, confidentialité, résiliation. */
export function buildContractBody(input: ContractBodyInput): string {
  const { seller, buyer, quote, output } = input
  const sellerName = sellerDisplayName(seller)
  const todo = '[À compléter]'
  const deliverables = output.deliverables.map(oneLine).filter((d) => d !== '')
  const rounds = input.feedbackRounds
  const parts: string[] = [
    `# Contrat de prestation : ${oneLine(quote.title)}`,
    '## Entre les parties',
    `Le prestataire : ${partyLines({ name: sellerName, siret: seller.siret, street: seller.address_street, postal: seller.address_postal_code, city: seller.address_city })}.`,
    `Le client : ${partyLines({ name: buyer.name, siret: buyer.siret, street: buyer.billing_street, postal: buyer.billing_postal_code, city: buyer.billing_city })}${buyer.contact_name ? `, représenté par ${buyer.contact_name}` : ''}.`,
    '## Article 1. Objet',
    clean(output.object) || todo,
    `Le présent contrat fait suite au devis ${quote.number}${quote.title ? ` « ${oneLine(quote.title)} »` : ''}, accepté par le client${input.projectName ? ` pour le projet « ${oneLine(input.projectName)} »` : ''}.`,
    '## Article 2. Prestations',
    ...(quote.lines.length > 0 ? [quote.lines.map(lineText).join('\n')] : [todo]),
    '## Article 3. Livrables',
    deliverables.length > 0 ? deliverables.map((d) => `- ${d}`).join('\n') : todo,
    '## Article 4. Délais',
    clean(output.timeline) || todo,
    '## Article 5. Prix et modalités de paiement',
    [
      `Total HT : ${formatMoney(quote.total_ht_cents)}`,
      `TVA : ${formatMoney(quote.total_vat_cents)}`,
      `Total TTC : ${formatMoney(quote.total_ttc_cents)}`,
    ]
      .map((l) => `- ${l}`)
      .join('\n'),
    `Ces montants sont ceux du devis ${quote.number}. Les factures sont payables à ${input.paymentTermsDays} jours à compter de leur date d’émission.`,
    ...(quote.notes && quote.notes.trim() !== '' ? [clean(quote.notes)] : []),
    ...(quote.valid_until ? [`Le devis était valable jusqu’au ${formatDate(quote.valid_until)}.`] : []),
    '## Article 6. Retours du client',
    rounds === null
      ? todo
      : rounds === 0
        ? 'Le prix ne comprend aucun round de retours. Chaque demande de modification fait l’objet d’un avenant.'
        : `Le prix comprend ${rounds} round${rounds > 1 ? 's' : ''} de retours. Les demandes supplémentaires font l’objet d’un avenant.`,
    '## Article 7. Propriété intellectuelle',
    clean(output.intellectual_property) || todo,
    '## Article 8. Confidentialité',
    clean(output.confidentiality) || todo,
    '## Article 9. Résiliation',
    clean(output.termination) || todo,
    '## Signatures',
    'Fait en deux exemplaires.',
  ]
  return parts.join('\n\n')
}
