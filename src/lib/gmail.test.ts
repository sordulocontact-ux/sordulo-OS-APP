import { describe, expect, it, vi } from 'vitest'
import {
  GmailApiError,
  LIST_MAX_PAGES,
  buildSenderQueries,
  charsetOf,
  decodeBase64Url,
  decodeBytes,
  decodeEncodedWords,
  findBodyPart,
  getAttachmentBytes,
  getMessageMetadata,
  listAttachments,
  listMessageIds,
  normalizeMessageId,
  normalizeMessageMeta,
  normalizePart,
  parseAddress,
  readMailContent,
  type FetchLike,
} from './gmail'

function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const utf8 = (text: string) => b64url(new TextEncoder().encode(text))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const RAW_META = {
  id: 'g-1',
  threadId: 't-1',
  labelIds: ['INBOX', 'UNREAD'],
  internalDate: '1795000000000',
  payload: {
    headers: [
      { name: 'From', value: '"Jeanne Dupont" <Jeanne@Ibe.fr>' },
      { name: 'Subject', value: '=?UTF-8?Q?Retours_sur_l=E2=80=99app?=' },
      { name: 'Date', value: 'Tue, 24 Nov 2026 18:02:00 +0100' },
      { name: 'Message-Id', value: '<CAF=abc123@mail.gmail.com>' },
    ],
  },
}

describe('requêtes', () => {
  it('adresses dédoublonnées, en minuscules, date en secondes, filtres', () => {
    expect(buildSenderQueries(['Jeanne@Ibe.fr', 'jeanne@ibe.fr', 'paul@ibe.fr', 'pas une adresse'], 1_795_000_000_999)).toEqual([
      'from:(jeanne@ibe.fr OR paul@ibe.fr) after:1795000000 -in:sent -in:drafts -in:spam -in:trash -from:me',
    ])
    expect(buildSenderQueries([], 0)).toEqual([])
  })

  it('découpe en groupes (nombre et longueur)', () => {
    const emails = Array.from({ length: 7 }, (_, i) => `contact${i}@client.fr`)
    const byCount = buildSenderQueries(emails, 0, { maxCount: 3 })
    expect(byCount).toHaveLength(3)
    expect(byCount[2]).toContain('from:(contact6@client.fr)')
    const byLength = buildSenderQueries(emails, 0, { maxLength: 40 })
    expect(byLength).toHaveLength(4)
    for (const query of byLength) expect(query.match(/@/g)?.length).toBeLessThanOrEqual(2)
  })
})

describe('décodage', () => {
  it('base64url, avec ou sans remplissage ; invalide : vide', () => {
    expect(decodeBytes(decodeBase64Url(utf8('Été à Ibé ?')))).toBe('Été à Ibé ?')
    expect(decodeBytes(decodeBase64Url('SGk-'))).toBe('Hi>')
    expect(decodeBase64Url('***')).toHaveLength(0)
  })

  it('jeux de caractères : Latin-1, Windows-1252, inconnu → UTF-8', () => {
    expect(charsetOf('text/plain; charset="ISO-8859-1"')).toBe('iso-8859-1')
    expect(charsetOf('text/plain')).toBeNull()
    expect(decodeBytes(new Uint8Array([0x45, 0x74, 0xe9]), 'iso-8859-1')).toBe('Eté')
    expect(decodeBytes(new Uint8Array([0x80]), 'windows-1252')).toBe('€')
    expect(decodeBytes(new TextEncoder().encode('é'), 'x-inconnu')).toBe('é')
  })

  it('mots encodés des en-têtes (B et Q, collés)', () => {
    expect(decodeEncodedWords('=?UTF-8?B?w4l0w6k=?= =?UTF-8?Q?_=C3=A0_Ib=C3=A9?=')).toBe('Été à Ibé')
    expect(decodeEncodedWords('=?iso-8859-1?q?R=E9union?= demain')).toBe('Réunion demain')
    expect(decodeEncodedWords('Sans encodage')).toBe('Sans encodage')
  })
})

