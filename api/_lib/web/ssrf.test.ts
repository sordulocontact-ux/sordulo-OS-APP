import { describe, expect, it } from 'vitest'
import { expandIPv6, isPrivateAddress, parsePublicUrl, resolvePublicAddress, UnsafeUrlError } from './ssrf.js'

describe('isPrivateAddress : IPv4', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254', // métadonnées AWS / GCP / Azure
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ])('refuse %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1',
    '172.32.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '169.253.0.1',
    '11.0.0.1',
    '223.255.255.255',
  ])('accepte %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it('refuse ce qui n’est pas une adresse', () => {
    expect(isPrivateAddress('')).toBe(true)
    expect(isPrivateAddress('example.com')).toBe(true)
    expect(isPrivateAddress('256.1.1.1')).toBe(true)
  })
})

describe('isPrivateAddress : IPv6', () => {
  it.each([
    '::',
    '::1',
    '::2',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::1',
    'fc00::1',
    'fd00:ec2::254', // métadonnées AWS en IPv6
    'fe80::1',
    'fe80::1%eth0',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '2001::1',
    '2001:db8::1',
    '2002:7f00:1::1', // 6to4 vers 127.0.0.1
    '2002:a9fe:a9fe::1',
    '3fff::1',
    '100::1',
  ])('refuse %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each([
    '2606:4700:4700::1111',
    '2a00:1450:4007:80f::200e',
    '2001:4860:4860::8888',
    '64:ff9b::808:808',
    '::ffff:8.8.8.8',
    '2002:808:808::1',
  ])('accepte %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })

  it('lit les crochets d’une adresse littérale', () => {
    expect(isPrivateAddress('[::1]')).toBe(true)
    expect(isPrivateAddress('[2606:4700:4700::1111]')).toBe(false)
  })

  it('développe les adresses abrégées', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(expandIPv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304])
    expect(expandIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(expandIPv6('1::2::3')).toBeNull()
    expect(expandIPv6('1:2:3:4:5:6:7:8:9')).toBeNull()
  })
})

describe('parsePublicUrl', () => {
  it('accepte un site public en http et https', () => {
    expect(parsePublicUrl('https://www.exemple.fr/accueil?a=1').hostname).toBe('www.exemple.fr')
    expect(parsePublicUrl('http://exemple.fr').protocol).toBe('http:')
    expect(parsePublicUrl('https://exemple.fr:443/').port).toBe('')
    expect(parsePublicUrl('http://exemple.fr:80/').hostname).toBe('exemple.fr')
    expect(parsePublicUrl('https://exemple.fr:80/').port).toBe('80')
    expect(parsePublicUrl('https://8.8.8.8/').hostname).toBe('8.8.8.8')
  })

  it.each([
    ['ftp://exemple.fr', /http et https/],
    ['file:///etc/passwd', /http et https/],
    ['gopher://exemple.fr', /http et https/],
    ['javascript:alert(1)', /http et https/],
    ['https://user:mdp@exemple.fr', /identifiants/],
    ['https://exemple.fr:8080/', /ports 80 et 443/],
    ['http://exemple.fr:22/', /ports 80 et 443/],
    ['http://localhost/', /pas un site public/],
    ['http://LOCALHOST./', /pas un site public/],
    ['http://api.localhost/', /pas un site public/],
    ['http://127.0.0.1/', /pas un site public/],
    ['http://127.1/', /pas un site public/], // forme courte : l'URL la normalise en 127.0.0.1
    ['http://2130706433/', /pas un site public/], // décimal : 127.0.0.1
    ['http://0x7f000001/', /pas un site public/], // hexadécimal
    ['http://0177.0.0.1/', /pas un site public/], // octal
    ['http://169.254.169.254/latest/meta-data/', /pas un site public/],
    ['http://[::1]/', /pas un site public/],
    ['http://[::ffff:127.0.0.1]/', /pas un site public/],
    ['http://[fd00:ec2::254]/', /pas un site public/],
    ['http://metadata.google.internal/', /pas un site public/],
    ['http://imprimante.local/', /pas un site public/],
    ['http://intranet/', /pas un site public/],
    ['http://10.1.2.3/', /pas un site public/],
    ['pas une adresse', /invalide/],
    ['', /invalide/],
  ])('refuse %s', (raw, message) => {
    expect(() => parsePublicUrl(raw)).toThrow(UnsafeUrlError)
    expect(() => parsePublicUrl(raw)).toThrow(message)
  })
})

describe('resolvePublicAddress', () => {
  const url = (raw: string) => parsePublicUrl(raw)

  it('renvoie la première adresse publique', async () => {
    const result = await resolvePublicAddress(url('https://exemple.fr'), async () => ['93.184.216.34', '2606:2800:220:1::1'])
    expect(result).toEqual({ address: '93.184.216.34', family: 4 })
    const v6 = await resolvePublicAddress(url('https://exemple.fr'), async () => ['2606:4700:4700::1111'])
    expect(v6.family).toBe(6)
  })

  it('refuse un nom qui pointe vers le réseau interne', async () => {
    await expect(resolvePublicAddress(url('https://interne.exemple.fr'), async () => ['10.0.0.5'])).rejects.toThrow(/pas un site public/)
    await expect(resolvePublicAddress(url('https://meta.exemple.fr'), async () => ['169.254.169.254'])).rejects.toThrow(
      /pas un site public/,
    )
    await expect(resolvePublicAddress(url('https://v6.exemple.fr'), async () => ['::1'])).rejects.toThrow(/pas un site public/)
  })

  it('refuse dès qu’une seule des adresses est privée', async () => {
    await expect(resolvePublicAddress(url('https://mixte.exemple.fr'), async () => ['93.184.216.34', '127.0.0.1'])).rejects.toThrow(
      /pas un site public/,
    )
  })

  it('refuse un nom introuvable ou sans adresse', async () => {
    await expect(
      resolvePublicAddress(url('https://absent.exemple.fr'), async () => {
        throw new Error('ENOTFOUND')
      }),
    ).rejects.toThrow(/introuvable/)
    await expect(resolvePublicAddress(url('https://vide.exemple.fr'), async () => [])).rejects.toThrow(/introuvable/)
  })

  it('n’appelle pas le DNS pour une adresse littérale', async () => {
    const resolver = async (): Promise<string[]> => {
      throw new Error('ne doit pas être appelé')
    }
    expect((await resolvePublicAddress(url('https://8.8.8.8'), resolver)).address).toBe('8.8.8.8')
  })
})
