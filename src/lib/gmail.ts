/**
 * Gmail : appels REST (https://gmail.googleapis.com/gmail/v1/users/me/…, CORS ouvert : appelés depuis la fenêtre
 * de l'île avec un jeton d'accès demandé à Rust) et normalisation des messages. Lecture seule.
 *
 * - `buildSenderQueries` : requêtes `from:(a OR b …) after:<epoch s> -in:sent …`, adresses en groupes pour des
 *   requêtes courtes.
 * - `listMessageIds`, `getMessageMetadata` (en-têtes seulement : expéditeur, objet, date, Message-ID),
 *   `readMailContent` (format complet, seulement au clic sur « Analyser » : corps nettoyé, pièces jointes),
 *   `getAttachmentBytes`.
 * - Fonctions pures testées (gmail.test.ts) : adresses, Message-ID, base64url, jeux de caractères, mots encodés
 *   des en-têtes, choix du corps, pièces jointes.
 *
 * Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur, et ne passe jamais dans une URL.
 * Le contenu des mails n'est jamais journalisé.
 */
import { EXTERNAL_REF_MAX_LENGTH } from '../shared/api-contract'
import { cleanMailBody } from './mailText'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Longueur maximale de la liste d'adresses d'une requête (le reste part dans une autre requête). */
export const QUERY_EMAILS_MAX_LENGTH = 1200
/** Adresses par requête, au plus. */
export const QUERY_EMAILS_MAX_COUNT = 25
/** Messages par page de `messages.list`. */
export const LIST_PAGE_SIZE = 50
/** Pages lues par requête, au plus (au-delà, le tour suivant reprend). */
export const LIST_MAX_PAGES = 4

/** Erreur de l'API Gmail. `status` 0 : réseau. `unauthorized` : jeton d'accès refusé (401). */
export class GmailApiError extends Error {
  readonly status: number
  readonly unauthorized: boolean
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GmailApiError'
    this.status = status
    this.unauthorized = status === 401
  }
}

export interface MailAddress {
  name: string | null
  /** En minuscules. */
  email: string
}

/** En-têtes d'un message, normalisés. */
export interface GmailMessageMeta {
  /** id Gmail (propre à la boîte). */
  id: string
  threadId: string | null
  from: MailAddress | null
  /** Vide : pas d'objet. */
  subject: string
  /** En-tête Message-ID (RFC 822) sans chevrons, identique dans toutes les boîtes ; sinon `gmail:<id>`. */
  messageId: string
  /** Réception (internalDate), sinon en-tête Date ; epoch ms. */
  date: number
  labelIds: string[]
}

export interface GmailHeader {
  name: string
  value: string
}

/** Partie MIME d'un message au format complet. */
export interface GmailPart {
  partId: string
  mimeType: string
  filename: string
  headers: GmailHeader[]
  body: { size: number; data: string | null; attachmentId: string | null }
  parts: GmailPart[]
}

export interface MailAttachment {
  filename: string
  mimeType: string
  size: number
  attachmentId: string | null
  /** Contenu en base64url quand Gmail le donne dans le message (petites pièces). */
  data: string | null
}

/** Contenu d'un mail pour l'analyse. */
export interface MailContent {
  meta: GmailMessageMeta
  /** Corps nettoyé (citations et signature retirées). */
  body: string
  attachments: MailAttachment[]
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function chunkedByLength(emails: readonly string[], maxLength: number, maxCount: number): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let length = 0
  for (const email of emails) {
    const added = email.length + (current.length > 0 ? 4 : 0) // « OR »
    if (current.length > 0 && (length + added > maxLength || current.length >= maxCount)) {
      groups.push(current)
      current = []
      length = 0
    }
    current.push(email)
    length += current.length > 1 ? added : email.length
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Requêtes `messages.list` des mails reçus de ces adresses après `afterMs` : jamais les envoyés, brouillons,
 * spams, corbeille ni mes propres mails. Adresses dédoublonnées, découpées en groupes.
 */
export function buildSenderQueries(
  emails: readonly string[],
  afterMs: number,
  options: { maxLength?: number; maxCount?: number } = {},
): string[] {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@()"]+@[^\s@()"]+$/.test(e)))]
  if (unique.length === 0) return []
  const after = Math.max(0, Math.floor(afterMs / 1000))
  return chunkedByLength(unique, options.maxLength ?? QUERY_EMAILS_MAX_LENGTH, options.maxCount ?? QUERY_EMAILS_MAX_COUNT).map(
    (group) => `from:(${group.join(' OR ')}) after:${after} -in:sent -in:drafts -in:spam -in:trash -from:me`,
  )
}

