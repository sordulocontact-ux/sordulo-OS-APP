/**
 * Protection SSRF pour toute requête serveur vers une adresse saisie par un utilisateur (site d'un prospect).
 * - http / https seulement, ni identifiants dans l'URL, ports 80 et 443 seulement ;
 * - noms réservés refusés (localhost, .local, .internal…), nom de domaine complet exigé ;
 * - toute adresse IP (littérale ou résolue par le DNS) doit être publique : privées, loopback, link-local
 *   (dont les métadonnées cloud 169.254.169.254), CGNAT, multicast, réservées, IPv6 locales ou documentaires,
 *   et IPv4 enveloppées dans de l'IPv6 (mappée, NAT64, 6to4) sont refusées ;
 * - la connexion se fait sur l'adresse déjà vérifiée (voir fetchPage.ts), jamais sur un second résolu DNS.
 * Messages d'erreur en français, affichables à l'utilisateur.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export function parseIPv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    bytes.push(n)
  }
  return bytes as [number, number, number, number]
}

/** IPv6 → 8 groupes de 16 bits (suffixe IPv4 pointé accepté), null si invalide. */
export function expandIPv6(ip: string): number[] | null {
  let text = ip
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (tail?.[1]) {
    const v4 = parseIPv4(tail[1])
    if (!v4) return null
    text = `${text.slice(0, text.length - tail[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
      groups.push(parseInt(g, 16))
    }
    return groups
  }
  const head = toGroups(halves[0] ?? '')
  if (!head) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const rest = toGroups(halves[1] ?? '')
  if (!rest) return null
  const missing = 8 - head.length - rest.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...rest]
}

function isPrivateIPv4(b: readonly [number, number, number, number]): boolean {
  const [a, c, d] = b
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true
  if (a === 100 && c >= 64 && c <= 127) return true // CGNAT
  if (a === 127) return true
  if (a === 169 && c === 254) return true // link-local, métadonnées cloud
  if (a === 172 && c >= 16 && c <= 31) return true
  if (a === 192 && c === 0 && (d === 0 || d === 2)) return true // 192.0.0.0/24 et 192.0.2.0/24
  if (a === 192 && c === 88 && d === 99) return true
  if (a === 192 && c === 168) return true
  if (a === 198 && (c === 18 || c === 19)) return true
  if (a === 198 && c === 51 && d === 100) return true
  if (a === 203 && c === 0 && d === 113) return true
  if (a >= 224) return true // multicast, réservé, broadcast
  return false
}

/** Vrai si l'adresse n'est pas une adresse publique routable (ou n'est pas une adresse IP valide). */
export function isPrivateAddress(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '')
  if (ip.includes('%')) return true // zone IPv6 : adresse locale
  const family = isIP(ip)
  if (family === 4) {
    const bytes = parseIPv4(ip)
    return bytes === null || isPrivateIPv4(bytes)
  }
  if (family !== 6) return true
  const g = expandIPv6(ip)
  if (!g || g.length !== 8) return true
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g
  const embedded = (hi: number, lo: number): boolean => isPrivateIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255])
  // ::/96 (inclut :: et ::1) et ::ffff:0:0/96 (IPv4 mappée)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return g5 === 0 ? true : embedded(g6, g7)
  }
  // NAT64 64:ff9b::/96 (IPv4 embarquée) et 64:ff9b:1::/48 (usage local)
  if (g0 === 0x64 && g1 === 0xff9b) return g2 === 1 || embedded(g6, g7)
  // Seul 2000::/3 est de l'unicast global.
  if ((g0 & 0xe000) !== 0x2000) return true
  if (g0 === 0x2001 && g1 < 0x200) return true // 2001::/23 (Teredo, protocoles, ORCHID…)
  if (g0 === 0x2001 && g1 === 0xdb8) return true // documentation
  if (g0 === 0x2002) return embedded(g1, g2) // 6to4 : IPv4 embarquée
  if ((g0 & 0xfff0) === 0x3ff0) return true // 3fff::/20 documentation
  return false
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp', '.private'] as const

/**
 * Valide une adresse saisie (sans réseau) et renvoie l'URL. Throws UnsafeUrlError.
 * Les redirections repassent par ici : chaque saut est revérifié.
 */
export function parsePublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new UnsafeUrlError('Adresse du site invalide.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Seules les adresses http et https sont acceptées.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeUrlError('L’adresse ne doit pas contenir d’identifiants.')
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError('Seuls les ports 80 et 443 sont acceptés.')
  }
  const host = hostnameOf(url)
  if (host === '') throw new UnsafeUrlError('Adresse du site invalide.')
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError('Cette adresse n’est pas un site public.')
    return url
  }
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) || !host.includes('.')) {
    throw new UnsafeUrlError('Cette adresse n’est pas un site public.')
  }
  return url
}

/** Nom d'hôte en minuscules, sans crochets IPv6 ni point final. */
export function hostnameOf(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

export type Resolver = (hostname: string) => Promise<string[]>

export const dnsResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((r) => r.address)
}

export interface PublicAddress {
  address: string
  family: 4 | 6
}

/**
 * Résout le nom d'hôte et vérifie CHAQUE adresse obtenue (une seule privée suffit à refuser : pas de pari sur
 * celle que choisirait le client). Renvoie la première, à utiliser telle quelle pour se connecter.
 */
export async function resolvePublicAddress(url: URL, resolve: Resolver = dnsResolver): Promise<PublicAddress> {
  const host = hostnameOf(url)
  let addresses: string[]
  if (isIP(host) !== 0) {
    addresses = [host]
  } else {
    try {
      addresses = await resolve(host)
    } catch {
      throw new UnsafeUrlError('Le nom de domaine du site est introuvable.')
    }
  }
  if (addresses.length === 0) throw new UnsafeUrlError('Le nom de domaine du site est introuvable.')
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new UnsafeUrlError('Cette adresse n’est pas un site public.')
  }
  const first = addresses[0] as string
  return { address: first, family: isIP(first) === 6 ? 6 : 4 }
}