describe('adresses et identifiants', () => {
  it('formes courantes d’expéditeur', () => {
    expect(parseAddress('"Jeanne Dupont" <Jeanne@Ibe.fr>')).toEqual({ name: 'Jeanne Dupont', email: 'jeanne@ibe.fr' })
    expect(parseAddress('Jeanne <j@ibe.fr>')).toEqual({ name: 'Jeanne', email: 'j@ibe.fr' })
    expect(parseAddress('<j@ibe.fr>')).toEqual({ name: null, email: 'j@ibe.fr' })
    expect(parseAddress('j@ibe.fr (Jeanne)')).toEqual({ name: 'Jeanne', email: 'j@ibe.fr' })
    expect(parseAddress('J@ibe.fr')).toEqual({ name: null, email: 'j@ibe.fr' })
    expect(parseAddress('=?UTF-8?Q?Ib=C3=A9?= <contact@ibe.fr>')).toEqual({ name: 'Ibé', email: 'contact@ibe.fr' })
    expect(parseAddress('"j@ibe.fr" <j@ibe.fr>')).toEqual({ name: null, email: 'j@ibe.fr' })
    expect(parseAddress('pas une adresse')).toBeNull()
    expect(parseAddress(null)).toBeNull()
  })

  it('Message-ID sans chevrons, repli gmail:<id>', () => {
    expect(normalizeMessageId('<CAF=abc@mail.gmail.com>', 'g-1')).toBe('CAF=abc@mail.gmail.com')
    expect(normalizeMessageId('  abc@host ', 'g-1')).toBe('abc@host')
    expect(normalizeMessageId('', 'g-1')).toBe('gmail:g-1')
    expect(normalizeMessageId(null, 'g-1')).toBe('gmail:g-1')
    expect(normalizeMessageId(`<${'x'.repeat(600)}@h>`, 'g-1')).toBe('gmail:g-1')
  })

  it('en-têtes du message normalisés (casse des noms ignorée)', () => {
    expect(normalizeMessageMeta(RAW_META)).toEqual({
      id: 'g-1',
      threadId: 't-1',
      from: { name: 'Jeanne Dupont', email: 'jeanne@ibe.fr' },
      subject: 'Retours sur l’app',
      messageId: 'CAF=abc123@mail.gmail.com',
      date: 1795000000000,
      labelIds: ['INBOX', 'UNREAD'],
    })
    // Sans internalDate : l'en-tête Date ; sans date du tout : inutilisable.
    const noInternal = normalizeMessageMeta({ ...RAW_META, internalDate: undefined })
    expect(noInternal?.date).toBe(Date.parse('Tue, 24 Nov 2026 18:02:00 +0100'))
    expect(normalizeMessageMeta({ id: 'g-2', payload: { headers: [] } })).toBeNull()
    expect(normalizeMessageMeta({ payload: {} })).toBeNull()
  })
})

describe('parties MIME', () => {
  const payload = normalizePart({
    mimeType: 'multipart/mixed',
    parts: [
      {
        partId: '0',
        mimeType: 'multipart/alternative',
        parts: [
          { partId: '0.0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { size: 10, data: utf8('Bonjour') } },
          { partId: '0.1', mimeType: 'text/html', body: { size: 20, data: utf8('<p>Bonjour</p>') } },
        ],
      },
      { partId: '1', mimeType: 'application/pdf', filename: 'retours.pdf', body: { size: 2048, attachmentId: 'att-1' } },
      { partId: '2', mimeType: 'text/plain', filename: 'notes.txt', body: { size: 5, data: utf8('notes') } },
      { partId: '3', mimeType: 'image/png', filename: 'vide.png', body: { size: 0 } },
    ],
  })

  it('corps : le text/plain qui n’est pas une pièce jointe, sinon le HTML', () => {
    expect(findBodyPart(payload)?.partId).toBe('0.0')
    const htmlOnly = normalizePart({ mimeType: 'text/html', body: { data: utf8('<p>Hi</p>') } })
    expect(findBodyPart(htmlOnly)?.mimeType).toBe('text/html')
    const attachmentOnly = normalizePart({
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { data: utf8('x') } }],
    })
    expect(findBodyPart(attachmentOnly)).toBeNull()
  })

  it('pièces jointes : nom de fichier et contenu', () => {
    expect(listAttachments(payload)).toEqual([
      { filename: 'retours.pdf', mimeType: 'application/pdf', size: 2048, attachmentId: 'att-1', data: null },
      { filename: 'notes.txt', mimeType: 'text/plain', size: 5, attachmentId: null, data: utf8('notes') },
    ])
  })
})