/** base64url (ou base64) → octets. Chaîne invalide : octets vides. */
export function decodeBase64Url(data: string): Uint8Array<ArrayBuffer> {
  const clean = data.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return new Uint8Array(0)
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Octets → texte dans ce jeu de caractères (UTF-8 si inconnu). */
export function decodeBytes(bytes: Uint8Array, charset: string | null = null): string {
  const label = (charset ?? 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '')
  try {
    return new TextDecoder(label === 'utf8' ? 'utf-8' : label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Jeu de caractères d'un en-tête Content-Type (`text/plain; charset="ISO-8859-1"` → `iso-8859-1`). */
export function charsetOf(contentType: string | null | undefined): string | null {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '')
  return match?.[1] ? match[1].toLowerCase() : null
}

function decodeQ(text: string): Uint8Array {
  const bytes: number[] = []
  const source = text.replace(/_/g, ' ')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const hex = source.slice(i + 1, i + 3)
    if (char === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      bytes.push(source.charCodeAt(i) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/** Mots encodés des en-têtes (RFC 2047 : `=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`). Le reste est gardé tel quel. */
export function decodeEncodedWords(value: string): string {
  // Deux mots encodés séparés par des espaces se collent (RFC 2047, 6.2).
  const joined = value.replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?[^?]*\?=)/gi, '$1')
  return joined.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_whole, charset: string, encoding: string, text: string) => {
    const bytes = encoding.toLowerCase() === 'b' ? decodeBase64Url(text) : decodeQ(text)
    return decodeBytes(bytes, charset.replace(/\*.*$/, ''))
  })
}

/** `"Jeanne Dupont" <Jeanne@Ibe.fr>`, `Jeanne <j@ibe.fr>`, `<j@ibe.fr>`, `j@ibe.fr (Jeanne)`, `j@ibe.fr`. */
export function parseAddress(raw: string | null | undefined): MailAddress | null {
  const value = decodeEncodedWords(str(raw)).trim()
  if (!value) return null
  const angle = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(value)
  let name: string | null = null
  let email: string | null = null
  if (angle) {
    email = angle[2] ?? null
    name = angle[1] ?? null
  } else {
    const paren = /^([^\s()<>]+@[^\s()<>]+)\s*\((.*)\)\s*$/.exec(value)
    if (paren) {
      email = paren[1] ?? null
      name = paren[2] ?? null
    } else if (/^[^\s<>]+@[^\s<>]+$/.test(value)) {
      email = value
    }
  }
  if (!email) return null
  const cleanName = (name ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\(.)/g, '$1')
    .trim()
  const lower = email.toLowerCase()
  return { name: cleanName && cleanName.toLowerCase() !== lower ? cleanName : null, email: lower }
}

/** En-tête Message-ID sans chevrons ; repli `gmail:<id>` s'il manque ou s'il est trop long. */
export function normalizeMessageId(raw: string | null | undefined, gmailId: string): string {
  const value = str(raw).trim()
  const inner = /<([^<>\s]+)>/.exec(value)?.[1] ?? value.replace(/[<>\s]/g, '')
  if (!inner || inner.length > EXTERNAL_REF_MAX_LENGTH) return `gmail:${gmailId}`
  return inner
}

/** Valeur d'un en-tête (sans casse) ; null s'il manque. */
export function headerValue(headers: readonly GmailHeader[], name: string): string | null {
  const wanted = name.toLowerCase()
  return headers.find((h) => h.name.toLowerCase() === wanted)?.value ?? null
}

function normalizeHeaders(raw: unknown): GmailHeader[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((h): GmailHeader[] => (isObject(h) && typeof h.name === 'string' ? [{ name: h.name, value: str(h.value) }] : []))
}

/** Réponse de `messages.get` (format metadata ou full) → en-têtes normalisés ; null si inutilisable. */
export function normalizeMessageMeta(raw: unknown): GmailMessageMeta | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const payload = isObject(raw.payload) ? raw.payload : {}
  const headers = normalizeHeaders(payload.headers)
  const internal = Number(raw.internalDate)
  const headerDate = Date.parse(headerValue(headers, 'Date') ?? '')
  const date = Number.isFinite(internal) && internal > 0 ? internal : Number.isFinite(headerDate) ? headerDate : 0
  if (!date) return null
  return {
    id: raw.id,
    threadId: typeof raw.threadId === 'string' ? raw.threadId : null,
    from: parseAddress(headerValue(headers, 'From')),
    subject: decodeEncodedWords(headerValue(headers, 'Subject') ?? '').trim(),
    messageId: normalizeMessageId(headerValue(headers, 'Message-ID'), raw.id),
    date,
    labelIds: Array.isArray(raw.labelIds) ? raw.labelIds.filter((l): l is string => typeof l === 'string') : [],
  }
}

/** Partie MIME brute → normalisée (récursif). */
export function normalizePart(raw: unknown): GmailPart {
  const part = isObject(raw) ? raw : {}
  const body = isObject(part.body) ? part.body : {}
  const size = Number(body.size)
  return {
    partId: str(part.partId),
    mimeType: str(part.mimeType).toLowerCase(),
    filename: str(part.filename),
    headers: normalizeHeaders(part.headers),
    body: {
      size: Number.isFinite(size) && size > 0 ? size : 0,
      data: typeof body.data === 'string' && body.data ? body.data : null,
      attachmentId: typeof body.attachmentId === 'string' && body.attachmentId ? body.attachmentId : null,
    },
    parts: Array.isArray(part.parts) ? part.parts.map(normalizePart) : [],
  }
}

function isAttachmentPart(part: GmailPart): boolean {
  if (part.filename.trim()) return true
  return /^\s*attachment\b/i.test(headerValue(part.headers, 'Content-Disposition') ?? '')
}

/** Toutes les parties, dans l'ordre (profondeur d'abord). */
function flatten(part: GmailPart): GmailPart[] {
  return [part, ...part.parts.flatMap(flatten)]
}

/** Partie du corps : le premier text/plain qui n'est pas une pièce jointe, sinon le premier text/html. */
export function findBodyPart(payload: GmailPart): GmailPart | null {
  const parts = flatten(payload).filter((part) => !isAttachmentPart(part))
  return parts.find((part) => part.mimeType === 'text/plain') ?? parts.find((part) => part.mimeType === 'text/html') ?? null
}

/** Pièces jointes (parties avec un nom de fichier et un contenu). */
export function listAttachments(payload: GmailPart): MailAttachment[] {
  return flatten(payload)
    .filter((part) => part.filename.trim() !== '' && (part.body.attachmentId !== null || part.body.data !== null))
    .map((part) => ({
      filename: part.filename.trim(),
      mimeType: part.mimeType,
      size: part.body.size,
      attachmentId: part.body.attachmentId,
      data: part.body.data,
    }))
}

/** Texte d'une partie d'après son contenu base64url et son jeu de caractères. */
export function partText(part: GmailPart, data: string): string {
  return decodeBytes(decodeBase64Url(data), charsetOf(headerValue(part.headers, 'Content-Type')))
}

// ---------------------------------------------------------------------------
// Appels REST
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

async function gmailGet(accessToken: string, path: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(`${API}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })
  } catch {
    throw new GmailApiError(0, 'Gmail injoignable.')
  }
  if (!response.ok) {
    throw new GmailApiError(
      response.status,
      response.status === 401 ? "Gmail refuse le jeton d'accès." : `Erreur Gmail ${response.status}.`,
    )
  }
  try {
    return (await response.json()) as unknown
  } catch {
    throw new GmailApiError(response.status, 'Réponse de Gmail illisible.')
  }
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init)

/** ids des messages de la requête (plusieurs pages, au plus LIST_MAX_PAGES). */
export async function listMessageIds(accessToken: string, query: string, fetchImpl: FetchLike = defaultFetch): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | null = null
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const params = new URLSearchParams({ q: query, maxResults: String(LIST_PAGE_SIZE) })
    if (pageToken) params.set('pageToken', pageToken)
    const raw = await gmailGet(accessToken, `/messages?${params.toString()}`, fetchImpl)
    const json = isObject(raw) ? raw : {}
    if (Array.isArray(json.messages)) {
      for (const m of json.messages) if (isObject(m) && typeof m.id === 'string') ids.push(m.id)
    }
    pageToken = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null
    if (!pageToken) break
  }
  return [...new Set(ids)]
}

const METADATA_HEADERS = ['From', 'Subject', 'Date', 'Message-ID']

/** En-têtes d'un message (format metadata : jamais le corps). Null si la réponse est inutilisable. */
export async function getMessageMetadata(
  accessToken: string,
  id: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<GmailMessageMeta | null> {
  const params = new URLSearchParams({ format: 'metadata' })
  for (const header of METADATA_HEADERS) params.append('metadataHeaders', header)
  const raw = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}?${params.toString()}`, fetchImpl)
  return normalizeMessageMeta(raw)
}

/** Contenu (base64url) d'une pièce jointe ou d'une grande partie. */
export async function getAttachmentData(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<string> {
  const raw = await gmailGet(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    fetchImpl,
  )
  return isObject(raw) && typeof raw.data === 'string' ? raw.data : ''
}

/** Octets d'une pièce jointe (dans le message, sinon par attachments.get). */
export async function getAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachment: MailAttachment,
  fetchImpl: FetchLike = defaultFetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const data =
    attachment.data ??
    (attachment.attachmentId ? await getAttachmentData(accessToken, messageId, attachment.attachmentId, fetchImpl) : '')
  return decodeBase64Url(data)
}

/**
 * Mail complet (format full), seulement après « Analyser » : en-têtes, corps nettoyé, pièces jointes listées
 * (leur contenu est lu ensuite, une à une).
 */
export async function readMailContent(accessToken: string, id: string, fetchImpl: FetchLike = defaultFetch): Promise<MailContent> {
  const raw = await gmailGet(accessToken, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl)
  const meta = normalizeMessageMeta(raw)
  if (!meta) throw new GmailApiError(200, 'Mail illisible.')
  const payload = normalizePart(isObject(raw) ? raw.payload : null)
  const part = findBodyPart(payload)
  let text: string | null = null
  let html: string | null = null
  if (part) {
    const data = part.body.data ?? (part.body.attachmentId ? await getAttachmentData(accessToken, id, part.body.attachmentId, fetchImpl) : '')
    const decoded = data ? partText(part, data) : ''
    if (part.mimeType === 'text/html') html = decoded
    else text = decoded
  }
  return {
    meta,
    body: cleanMailBody({ text, html, subject: meta.subject }),
    attachments: listAttachments(payload),
  }
}
