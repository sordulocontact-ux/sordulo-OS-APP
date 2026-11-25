import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashMcpToken, MCP_TOKEN_PATTERN } from '../../../api/_lib/mcp/auth'
import {
  activeTokens,
  describeMcp,
  generateMcpToken,
  lastUsedLabel,
  mcpAddCommand,
  mcpEndpoint,
  tokenNameError,
  type McpTokenRow,
} from './mcpTokens'

describe('jetons MCP', () => {
  it('format sdo_ + 32 octets en base64url, préfixe et empreinte SHA-256 identiques au serveur', async () => {
    const generated = await generateMcpToken((bytes) => bytes.fill(251))
    expect(generated.token).toMatch(MCP_TOKEN_PATTERN)
    expect(generated.token).toBe(`sdo_${Buffer.from(new Uint8Array(32).fill(251)).toString('base64url')}`)
    expect(generated.prefix).toBe(generated.token.slice(0, 12))
    expect(generated.hash).toBe(createHash('sha256').update(generated.token).digest('hex'))
    expect(generated.hash).toBe(await hashMcpToken(generated.token))
  })

  it('deux jetons générés diffèrent', async () => {
    const [a, b] = await Promise.all([generateMcpToken(), generateMcpToken()])
    expect(a.token).not.toBe(b.token)
    expect(a.token).toMatch(MCP_TOKEN_PATTERN)
  })

  it('adresse du serveur et commande Claude Code', () => {
    expect(mcpEndpoint('https://os.sordulo.fr/', 'tauri://localhost')).toBe('https://os.sordulo.fr/api/mcp')
    expect(mcpEndpoint(undefined, 'http://localhost:5173')).toBe('http://localhost:5173/api/mcp')
    expect(mcpEndpoint('  ', 'https://app.test')).toBe('https://app.test/api/mcp')
    expect(mcpAddCommand('https://app.test/api/mcp', 'sdo_x')).toBe(
      'claude mcp add --transport http sordulo https://app.test/api/mcp --header "Authorization: Bearer sdo_x"',
    )
  })

  it('nom du jeton', () => {
    expect(tokenNameError('  ')).toContain('Donne un nom')
    expect(tokenNameError('x'.repeat(101))).toContain('100')
    expect(tokenNameError('Claude Code')).toBeNull()
  })

  it('liste : jetons actifs, plus récents d’abord ; dernière utilisation', () => {
    const row = (id: string, created: string, revoked: string | null = null): McpTokenRow => ({
      id, name: id, prefix: 'sdo_abcdefgh', last_used_at: null, created_at: created, revoked_at: revoked,
    })
    expect(activeTokens([row('a', '2026-11-01'), row('b', '2026-11-03'), row('c', '2026-11-04', '2026-11-05')]).map((r) => r.id)).toEqual(['b', 'a'])
    expect(lastUsedLabel(null)).toBe('Jamais utilisé')
    expect(lastUsedLabel('2026-11-20T10:00:00Z')).toMatch(/^Utilisé le 20 novembre 2026/)
  })

  it('état de la carte', () => {
    expect(describeMcp({ loading: true, loadFailed: false, activeCount: 0 }).badge.label).toBe('Chargement')
    expect(describeMcp({ loading: false, loadFailed: true, activeCount: 0 }).badge.tone).toBe('warning')
    expect(describeMcp({ loading: false, loadFailed: false, activeCount: 0 })).toMatchObject({ connected: false, badge: { label: 'Aucun jeton' } })
    expect(describeMcp({ loading: false, loadFailed: false, activeCount: 2 })).toMatchObject({ connected: true, badge: { label: '2 jetons actifs' } })
  })
})
