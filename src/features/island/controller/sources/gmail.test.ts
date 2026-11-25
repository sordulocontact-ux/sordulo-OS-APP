import { describe, expect, it, vi } from 'vitest'
import type { ClientDirectoryEntry } from '../../../../lib/clientDirectory'
import { GmailApiError, type GmailMessageMeta, type MailAttachment, type MailContent } from '../../../../lib/gmail'
import type { GoogleAccountConnection } from '../../../../lib/google'
import type { CreateWrittenInputRequest } from '../../../../shared/api-contract'
import type { GoogleAccess } from '../../../../shared/desktop-contract'
import type { IslandNotification, NotificationAction } from '../../types'
import { flush, setupRuntime } from '../testUtils'
import {
  ATTACHMENT_MAX_BYTES,
  CONNECTION_CHECK_MS,
  MAIL_PROGRESS_ID,
  POLL_MAX_DELAY_MS,
  POLL_MS,
  alreadyAnalyzedNotification,
  analyzableAttachments,
  buildMailInputText,
  createGmailSource,
  isConflict,
  mailTitle,
  pollDelayMs,
  targetEmails,
  type GmailSourceDeps,
} from './gmail'
import { REMINDER_DELAY_MS, pendingStorageKey } from './gmailPending'

const ROW: GoogleAccountConnection = {
  service: 'gmail',
  refreshToken: 'rt-1',
  account: 'Mael@Sordulo.fr',
  cursorAt: '2026-11-25T08:00:00.000Z',
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-20T08:00:00.000Z',
}

const IBE: ClientDirectoryEntry = {
  clientId: 'c-1',
  clientName: 'Ibé',
  emails: ['jeanne@ibe.fr', 'mael@sordulo.fr'],
  projects: [
    { id: 'p-old', name: 'Site Ibé', status: 'in_progress', createdAt: '2026-01-01' },
    { id: 'p-1', name: 'App Ibé', status: 'in_progress', createdAt: '2026-10-01' },
  ],
}
const DORMANT: ClientDirectoryEntry = {
  clientId: 'c-2',
  clientName: 'Ancien client',
  emails: ['old@client.fr'],
  projects: [{ id: 'p-2', name: 'Fini', status: 'paid', createdAt: '2025-01-01' }],
}

const AT_9 = Date.parse('2026-11-25T09:00:00.000Z')

function meta(id: string, fields: Partial<GmailMessageMeta> = {}): GmailMessageMeta {
  return {
    id,
    threadId: null,
    from: { name: 'Jeanne Dupont', email: 'jeanne@ibe.fr' },
    subject: `Retours ${id}`,
    messageId: `${id}@ibe.fr`,
    date: AT_9,
    labelIds: ['INBOX'],
    ...fields,
  }
}

const PDF: MailAttachment = { filename: 'retours.pdf', mimeType: 'application/pdf', size: 2000, attachmentId: 'att-1', data: null }
const BROKEN: MailAttachment = { filename: 'casse.docx', mimeType: '', size: 10, attachmentId: 'att-2', data: null }
const IMAGE: MailAttachment = { filename: 'photo.png', mimeType: 'image/png', size: 10, attachmentId: 'att-3', data: null }