describe('appels REST', () => {
  it('liste : jeton dans l’en-tête (jamais dans l’URL), pages suivies jusqu’à la limite', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'next' }))
    const ids = await listMessageIds('tok-secret', 'from:(a@b.fr)', fetchImpl)
    expect(ids).toEqual(['a', 'b'])
    expect(fetchImpl).toHaveBeenCalledTimes(LIST_MAX_PAGES)
    const [url, init] = fetchImpl.mock.calls[1] ?? []
    expect(url).toContain('/messages?q=from%3A%28a%40b.fr%29&maxResults=50&pageToken=next')
    expect(url).not.toContain('tok-secret')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-secret')
  })

  it('en-têtes seulement (format metadata)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json(RAW_META))
    const meta = await getMessageMetadata('tok', 'g-1', fetchImpl)
    expect(meta?.messageId).toBe('CAF=abc123@mail.gmail.com')
    const url = fetchImpl.mock.calls[0]?.[0] ?? ''
    expect(url).toContain('/messages/g-1?format=metadata&metadataHeaders=From&metadataHeaders=Subject')
    expect(url).toContain('metadataHeaders=Message-ID')
  })

  it('erreurs : 401 = jeton refusé, réseau = statut 0, sans le jeton dans le message', async () => {
    const unauthorized = listMessageIds('tok-secret', 'q', async () => json({ error: {} }, 401))
    await expect(unauthorized).rejects.toMatchObject({ status: 401, unauthorized: true })
    const offline = listMessageIds('tok-secret', 'q', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(offline).rejects.toBeInstanceOf(GmailApiError)
    await expect(offline).rejects.toMatchObject({ status: 0, unauthorized: false })
    const error = await listMessageIds('tok-secret', 'q', async () => json({}, 500)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GmailApiError)
    expect((error as Error).message).not.toContain('tok-secret')
  })

  it('mail complet : corps Latin-1 nettoyé, grande partie lue par attachments.get, pièces jointes listées', async () => {
    const text = "Le logo de l'été est trop petit.\n\nCordialement,\nJeanne\n"
    const latin1 = b64url(new Uint8Array([...text].map((c) => c.charCodeAt(0))))
    const full = {
      ...RAW_META,
      payload: {
        ...RAW_META.payload,
        mimeType: 'multipart/mixed',
        parts: [
          { partId: '0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }], body: { size: 900_000, attachmentId: 'big-body' } },
          { partId: '1', mimeType: 'application/pdf', filename: 'retours.pdf', body: { size: 10, attachmentId: 'att-1' } },
        ],
      },
    }
    const fetchImpl = vi.fn<FetchLike>(async (url) => (url.includes('/attachments/big-body') ? json({ data: latin1 }) : json(full)))
    const content = await readMailContent('tok', 'g-1', fetchImpl)
    expect(content.body).toBe("Le logo de l'été est trop petit.")
    expect(content.meta.subject).toBe('Retours sur l’app')
    expect(content.attachments).toEqual([{ filename: 'retours.pdf', mimeType: 'application/pdf', size: 10, attachmentId: 'att-1', data: null }])
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/messages/g-1?format=full')

    const bytes = await getAttachmentBytes('tok', 'g-1', content.attachments[0]!, async () => json({ data: utf8('%PDF') }))
    expect(new TextDecoder().decode(bytes)).toBe('%PDF')
    const inline = await getAttachmentBytes('tok', 'g-1', { filename: 'a.pdf', mimeType: 'application/pdf', size: 4, attachmentId: null, data: utf8('%PDF') })
    expect(inline).toHaveLength(4)
  })
})
