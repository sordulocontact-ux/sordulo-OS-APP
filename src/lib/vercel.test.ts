import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VercelApiError,
  fetchVercelAccount,
  isDeploymentActive,
  normalizeAccount,
  normalizeDeployment,
  normalizeDeployments,
  normalizeTeams,
  productionUrlOf,
} from './vercel'

const RAW = {
  uid: 'dpl_abc',
  name: 'sordulo-os-app',
  url: 'sordulo-os-app-git-main-sordulo.vercel.app',
  projectId: 'prj_1',
  readyState: 'READY',
  created: 1_700_000_000_000,
  createdAt: 1_700_000_000_500,
  buildingAt: 1_700_000_001_000,
  ready: 1_700_000_061_000,
  inspectorUrl: 'https://vercel.com/sordulo/sordulo-os-app/abc',
  meta: {
    githubCommitRepo: 'sordulo-OS-APP',
    githubCommitOrg: 'sordulocontact-ux',
    githubCommitRef: 'main',
    githubCommitMessage: 'feat: île\n\nCorps du message\nsuite',
  },
}

describe('normalizeDeployment', () => {
  it('normalise la forme réelle de l’API', () => {
    expect(normalizeDeployment(RAW, 'team_1')).toEqual({
      id: 'dpl_abc',
      projectId: 'prj_1',
      projectName: 'sordulo-os-app',
      url: 'https://sordulo-os-app-git-main-sordulo.vercel.app',
      inspectorUrl: 'https://vercel.com/sordulo/sordulo-os-app/abc',
      state: 'READY',
      createdAt: 1_700_000_000_500,
      buildingAt: 1_700_000_001_000,
      readyAt: 1_700_000_061_000,
      repo: 'sordulo-OS-APP',
      branch: 'main',
      commitMessage: 'feat: île',
      teamId: 'team_1',
    })
  })

  it('accepte id, state en minuscules et created à la place de createdAt', () => {
    const d = normalizeDeployment({ id: 'dpl_x', url: 'x.vercel.app', state: 'building', created: 5 }, null)
    expect(d).toMatchObject({ id: 'dpl_x', state: 'BUILDING', createdAt: 5, teamId: null, buildingAt: null, readyAt: null })
  })

  it('garde https:// déjà présent, sans Git : branche et message nuls', () => {
    const d = normalizeDeployment({ uid: 'a', url: 'https://x.app', readyState: 'ERROR', createdAt: 1 }, null)
    expect(d).toMatchObject({
      url: 'https://x.app',
      repo: null,
      branch: null,
      commitMessage: null,
      inspectorUrl: null,
      projectName: 'https://x.app',
    })
  })

  it('lit GitLab et Bitbucket', () => {
    const gitlab = { gitlabProjectName: 'site-ibe', gitlabCommitRef: 'dev', gitlabCommitMessage: 'fix' }
    expect(normalizeDeployment({ ...RAW, meta: gitlab }, null)).toMatchObject({
      repo: 'site-ibe',
      branch: 'dev',
      commitMessage: 'fix',
    })
    const bitbucket = { bitbucketRepoName: 'app-ibe', bitbucketCommitRef: 'prod', bitbucketCommitMessage: 'release' }
    expect(normalizeDeployment({ ...RAW, meta: bitbucket }, null)).toMatchObject({
      repo: 'app-ibe',
      branch: 'prod',
      commitMessage: 'release',
    })
  })

  it('nom du dépôt vide ou absent : null', () => {
    expect(normalizeDeployment({ ...RAW, meta: { githubCommitRepo: '  ' } }, null)?.repo).toBeNull()
    expect(normalizeDeployment({ ...RAW, meta: 'x' }, null)?.repo).toBeNull()
  })

  it('message de commit en CRLF : première ligne seulement', () => {
    const meta = { githubCommitMessage: 'titre\r\ncorps' }
    expect(normalizeDeployment({ ...RAW, meta }, null)?.commitMessage).toBe('titre')
  })

  it('ignore les objets invalides', () => {
    for (const bad of [null, 'x', 3, [], {}, { ...RAW, uid: '' }, { ...RAW, url: undefined }, { ...RAW, readyState: 'WAT' }, { ...RAW, createdAt: 0, created: undefined }]) {
      expect(normalizeDeployment(bad, null)).toBeNull()
    }
  })
})