function setup(options: { row?: GoogleAccountConnection | null; messages?: GmailMessageMeta[]; analyzed?: string[]; storage?: Record<string, string> } = {}) {
  let row = options.row === undefined ? ROW : options.row
  let messages = options.messages ?? []
  const analyzed = new Set(options.analyzed ?? [])
  const storage = new Map(Object.entries(options.storage ?? {}))
  const state = { hour: 10 }
  const deps = {
    readGmailConnection: vi.fn(async () => row),
    googleAccessToken: vi.fn(async (_refreshToken: string, _force: boolean): Promise<GoogleAccess> => ({ status: 'ok', accessToken: 'at-1', expiresAt: 0 })),
    markGmailLost: vi.fn(async () => {}),
    saveGmailCursor: vi.fn(async (_at: Date) => {}),
    loadClientDirectory: vi.fn(async () => [IBE, DORMANT]),
    listMessageIds: vi.fn(async (_token: string, _query: string) => messages.map((m) => m.id)),
    getMessageMetadata: vi.fn(async (_token: string, id: string) => messages.find((m) => m.id === id) ?? null),
    readMailContent: vi.fn(
      async (_token: string, id: string): Promise<MailContent> => ({
        meta: messages.find((m) => m.id === id) ?? meta(id),
        body: 'Le logo est trop petit.',
        attachments: [PDF, BROKEN, IMAGE],
      }),
    ),
    getAttachmentBytes: vi.fn(async (_token: string, _gmailId: string, _a: MailAttachment) => new Uint8Array([1, 2, 3])),
    extractDocumentText: vi.fn(async (file: File) => {
      if (file.name === 'casse.docx') throw new Error('illisible')
      return `Texte de ${file.name}`
    }),
    findAnalyzedRefs: vi.fn(async (refs: readonly string[]) => new Set(refs.filter((r) => analyzed.has(r)))),
    createInput: vi.fn(async (_body: CreateWrittenInputRequest) => ({ id: 'in-1' })),
    readStorage: (key: string) => storage.get(key) ?? null,
    writeStorage: (key: string, value: string | null) => {
      if (value === null) storage.delete(key)
      else storage.set(key, value)
    },
    localHour: () => state.hour,
  } satisfies GmailSourceDeps
  const env = setupRuntime({ sources: [createGmailSource(deps)] })
  const notify = vi.spyOn(env.coordinator, 'notify')
  const tracked = vi.fn()
  env.runtime.bus.on('trackInput', tracked)
  const notifications = () => notify.mock.calls.map(([n]: [IslandNotification]) => n)
  return {
    ...env,
    deps,
    state,
    storage,
    tracked,
    notifications,
    kinds: () => notifications().map((n) => n.kind),
    setMessages(next: GmailMessageMeta[]) {
      messages = next
    },
    setRow(next: GoogleAccountConnection | null) {
      row = next
    },
    async advance(ms: number) {
      // Pas d'une minute au plus : chaque tour se replanifie après ses promesses.
      for (let left = ms; left > 0; left -= CONNECTION_CHECK_MS) {
        env.clock.advance(Math.min(CONNECTION_CHECK_MS, left))
        await flush(2)
      }
    },
    click(notification: IslandNotification, action?: NotificationAction) {
      env.runtime.runAction(notification, action)
    },
    pending: () => storage.get(pendingStorageKey('u-1')) ?? null,
  }
}

function last(t: ReturnType<typeof setup>, kind: string): IslandNotification {
  const found = [...t.notifications()].reverse().find((n) => n.kind === kind)
  if (!found) throw new Error(`pas de notification ${kind}`)
  return found
}

