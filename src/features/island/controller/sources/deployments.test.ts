import { describe, expect, it, vi } from 'vitest'
import { VercelApiError, type VercelConnection, type VercelDeployment, type VercelTeam } from '../../../../lib/vercel'
import type { DeploymentsEnabledState } from '../../../../shared/desktop-contract'
import type { IslandNotification } from '../../types'
import { SIGNED_OUT } from '../source'
import { SIGNED_IN, fakeEvent, flush, setupRuntime } from '../testUtils'
import {
  CONNECTION_CHECK_MS,
  DEFAULT_DEPLOY_MS,
  MAX_DEPLOY_MS,
  MIN_DEPLOY_MS,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  TEAMS_REFRESH_MS,
  createDeploymentsSource,
  deployActivity,
  deployDurationMs,
  deployName,
  estimateDeployMs,
  retryDelayMs,
  type DeploymentsSourceDeps,
} from './deployments'

const ACTIVITY = 'prog:deploy:prj-1'

function dep(id: string, fields: Partial<VercelDeployment> = {}): VercelDeployment {
  return {
    id,
    projectId: 'prj-1',
    projectName: 'sordulo-os-app',
    url: `https://${id}.vercel.app`,
    inspectorUrl: `https://vercel.com/sordulo/${id}`,
    state: 'BUILDING',
    createdAt: 900_000,
    buildingAt: 905_000,
    readyAt: null,
    repo: 'sordulo-OS-APP',
    branch: 'main',
    commitMessage: 'Ajoute la page Connecteurs',
    teamId: null,
    ...fields,
  }
}

/** Déploiement en ligne qui a duré `ms` (construction comprise). */
function ready(id: string, ms: number, fields: Partial<VercelDeployment> = {}): VercelDeployment {
  return dep(id, { state: 'READY', createdAt: 100_000, buildingAt: 100_000, readyAt: 100_000 + ms, ...fields })
}

const CONNECTION: VercelConnection = { token: 'tok-1', account: 'sacha', updatedAt: '2026-11-23T10:00:00Z' }

function setup(
  options: {
    enabled?: boolean
    connection?: VercelConnection | null
    teams?: VercelTeam[]
    signedIn?: boolean
    lists?: Record<string, VercelDeployment[]>
  } = {},
) {
  const enabledEvent = fakeEvent<DeploymentsEnabledState>()
  let connection = options.connection === undefined ? CONNECTION : options.connection
  let teams: VercelTeam[] | Error = options.teams ?? []
  /** Réponse par portée (« personnel » ou id de l'équipe) : liste, erreur, ou promesse en attente. */
  const lists = new Map<string, VercelDeployment[] | Error | Promise<VercelDeployment[]>>(
    Object.entries(options.lists ?? {}),
  )
  const deps = {
    getDeploymentsEnabled: vi.fn(async () => ({ on: options.enabled ?? true })),
    onDeploymentsEnabled: enabledEvent.subscribe,
    readVercelConnection: vi.fn(async () => connection),
    fetchVercelTeams: vi.fn(async (_token: string) => {
      if (teams instanceof Error) throw teams
      return teams
    }),
    fetchProductionDeployments: vi.fn(async (_token: string, teamId: string | null) => {
      const value = lists.get(teamId ?? 'personnel') ?? []
      if (value instanceof Error) throw value
      return value
    }),
    fetchProductionUrl: vi.fn(
      async (_token: string, _id: string, _teamId: string | null): Promise<string | null> => 'https://sordulo.app',
    ),
  } satisfies DeploymentsSourceDeps
  const env = setupRuntime({ sources: [createDeploymentsSource(deps)], signedIn: options.signedIn })
  const notify = vi.spyOn(env.coordinator, 'notify')
  return {
    ...env,
    deps,
    enabledEvent,
    notify,
    notifications: () => notify.mock.calls.map(([n]: [IslandNotification]) => n),
    activity: (id = ACTIVITY) => env.coordinator.getActivity(id),
    /** Prochaine réponse de la portée (« personnel » par défaut). */
    respond(list: VercelDeployment[] | Error | Promise<VercelDeployment[]>, scope = 'personnel') {
      lists.set(scope, list)
    },
    setConnection(next: VercelConnection | null) {
      connection = next
    },
    setTeams(next: VercelTeam[] | Error) {
      teams = next
    },
    async tick(ms: number) {
      env.clock.advance(ms)
      await flush()
    },
    polls: () => deps.fetchProductionDeployments.mock.calls.length,
  }
}

