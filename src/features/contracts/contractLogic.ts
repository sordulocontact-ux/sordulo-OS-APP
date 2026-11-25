import type { BadgeTone } from '../../components/ui'
import type { Contract, ContractStatus } from '../../shared/types'

/** Contrat de la liste ou de la fiche, avec le client et le projet liés. */
export type ContractWithLinks = Contract & {
  client: { id: string; name: string } | null
  project: { id: string; name: string } | null
}

export const CONTRACT_TONE: Record<ContractStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  signed: 'success',
  cancelled: 'danger',
}

export function parseContractStatus(value: string | null): ContractStatus | '' {
  return (['draft', 'sent', 'signed', 'cancelled'] as const).find((s) => s === value) ?? ''
}

/** Signé = figé : la base refuse toute modification sauf l'annulation et le fichier. */
export function isContractLocked(status: ContractStatus): boolean {
  return status === 'signed' || status === 'cancelled'
}

export type ContractTransition = 'send' | 'sign' | 'cancel' | 'reopen'

/** Transitions permises : envoyer un brouillon, signer un brouillon ou un envoyé, annuler sauf déjà annulé. */
export function canTransition(status: ContractStatus, action: ContractTransition): boolean {
  switch (action) {
    case 'send':
      return status === 'draft'
    case 'sign':
      return status === 'draft' || status === 'sent'
    case 'cancel':
      return status !== 'cancelled'
    case 'reopen':
      return status === 'sent'
  }
}

export const canDeleteContract = (status: ContractStatus): boolean => status === 'draft'

export interface SignatureInput {
  name: string
  /** AAAA-MM-JJ. */
  date: string
}

export interface SignatureErrors {
  name?: string
  date?: string
}

/** Nom obligatoire (200 car. au plus) ; date valide et pas dans le futur. */
export function validateSignature(input: SignatureInput, today: string): SignatureErrors {
  const errors: SignatureErrors = {}
  const name = input.name.trim()
  if (name === '') errors.name = 'Saisis le nom du signataire.'
  else if (name.length > 200) errors.name = 'Le nom est trop long (200 caractères au plus).'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) errors.date = 'Saisis la date de signature.'
  else if (input.date > today) errors.date = 'La date de signature ne peut pas être dans le futur.'
  return errors
}

/** Date AAAA-MM-JJ → horodatage à midi UTC (évite un décalage de jour). */
export function signedAtFromDate(date: string): string {
  return `${date}T12:00:00.000Z`
}

export function filterContracts(
  contracts: readonly ContractWithLinks[],
  filters: { query: string; status: ContractStatus | '' },
): ContractWithLinks[] {
  const q = normalize(filters.query)
  return contracts.filter((c) => {
    if (filters.status !== '' && c.status !== filters.status) return false
    if (q === '') return true
    return normalize([c.title, c.client?.name ?? '', c.project?.name ?? ''].join(' ')).includes(q)
  })
}

export function sortContracts(contracts: readonly ContractWithLinks[]): ContractWithLinks[] {
  return [...contracts].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Nom de fichier sûr pour le chemin Storage (pas de dossier, pas de caractère exotique). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|-+$/g, '')
  return (cleaned === '' ? 'contrat.pdf' : cleaned).slice(0, 120)
}

/** `<org>/<project_id>/<uuid>-<nom>` : chemin du PDF signé dans le bucket files. */
export function contractStoragePath(organizationId: string, projectId: string, uuid: string, fileName: string): string {
  return `${organizationId}/${projectId}/${uuid}-${safeFileName(fileName)}`
}

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function contractErrorText(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const lower = message.toLowerCase()
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'Ton rôle ne permet pas de modifier les contrats.'
  }
  if (lower.includes('signé')) return 'Un contrat signé ne se modifie plus : annule-le pour en refaire un.'
  if (lower.includes('brouillon')) return 'Seul un brouillon peut être supprimé.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/* ---------- Markdown simple (titres, listes, citations, gras, italique) ---------- */

export type MdInline = { text: string; bold?: boolean; italic?: boolean }
export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { type: 'paragraph'; inline: MdInline[] }
  | { type: 'list'; items: MdInline[][] }

export function parseInline(text: string): MdInline[] {
  const parts: MdInline[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) parts.push({ text: m[1], bold: true })
    else if (m[2] !== undefined) parts.push({ text: m[2], italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** Découpe un Markdown simple en blocs : jamais de HTML brut, le texte est toujours échappé par React. */
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let list: MdInline[][] | null = null
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push({ type: 'list', items: list })
    list = null
  }
  for (const raw of source.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (line === '') {
      flushParagraph()
      flushList()
    } else if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, inline: parseInline(heading[2]!) })
    } else if (item) {
      flushParagraph()
      list ??= []
      list.push(parseInline(item[1]!))
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}