describe('gmail : fonctions pures', () => {
  it('recul après des erreurs : 4 min, puis double, 30 min au plus', () => {
    expect(pollDelayMs(0)).toBe(POLL_MS)
    expect(pollDelayMs(1)).toBe(POLL_MS)
    expect(pollDelayMs(2)).toBe(2 * POLL_MS)
    expect(pollDelayMs(20)).toBe(POLL_MAX_DELAY_MS)
  })

  it('adresses surveillées : clients avec un projet en cours (le plus récent), sauf mon adresse', () => {
    const targets = targetEmails([IBE, DORMANT], 'MAEL@sordulo.fr')
    expect([...targets.keys()]).toEqual(['jeanne@ibe.fr'])
    expect(targets.get('jeanne@ibe.fr')?.projectId).toBe('p-1')
  })

  it('pièces jointes : PDF et Word de taille raisonnable', () => {
    const big = { ...PDF, filename: 'gros.pdf', size: ATTACHMENT_MAX_BYTES + 1 }
    const txt = { ...PDF, filename: 'notes.txt', mimeType: 'text/plain' }
    expect(analyzableAttachments([PDF, BROKEN, IMAGE, big, txt]).map((a) => a.filename)).toEqual(['retours.pdf', 'casse.docx'])
  })

  it('texte de l’entrée : expéditeur, date, objet, corps, pièces jointes ; coupé à la limite', () => {
    const text = buildMailInputText(
      {
        fromName: 'Jeanne Dupont',
        fromEmail: 'jeanne@ibe.fr',
        fallbackName: 'Ibé',
        date: AT_9,
        subject: 'Retours v2',
        body: 'Le logo est trop petit.',
        attachments: [{ filename: 'retours.pdf', text: 'Texte du PDF' }],
      },
      { timeZone: 'Europe/Paris' },
    )
    expect(text).toBe(
      [
        'Mail de Jeanne Dupont <jeanne@ibe.fr>, le mercredi 25 novembre 2026 à 10:00',
        'Objet : Retours v2',
        '',
        'Le logo est trop petit.',
        '',
        'Pièce jointe : retours.pdf',
        '',
        'Texte du PDF',
      ].join('\n'),
    )
    const short = buildMailInputText(
      { fromName: null, fromEmail: null, fallbackName: 'Ibé', date: AT_9, subject: '', body: 'x'.repeat(500), attachments: [] },
      { maxLength: 120, timeZone: 'Europe/Paris' },
    )
    expect(short).toHaveLength(120)
    expect(short.startsWith('Mail de Ibé, le ')).toBe(true)
    expect(short).toContain('Objet : (sans objet)')
    expect(short.endsWith('…')).toBe(true)
  })

  it('titre, conflit, notification « déjà analysé » sans bouton', () => {
    expect(mailTitle('  Retours v2 ', 'Ibé')).toBe('Retours v2')
    expect(mailTitle('', 'Ibé')).toBe('Mail de Ibé')
    expect(isConflict({ status: 409 })).toBe(true)
    expect(isConflict(new Error('x'))).toBe(false)
    expect(alreadyAnalyzedNotification()).toMatchObject({ title: 'Ce mail est déjà analysé', button: null, action: { type: 'dismiss' } })
  })
})