describe('déploiements : fonctions pures', () => {
  it('estimation : médiane bornée, 60 s sans historique', () => {
    expect(estimateDeployMs([])).toBe(DEFAULT_DEPLOY_MS)
    expect(estimateDeployMs([30_000, 90_000, 60_000])).toBe(60_000)
    expect(estimateDeployMs([20_000, 40_000])).toBe(30_000)
    expect(estimateDeployMs([1000, 2000])).toBe(MIN_DEPLOY_MS)
    expect(estimateDeployMs([2 * 3_600_000])).toBe(MAX_DEPLOY_MS)
  })

  it('durée d’un déploiement en ligne : depuis le début de la construction, sinon la création', () => {
    expect(deployDurationMs(ready('a', 42_000))).toBe(42_000)
    expect(deployDurationMs(dep('b', { state: 'READY', createdAt: 1000, buildingAt: null, readyAt: 31_000 }))).toBe(30_000)
    expect(deployDurationMs(dep('c'))).toBeNull()
    expect(deployDurationMs(dep('d', { state: 'ERROR', readyAt: 950_000 }))).toBeNull()
  })

  it('nom affiché : le dépôt Git, sinon le projet Vercel', () => {
    expect(deployName(dep('a'))).toBe('sordulo-OS-APP')
    expect(deployName(dep('a', { repo: null }))).toBe('sordulo-os-app')
  })

  it('progression : id par projet (nom sans id), dépôt, message du commit et branche, début de la construction sinon création', () => {
    expect(deployActivity(dep('a'), 40_000)).toEqual({
      id: ACTIVITY,
      kind: 'progress',
      stage: 'deploy',
      label: 'sordulo-OS-APP',
      detail: 'Ajoute la page Connecteurs',
      meta: 'main',
      fraction: null,
      startedAt: 905_000,
      estimatedMs: 40_000,
    })
    const noId = deployActivity(dep('a', { projectId: null, buildingAt: null }), 40_000)
    expect(noId).toMatchObject({ id: 'prog:deploy:sordulo-os-app', startedAt: 900_000 })
    // Sans Git (CLI) : le projet Vercel, ni détail ni branche.
    const noGit = deployActivity(dep('a', { repo: null, commitMessage: null, branch: null }), 40_000)
    expect(noGit).toMatchObject({ label: 'sordulo-os-app', detail: null, meta: null })
  })

  it('délai après erreur : grandit, 60 s au plus', () => {
    expect(retryDelayMs(1)).toBe(5000)
    expect(retryDelayMs(2)).toBe(10_000)
    expect(retryDelayMs(3)).toBe(20_000)
    expect(retryDelayMs(10)).toBe(60_000)
  })
})