describe('normalizeDeployments', () => {
  it('trie du plus récent au plus ancien et écarte les invalides', () => {
    const list = normalizeDeployments(
      { deployments: [{ ...RAW, uid: 'old', createdAt: 1 }, 'bad', { ...RAW, uid: 'new', createdAt: 9 }, { ...RAW, uid: 'mid', createdAt: 5 }] },
      null,
    )
    expect(list.map((d) => d.id)).toEqual(['new', 'mid', 'old'])
  })
  it('corps inattendu : liste vide', () => {
    expect(normalizeDeployments(null, null)).toEqual([])
    expect(normalizeDeployments({ deployments: 'x' }, null)).toEqual([])
  })
})

describe('normalizeAccount, normalizeTeams, productionUrlOf, isDeploymentActive', () => {
  it('compte', () => {
    expect(normalizeAccount({ user: { id: 'u1', username: 'sacha', name: 'Sacha' } })).toEqual({ id: 'u1', username: 'sacha', name: 'Sacha' })
    expect(normalizeAccount({ user: { uid: 'u1', username: 'sacha' } })).toEqual({ id: 'u1', username: 'sacha', name: null })
    expect(normalizeAccount({ user: { id: 'u1' } })).toBeNull()
    expect(normalizeAccount({})).toBeNull()
  })
  it('équipes', () => {
    expect(normalizeTeams({ teams: [{ id: 't1', slug: 'sordulo', name: 'Sordulo' }, { id: 't2' }, 'x'] })).toEqual([
      { id: 't1', slug: 'sordulo', name: 'Sordulo' },
    ])
    expect(normalizeTeams(null)).toEqual([])
  })
  it('adresse de production : premier alias valide, avec https', () => {
    expect(productionUrlOf({ alias: [null, 'app.sordulo.com', 'b.vercel.app'] })).toBe('https://app.sordulo.com')
    expect(productionUrlOf({ alias: [] })).toBeNull()
    expect(productionUrlOf({})).toBeNull()
  })
  it('déploiement actif', () => {
    expect(['QUEUED', 'INITIALIZING', 'BUILDING'].every((s) => isDeploymentActive(s as 'QUEUED'))).toBe(true)
    expect(['READY', 'ERROR', 'CANCELED'].some((s) => isDeploymentActive(s as 'READY'))).toBe(false)
  })
})

describe('fetchVercelAccount (fetch simulé)', () => {
  const SECRET = 'vcp_SECRET_TOKEN_123'
  afterEach(() => vi.unstubAllGlobals())

  const stub = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  async function fail(): Promise<VercelApiError> {
    const error = await fetchVercelAccount(SECRET).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(VercelApiError)
    return error as VercelApiError
  }

  it('succès : envoie le jeton en Bearer et renvoie le compte', async () => {
    stub(200, { user: { id: 'u1', username: 'sacha' } })
    await expect(fetchVercelAccount(SECRET)).resolves.toMatchObject({ username: 'sacha' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toBe('https://api.vercel.com/v2/user')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`)
  })

  it('401 : jeton refusé', async () => {
    stub(401, { error: { code: 'forbidden' } })
    const e = await fail()
    expect(e.unauthorized).toBe(true)
    expect(e.status).toBe(401)
    expect(e.message).not.toContain(SECRET)
  })

  it('403 avec invalidToken : jeton refusé', async () => {
    stub(403, { error: { code: 'forbidden', invalidToken: true } })
    expect((await fail()).unauthorized).toBe(true)
  })

  it('403 sans invalidToken : pas un jeton refusé', async () => {
    stub(403, { error: { code: 'forbidden', message: 'Pas le droit' } })
    const e = await fail()
    expect(e.unauthorized).toBe(false)
    expect(e.message).toContain('403')
    expect(e.message).not.toContain(SECRET)
  })

  it('corps non JSON : erreur propre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 500 })))
    const e = await fail()
    expect(e).toMatchObject({ status: 500, unauthorized: false })
  })

  it('réponse 200 de forme inattendue : erreur', async () => {
    stub(200, { nope: true })
    expect((await fail()).message).toContain('inattendue')
  })

  it('erreur réseau : status 0, sans le jeton', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`Failed to fetch Bearer ${SECRET}`) }))
    const e = await fail()
    expect(e.status).toBe(0)
    expect(e.unauthorized).toBe(false)
    expect(e.message).not.toContain(SECRET)
  })
})