describe('source « gmail » : relève', () => {
  it('propose chaque nouveau mail d’un contact client, puis avance le curseur', async () => {
    const t = setup({ messages: [meta('g-1'), meta('g-2', { date: AT_9 + 60_000, subject: '' })] })
    await flush()
    const query = t.deps.listMessageIds.mock.calls[0]?.[1] ?? ''
    expect(query).toContain('from:(jeanne@ibe.fr)')
    expect(query).not.toContain('old@client.fr')
    expect(query).not.toContain('mael@sordulo.fr')
    expect(query).toContain(`after:${Date.parse(ROW.cursorAt ?? '') / 1000}`)
    expect(t.notifications()).toEqual([
      expect.objectContaining({ kind: 'mailFeedback', title: 'Ibé a envoyé un retour', subtitle: 'Retours g-1', action: { type: 'analyzeMail', messageId: 'g-1@ibe.fr' } }),
      expect.objectContaining({ kind: 'mailFeedback', subtitle: '(sans objet)' }),
    ])
    expect(t.deps.saveGmailCursor).toHaveBeenCalledWith(new Date(AT_9 + 60_000))
    // Jamais le contenu avant « Analyser ».
    expect(t.deps.readMailContent).not.toHaveBeenCalled()
    expect(t.pending()).toContain('g-1@ibe.fr')
  })

  it('écarte mes mails, ceux d’avant le curseur, ceux déjà analysés ; jamais deux fois dans la session', async () => {
    const t = setup({
      messages: [
        meta('mine', { from: { name: null, email: 'mael@sordulo.fr' } }),
        meta('old', { date: Date.parse(ROW.cursorAt ?? '') }),
        meta('done'),
        meta('new'),
        meta('dup', { messageId: 'new@ibe.fr' }),
      ],
      analyzed: ['done@ibe.fr'],
    })
    t.deps.saveGmailCursor.mockRejectedValue(new Error('hors ligne'))
    await flush()
    expect(t.notifications().map((n) => n.action)).toEqual([{ type: 'analyzeMail', messageId: 'new@ibe.fr' }])
    expect(t.deps.findAnalyzedRefs).toHaveBeenCalledWith(['done@ibe.fr', 'new@ibe.fr'])
    // Curseur non enregistré : les mêmes mails reviennent dans la liste, rien n'est reproposé.
    await t.advance(POLL_MS)
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(2)
    expect(t.notifications()).toHaveLength(1)
  })

  it('sans connexion Gmail : rien ; ligne relue toutes les minutes', async () => {
    const t = setup({ row: null, messages: [meta('g-1')] })
    await flush()
    expect(t.deps.listMessageIds).not.toHaveBeenCalled()
    t.setRow(ROW)
    await t.advance(CONNECTION_CHECK_MS)
    expect(t.kinds()).toEqual(['mailFeedback'])
  })

  it('accès perdu (ligne sans jeton) : « Reconnecte Gmail » une seule fois par perte', async () => {
    const t = setup({ row: { ...ROW, refreshToken: null } })
    await flush()
    await t.advance(3 * CONNECTION_CHECK_MS)
    expect(t.notifications()).toEqual([expect.objectContaining({ kind: 'googleReconnect', title: 'Reconnecte Gmail' })])
    t.setRow(ROW)
    await t.advance(CONNECTION_CHECK_MS)
    t.setRow({ ...ROW, refreshToken: null })
    await t.advance(CONNECTION_CHECK_MS)
    expect(t.kinds()).toEqual(['googleReconnect', 'googleReconnect'])
  })

  it('jeton refusé par Google : connexion marquée perdue, « Reconnecte Gmail » une fois', async () => {
    const t = setup({ messages: [meta('g-1')] })
    t.deps.googleAccessToken.mockResolvedValue({ status: 'refused' })
    await flush()
    expect(t.deps.markGmailLost).toHaveBeenCalledTimes(1)
    t.setRow({ ...ROW, refreshToken: null })
    await t.advance(POLL_MS)
    expect(t.kinds()).toEqual(['googleReconnect'])
  })

  it('401 de Gmail : un jeton renouvelé (forceRefresh), puis abandon jusqu’au tour suivant', async () => {
    const t = setup({ messages: [meta('g-1')] })
    t.deps.listMessageIds.mockRejectedValue(new GmailApiError(401, 'refus'))
    await flush()
    expect(t.deps.googleAccessToken.mock.calls).toEqual([
      ['rt-1', false],
      ['rt-1', true],
    ])
    expect(t.notifications()).toEqual([])
    await t.advance(POLL_MS - CONNECTION_CHECK_MS)
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(2)
    await t.advance(CONNECTION_CHECK_MS)
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(4)
  })

  it('erreurs réseau : silencieuses, nouvel essai avec un recul', async () => {
    const t = setup({ messages: [meta('g-1')] })
    t.deps.listMessageIds.mockRejectedValue(new GmailApiError(0, 'hors ligne'))
    await flush()
    await t.advance(POLL_MS) // 2e échec : recul de 8 min
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(2)
    t.deps.listMessageIds.mockImplementation(async () => ['g-1'])
    await t.advance(POLL_MS)
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(2)
    await t.advance(POLL_MS)
    expect(t.deps.listMessageIds).toHaveBeenCalledTimes(3)
    expect(t.kinds()).toEqual(['mailFeedback'])
  })
})