describe('source « déploiements »', () => {
  it('premier sondage = référence : les déploiements finis ne sont pas notifiés, ceux en cours sont affichés', async () => {
    const t = setup({
      lists: { personnel: [dep('d-3'), ready('d-2', 40_000), ready('d-1', 80_000), dep('d-0', { state: 'ERROR' })] },
    })
    await flush()
    expect(t.notify).not.toHaveBeenCalled()
    expect(t.activity()).toMatchObject({
      kind: 'progress',
      stage: 'deploy',
      label: 'sordulo-OS-APP',
      detail: 'Ajoute la page Connecteurs',
      meta: 'main',
      fraction: null,
      startedAt: 905_000,
      // Médiane des déploiements en ligne du projet vus dans la réponse.
      estimatedMs: 60_000,
    })
  })

  it('en ligne : progression retirée, « X est en ligne » avec le commit, Ouvrir vers l’adresse de production', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.activity()).toBeNull()
    expect(t.deps.fetchProductionUrl).toHaveBeenCalledWith('tok-1', 'd-1', null)
    expect(t.notifications()).toEqual([
      expect.objectContaining({
        kind: 'deployed',
        title: 'sordulo-OS-APP est en ligne',
        subtitle: 'Ajoute la page Connecteurs',
        button: 'Ouvrir',
        action: { type: 'openUrl', url: 'https://sordulo.app' },
      }),
    ])
  })

  it('en ligne sans alias ni Git : projet Vercel, URL du déploiement, sous-titre par défaut', async () => {
    const t = setup({ lists: { personnel: [dep('d-1', { repo: null, commitMessage: null })] } })
    t.deps.fetchProductionUrl.mockResolvedValue(null)
    await flush()
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000, repo: null, commitMessage: null })])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.notifications()[0]).toMatchObject({
      title: 'sordulo-os-app est en ligne',
      subtitle: 'Déploiement Vercel réussi',
      action: { type: 'openUrl', url: 'https://d-1.vercel.app' },
    })
  })

  it('adresse de production illisible : URL du déploiement', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    t.deps.fetchProductionUrl.mockRejectedValue(new VercelApiError(0, 'réseau', false))
    await flush()
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.notifications()[0]?.action).toEqual({ type: 'openUrl', url: 'https://d-1.vercel.app' })
  })

  it('échec : « X : échec », « Voir les logs » vers l’inspecteur (repli : URL)', async () => {
    const site = { projectId: 'prj-2', projectName: 'site', repo: null, inspectorUrl: null }
    const t = setup({ lists: { personnel: [dep('d-1'), dep('d-2', site)] } })
    await flush()
    t.respond([
      dep('d-1', { state: 'ERROR', readyAt: 950_000 }),
      dep('d-2', { ...site, state: 'ERROR', commitMessage: null }),
    ])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.activity()).toBeNull()
    expect(t.notifications()).toEqual([
      expect.objectContaining({
        kind: 'deployFailed',
        title: 'sordulo-OS-APP : échec',
        subtitle: 'Ajoute la page Connecteurs',
        tone: 'danger',
        button: 'Voir les logs',
        action: { type: 'openUrl', url: 'https://vercel.com/sordulo/d-1' },
      }),
      expect.objectContaining({
        title: 'site : échec',
        subtitle: 'Branche main',
        action: { type: 'openUrl', url: 'https://d-2.vercel.app' },
      }),
    ])
  })

  it('annulé : progression retirée, sans notification', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.respond([dep('d-1', { state: 'CANCELED' })])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.activity()).toBeNull()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('nouveau déploiement déjà fini après la référence : notifié, une seule fois', async () => {
    const t = setup({ lists: { personnel: [ready('d-1', 40_000)] } })
    await flush()
    t.respond([dep('d-2', { state: 'READY', readyAt: 950_000 }), ready('d-1', 40_000)])
    await t.tick(POLL_IDLE_MS)
    await t.tick(POLL_IDLE_MS)
    await t.tick(POLL_IDLE_MS)
    expect(t.notifications().map((n) => n.kind)).toEqual(['deployed'])
  })

  it('le plus récent du projet gagne ; un projet par progression', async () => {
    const t = setup({
      lists: {
        personnel: [
          dep('d-2', { createdAt: 910_000, buildingAt: null, branch: 'refonte', commitMessage: 'Refonte du header' }),
          dep('d-1'),
          dep('d-3', { projectId: 'prj-2', projectName: 'site', repo: null, branch: null }),
        ],
      },
    })
    await flush()
    expect(t.activity()).toMatchObject({
      label: 'sordulo-OS-APP',
      detail: 'Refonte du header',
      meta: 'refonte',
      startedAt: 910_000,
    })
    expect(t.activity('prog:deploy:prj-2')).toMatchObject({ label: 'site', meta: null })
    // Le plus récent fini, l'autre encore en cours : la progression passe à lui, sans changer de rang.
    const order = t.activity()?.order
    t.respond([
      dep('d-2', { createdAt: 910_000, state: 'READY', readyAt: 950_000 }),
      dep('d-1'),
      dep('d-3', { projectId: 'prj-2', projectName: 'site', repo: null, branch: null }),
    ])
    await t.tick(POLL_ACTIVE_MS)
    // Détail et branche suivent le déploiement affiché (l'empreinte les compte).
    expect(t.activity()).toMatchObject({
      label: 'sordulo-OS-APP',
      detail: 'Ajoute la page Connecteurs',
      meta: 'main',
      startedAt: 905_000,
      order,
    })
  })

  it('sonde toutes les 3 s pendant un déploiement, 10 s sinon', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    expect(t.polls()).toBe(1)
    await t.tick(POLL_ACTIVE_MS)
    expect(t.polls()).toBe(2)
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(POLL_ACTIVE_MS)
    expect(t.polls()).toBe(3)
    await t.tick(POLL_ACTIVE_MS)
    expect(t.polls()).toBe(3)
    await t.tick(POLL_IDLE_MS - POLL_ACTIVE_MS)
    expect(t.polls()).toBe(4)
  })

  it('équipes : compte personnel et chaque équipe en parallèle, référence par équipe, rafraîchies toutes les 10 min', async () => {
    const t = setup({
      teams: [{ id: 'team-1', slug: 'sordulo', name: 'Sordulo' }],
      lists: { personnel: [], 'team-1': [ready('t-1', 30_000, { teamId: 'team-1' })] },
    })
    await flush()
    expect(t.deps.fetchProductionDeployments.mock.calls.map(([, teamId]) => teamId)).toEqual([null, 'team-1'])
    expect(t.notify).not.toHaveBeenCalled()

    // Nouvelle équipe : sa première réponse est sa référence.
    t.setTeams([
      { id: 'team-1', slug: 'sordulo', name: 'Sordulo' },
      { id: 'team-2', slug: 'ibe', name: 'Ibé' },
    ])
    t.respond([ready('t-2', 30_000, { teamId: 'team-2' })], 'team-2')
    // Un sondage par tour (la réponse arrive après l'avance de l'horloge).
    for (let elapsed = 0; elapsed < TEAMS_REFRESH_MS - POLL_IDLE_MS; elapsed += POLL_IDLE_MS) await t.tick(POLL_IDLE_MS)
    expect(t.deps.fetchVercelTeams).toHaveBeenCalledTimes(1)
    await t.tick(POLL_IDLE_MS)
    expect(t.deps.fetchVercelTeams).toHaveBeenCalledTimes(2)
    expect(t.notify).not.toHaveBeenCalled()
    // Ensuite, un déploiement de cette équipe est suivi comme les autres.
    t.respond([dep('t-3', { teamId: 'team-2', projectId: 'prj-9', projectName: 'ibe', repo: 'app-ibe' }), ready('t-2', 30_000, { teamId: 'team-2' })], 'team-2')
    await t.tick(POLL_IDLE_MS)
    expect(t.activity('prog:deploy:prj-9')).not.toBeNull()
    t.respond([dep('t-3', { teamId: 'team-2', projectId: 'prj-9', projectName: 'ibe', repo: 'app-ibe', state: 'READY', readyAt: 950_000 })], 'team-2')
    await t.tick(POLL_ACTIVE_MS)
    expect(t.deps.fetchProductionUrl).toHaveBeenLastCalledWith('tok-1', 't-3', 'team-2')
    expect(t.notifications().map((n) => n.title)).toEqual(['app-ibe est en ligne'])
  })

  it('dédoublonne un déploiement vu dans deux portées', async () => {
    const t = setup({
      teams: [{ id: 'team-1', slug: 'sordulo', name: null }],
      lists: { personnel: [dep('d-1')], 'team-1': [dep('d-1', { teamId: 'team-1' })] },
    })
    await flush()
    const done = dep('d-1', { state: 'READY', readyAt: 950_000 })
    t.respond([done])
    t.respond([{ ...done, teamId: 'team-1' }], 'team-1')
    await t.tick(POLL_ACTIVE_MS)
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('erreur réseau : état gardé, nouvel essai avec un délai qui grandit', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.respond(new VercelApiError(0, 'Vercel ne répond pas.', false))
    await t.tick(POLL_ACTIVE_MS)
    expect(t.polls()).toBe(2)
    expect(t.activity()).not.toBeNull()
    await t.tick(retryDelayMs(1) - 1)
    expect(t.polls()).toBe(2)
    await t.tick(1)
    expect(t.polls()).toBe(3)
    await t.tick(retryDelayMs(2))
    expect(t.polls()).toBe(4)
    // Retour du réseau : la fin est notifiée, le rythme normal reprend.
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(retryDelayMs(3))
    expect(t.notifications().map((n) => n.kind)).toEqual(['deployed'])
    await t.tick(POLL_IDLE_MS)
    expect(t.polls()).toBe(6)
  })

  it('jamais deux sondages en même temps', async () => {
    const t = setup()
    t.respond(new Promise<VercelDeployment[]>(() => {}))
    await flush()
    await t.tick(10 * 60_000)
    expect(t.polls()).toBe(1)
  })

  it('jeton refusé : « Reconnecte Vercel » une fois, progressions retirées, plus de sondage jusqu’à un nouveau jeton', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.respond(new VercelApiError(401, 'refusé', true))
    await t.tick(POLL_ACTIVE_MS)
    expect(t.activity()).toBeNull()
    expect(t.notifications()).toEqual([
      expect.objectContaining({
        kind: 'vercelReconnect',
        title: 'Reconnecte Vercel',
        action: { type: 'openMain', route: '/connectors' },
      }),
    ])
    await t.tick(CONNECTION_CHECK_MS * 3)
    expect(t.polls()).toBe(2)
    expect(t.notify).toHaveBeenCalledTimes(1)

    // Nouveau jeton : on repart de zéro (référence), le sondage reprend.
    t.setConnection({ ...CONNECTION, token: 'tok-2', updatedAt: '2026-11-23T12:00:00Z' })
    t.respond([ready('d-1', 40_000)])
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.polls()).toBe(3)
    expect(t.deps.fetchProductionDeployments).toHaveBeenLastCalledWith('tok-2', null)
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('équipes refusées : même traitement que le jeton refusé', async () => {
    const t = setup()
    t.setTeams(new VercelApiError(403, 'refusé', true))
    await flush()
    expect(t.polls()).toBe(0)
    expect(t.notifications().map((n) => n.kind)).toEqual(['vercelReconnect'])
  })

  it('pas de jeton : rien ; le jeton ajouté depuis la fenêtre principale est lu dans la minute', async () => {
    const t = setup({ connection: null, lists: { personnel: [ready('d-1', 40_000), dep('d-2')] } })
    await flush()
    expect(t.polls()).toBe(0)
    await t.tick(CONNECTION_CHECK_MS - 1)
    expect(t.deps.readVercelConnection).toHaveBeenCalledTimes(1)
    t.setConnection(CONNECTION)
    await t.tick(1)
    expect(t.polls()).toBe(1)
    expect(t.notify).not.toHaveBeenCalled()
    expect(t.activity()).not.toBeNull()
  })

  it('jeton remplacé : on repart de zéro (nouvelle référence), seul le nouveau jeton est sondé', async () => {
    const t = setup()
    t.deps.fetchProductionDeployments.mockImplementation(async (token: string) =>
      // Pour l'ancien jeton, d-9 serait un nouveau déploiement fini ; pour le nouveau, c'est la référence.
      token === 'tok-2' ? [dep('d-8'), ready('d-9', 40_000)] : [],
    )
    await flush()
    t.setConnection({ ...CONNECTION, token: 'tok-2', updatedAt: '2026-11-23T11:00:00Z' })
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.deps.fetchProductionDeployments).toHaveBeenLastCalledWith('tok-2', null)
    expect(t.activity()).not.toBeNull()
    const calls = t.polls()
    await t.tick(POLL_ACTIVE_MS)
    await t.tick(POLL_ACTIVE_MS)
    expect(t.deps.fetchProductionDeployments.mock.calls.slice(calls).map(([token]) => token)).toEqual(['tok-2', 'tok-2'])
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('même jeton enregistré de nouveau (updatedAt) : on repart de zéro ; inchangé : le suivi continue', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    const first = t.activity()?.order
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.activity()?.order).toBe(first)
    t.setConnection({ ...CONNECTION, updatedAt: '2026-11-23T11:00:00Z' })
    await t.tick(CONNECTION_CHECK_MS)
    // Progression retirée par l'ancien suivi, rajoutée par le nouveau (référence).
    expect(t.activity()?.order).toBeGreaterThan(first ?? Infinity)
  })

  it('jeton retiré : progressions retirées, plus de sondage', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.setConnection(null)
    await t.tick(CONNECTION_CHECK_MS)
    expect(t.activity()).toBeNull()
    const polls = t.polls()
    await t.tick(POLL_ACTIVE_MS)
    await t.tick(POLL_IDLE_MS)
    expect(t.polls()).toBe(polls)
  })

  it('case décochée au démarrage : ni lecture du jeton ni sondage ; cochée ensuite : démarre', async () => {
    const t = setup({ enabled: false, lists: { personnel: [dep('d-1')] } })
    await flush()
    expect(t.deps.readVercelConnection).not.toHaveBeenCalled()
    expect(t.polls()).toBe(0)
    t.enabledEvent.emit({ on: true })
    await flush()
    expect(t.polls()).toBe(1)
    expect(t.activity()).not.toBeNull()
  })

  it('case décochée : progressions retirées, plus de sondage ni de notification ; recochée : nouvelle référence', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    t.enabledEvent.emit({ on: false })
    expect(t.activity()).toBeNull()
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(POLL_IDLE_MS * 3)
    expect(t.polls()).toBe(1)
    t.enabledEvent.emit({ on: true })
    await flush()
    expect(t.polls()).toBe(2)
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('pas de notification quand la case est décochée pendant la lecture de l’adresse de production', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    let resolveUrl: (url: string | null) => void = () => {}
    t.deps.fetchProductionUrl.mockReturnValue(new Promise((resolve) => (resolveUrl = resolve)))
    await flush()
    t.respond([dep('d-1', { state: 'READY', readyAt: 950_000 })])
    await t.tick(POLL_ACTIVE_MS)
    t.enabledEvent.emit({ on: false })
    resolveUrl('https://sordulo.app')
    await flush()
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('un changement de la case reçu avant la lecture initiale l’emporte sur elle', async () => {
    const t = setup({ enabled: true, lists: { personnel: [dep('d-1')] } })
    t.enabledEvent.emit({ on: false })
    await flush()
    expect(t.polls()).toBe(0)
  })

  it('lecture de la case impossible : affichés par défaut', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    t.deps.getDeploymentsEnabled.mockRejectedValue(new Error('pas de Rust'))
    await flush()
    expect(t.activity()).not.toBeNull()
  })

  it('attend la connexion, s’arrête à la déconnexion, repart de zéro à la reconnexion', async () => {
    const t = setup({ signedIn: false, lists: { personnel: [dep('d-1')] } })
    await flush()
    expect(t.deps.readVercelConnection).not.toHaveBeenCalled()
    t.session.set(SIGNED_IN)
    await flush()
    expect(t.activity()).not.toBeNull()

    t.session.set(SIGNED_OUT)
    expect(t.activity()).toBeNull()
    t.respond([dep('d-1', { state: 'ERROR', readyAt: 950_000 })])
    await t.tick(POLL_IDLE_MS * 3)
    expect(t.polls()).toBe(1)

    t.session.set(SIGNED_IN)
    await flush()
    expect(t.polls()).toBe(2)
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('s’arrête avec le runtime : désabonnement, plus de minuteur', async () => {
    const t = setup({ lists: { personnel: [dep('d-1')] } })
    await flush()
    expect(t.enabledEvent.listeners).toBe(1)
    t.runtime.dispose()
    expect(t.enabledEvent.listeners).toBe(0)
    expect(t.clock.pendingTimers).toBe(0)
  })
})