describe('source « gmail » : Analyser, Ignorer', () => {
  it('Analyser : mail complet lu, PDF et Word extraits (l’illisible sauté), entrée écrite, suivi de l’analyse', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    t.click(last(t, 'mailFeedback'))
    expect(t.coordinator.getActivity(MAIL_PROGRESS_ID)).toMatchObject({ kind: 'progress', stage: 'upload', label: 'Lecture du mail' })
    await flush()
    expect(t.deps.readMailContent).toHaveBeenCalledWith('at-1', 'g-1')
    expect(t.deps.getAttachmentBytes.mock.calls.map(([, , a]) => a.filename)).toEqual(['retours.pdf', 'casse.docx'])
    const body = t.deps.createInput.mock.calls[0]?.[0]
    expect(body).toMatchObject({ projectId: 'p-1', kind: 'written', title: 'Retours g-1', externalRef: 'g-1@ibe.fr' })
    expect(body?.rawText).toContain('Mail de Jeanne Dupont <jeanne@ibe.fr>, le ')
    expect(body?.rawText).toContain('Objet : Retours g-1\n\nLe logo est trop petit.\n\nPièce jointe : retours.pdf\n\nTexte de retours.pdf')
    expect(body?.rawText).not.toContain('casse.docx')
    expect(t.tracked).toHaveBeenCalledWith({ inputId: 'in-1', durationSecs: null })
    expect(t.coordinator.getActivity(MAIL_PROGRESS_ID)).toBeNull()
    expect(t.pending()).toBeNull()
  })

  it('déjà analysé (409) : notification courte', async () => {
    const t = setup({ messages: [meta('g-1')] })
    t.deps.createInput.mockRejectedValue(Object.assign(new Error('Déjà importé'), { status: 409 }))
    await flush()
    t.click(last(t, 'mailFeedback'))
    await flush()
    expect(last(t, 'uploadError')).toMatchObject({ title: 'Ce mail est déjà analysé', button: null })
    expect(t.tracked).not.toHaveBeenCalled()
  })

  it('échec : « L’analyse du mail a échoué », Réessayer relance ce mail seulement', async () => {
    const t = setup({ messages: [meta('g-1')] })
    t.deps.createInput.mockRejectedValueOnce(Object.assign(new Error('Serveur injoignable.'), { status: 0 }))
    await flush()
    t.click(last(t, 'mailFeedback'))
    await flush()
    const error = last(t, 'uploadError')
    expect(error).toMatchObject({ title: 'L’analyse du mail a échoué'.replace('’', "'"), subtitle: 'Serveur injoignable.' })
    // Réessayer d'une autre notification (audio) : rien.
    t.click({ ...error, id: 'autre' })
    await flush()
    expect(t.deps.createInput).toHaveBeenCalledTimes(1)
    t.click(error)
    await flush()
    expect(t.deps.createInput).toHaveBeenCalledTimes(2)
    expect(t.tracked).toHaveBeenCalledTimes(1)
  })

  it('Ignorer : rien n’est lu ni envoyé, le mail n’est plus en attente', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    const n = last(t, 'mailFeedback')
    t.click(n, n.secondary?.action)
    await flush()
    expect(t.deps.readMailContent).not.toHaveBeenCalled()
    expect(t.deps.createInput).not.toHaveBeenCalled()
    expect(t.pending()).toBeNull()
  })
})

describe('source « gmail » : relance unique', () => {
  it('mail parti sans réponse : relancé une fois au moment calme, regroupé ; « Voir » repropose un par un, puis oubliés', async () => {
    const t = setup({ messages: [meta('g-1'), meta('g-2', { date: AT_9 + 1000, from: { name: null, email: 'jeanne@ibe.fr' } })] })
    await flush()
    expect(t.kinds()).toEqual(['mailFeedback', 'mailFeedback'])
    await t.advance(CONNECTION_CHECK_MS)
    // Les deux notifications sont parties sans réponse ; ensuite le curseur reste sur l'île (relance gardée affichée).
    t.coordinator.setHover(true)
    await t.advance(REMINDER_DELAY_MS - 3 * CONNECTION_CHECK_MS)
    expect(t.kinds()).not.toContain('mailReminder')
    await t.advance(3 * CONNECTION_CHECK_MS)
    const reminder = last(t, 'mailReminder')
    expect(reminder).toMatchObject({ title: '2 mails clients pas encore traités', subtitle: 'Ibé', action: { type: 'showPendingMails' } })
    t.click(reminder)
    await flush()
    const replayed = t.notifications().slice(-1)
    expect(replayed).toEqual([expect.objectContaining({ kind: 'mailFeedback', subtitle: 'Retours g-1' })])
    // Le premier part sans réponse : le second suit.
    t.coordinator.setHover(false)
    await t.advance(CONNECTION_CHECK_MS)
    expect(last(t, 'mailFeedback').subtitle).toBe('Retours g-2')
    // Le second est traité (Ignorer) : plus rien, et jamais de nouvelle relance.
    const second = last(t, 'mailFeedback')
    t.click(second, second.secondary?.action)
    await t.advance(2 * REMINDER_DELAY_MS)
    expect(t.kinds().filter((k) => k === 'mailReminder')).toHaveLength(1)
    expect(t.kinds().filter((k) => k === 'mailFeedback')).toHaveLength(4)
    expect(t.pending()).toBeNull()
  })

  it('Analyser depuis la relance : le mail est analysé', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    await t.advance(CONNECTION_CHECK_MS)
    t.coordinator.setHover(true)
    await t.advance(REMINDER_DELAY_MS + CONNECTION_CHECK_MS)
    t.click(last(t, 'mailReminder'))
    await flush()
    expect(t.kinds().filter((k) => k === 'mailFeedback')).toHaveLength(2)
    t.click(last(t, 'mailFeedback'))
    await flush()
    expect(t.deps.createInput).toHaveBeenCalledWith(expect.objectContaining({ externalRef: 'g-1@ibe.fr' }))
  })

  it('relance partie sans « Voir » : les mails sont oubliés', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    await t.advance(REMINDER_DELAY_MS + 2 * CONNECTION_CHECK_MS)
    expect(last(t, 'mailReminder')).toMatchObject({ title: 'Un mail client pas encore traité', subtitle: 'Ibé : Retours g-1' })
    await t.advance(2 * REMINDER_DELAY_MS)
    expect(t.kinds().filter((k) => k === 'mailReminder')).toHaveLength(1)
    expect(t.pending()).toBeNull()
  })

  it('traité avant la relance : pas de relance', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    const n = last(t, 'mailFeedback')
    await t.advance(CONNECTION_CHECK_MS)
    // Clic sur une notification déjà partie (rejouée par le labo, par exemple) : le mail est traité.
    t.click(n, n.secondary?.action)
    await t.advance(2 * REMINDER_DELAY_MS)
    expect(t.kinds()).not.toContain('mailReminder')
  })

  it('pas de relance hors de 9 h à 19 h, ni pendant un appel ou une demande Claude ; le lendemain matin sinon', async () => {
    const t = setup({ messages: [meta('g-1')] })
    await flush()
    t.state.hour = 19
    await t.advance(REMINDER_DELAY_MS + 2 * CONNECTION_CHECK_MS)
    expect(t.kinds()).not.toContain('mailReminder')
    t.state.hour = 9
    t.coordinator.addActivity({ id: 'meet', kind: 'meet', appName: 'Meet', service: null, projectId: null, projectName: null, startedAt: 0 })
    await t.advance(2 * CONNECTION_CHECK_MS)
    expect(t.kinds()).not.toContain('mailReminder')
    t.coordinator.removeActivity('meet')
    t.runtime.view.patch({
      sessions: [
        { id: 's', projectName: 'x', projectId: null, cwd: '/', branch: null, task: null, step: null, status: 'waiting', startedAt: 0, conflict: false, error: false, subagents: 0 },
      ],
    })
    await t.advance(2 * CONNECTION_CHECK_MS)
    expect(t.kinds()).not.toContain('mailReminder')
    t.runtime.view.patch({ sessions: [] })
    await t.advance(2 * CONNECTION_CHECK_MS)
    expect(t.kinds()).toContain('mailReminder')
  })

  it('après un redémarrage : les mails en attente sont relancés', async () => {
    const first = setup({ messages: [meta('g-1')] })
    await flush()
    const saved = first.pending() ?? ''
    first.runtime.dispose()
    const t = setup({ storage: { [pendingStorageKey('u-1')]: saved } })
    await flush()
    expect(t.notifications()).toEqual([])
    t.coordinator.setHover(true)
    await t.advance(REMINDER_DELAY_MS + 2 * CONNECTION_CHECK_MS)
    t.click(last(t, 'mailReminder'))
    await flush()
    expect(last(t, 'mailFeedback').action).toEqual({ type: 'analyzeMail', messageId: 'g-1@ibe.fr' })
  })

  it('regroupé par le coordinateur (« N nouveautés ») : relancé aussi', async () => {
    const t = setup({ messages: [meta('g-1'), meta('g-2', { date: AT_9 + 1 }), meta('g-3', { date: AT_9 + 2 })] })
    // Une notification affichée : les trois mails attendent en file et sont regroupés.
    t.coordinator.notify({ ...alreadyAnalyzedNotification(), id: 'occupe' })
    await flush()
    await t.advance(REMINDER_DELAY_MS + 2 * CONNECTION_CHECK_MS)
    expect(last(t, 'mailReminder').title).toBe('3 mails clients pas encore traités')
  })
})
