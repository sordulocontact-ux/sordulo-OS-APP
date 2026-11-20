import { describe, expect, it } from 'vitest'
import {
  clientStats,
  emailError,
  findDuplicate,
  matchesProjectsFilter,
  formatSiret,
  matchesQuery,
  needsCompletion,
  normalizeName,
  normalizeWebsite,
  safeHref,
  trimOrNull,
  websiteError,
} from './clientUtils'

const base = { organization_id: 'o', archived_at: null }
const clients = [
  { ...base, id: '1', name: 'Ibé Santé', siret: '73282932000074' },
  { ...base, id: '2', name: 'Café  Noir', siret: null, archived_at: '2026-01-01T00:00:00Z' },
]

describe('normalizeName', () => {
  it('ignore casse, accents et espaces superflus', () => {
    expect(normalizeName('  CAFÉ   noir ')).toBe('cafe noir')
  })
})

describe('findDuplicate', () => {
  it('détecte le même nom sans casse ni accents, archivés compris', () => {
    expect(findDuplicate(clients, { name: 'cafe noir', siret: '' })).toEqual({ client: clients[1], reason: 'name' })
    expect(findDuplicate(clients, { name: ' IBE  santé', siret: '' })?.client.id).toBe('1')
  })
  it('détecte le même SIRET saisi avec des espaces, et le préfère au nom', () => {
    expect(findDuplicate(clients, { name: 'Café Noir', siret: '732 829 320 00074' })).toEqual({
      client: clients[0],
      reason: 'siret',
    })
  })
  it('ignore le client modifié et les noms vides', () => {
    expect(findDuplicate(clients, { name: 'Ibé Santé', siret: '' }, '1')).toBeNull()
    expect(findDuplicate(clients, { name: '  ', siret: '' })).toBeNull()
  })
  it('renvoie null sans doublon', () => {
    expect(findDuplicate(clients, { name: 'Autre', siret: '12345678901234' })).toBeNull()
  })
})

describe('formatSiret', () => {
  it('groupe 3-3-3-5', () => {
    expect(formatSiret('73282932000074')).toBe('732 829 320 00074')
  })
  it('laisse une valeur incomplète ou vide', () => {
    expect(formatSiret('123')).toBe('123')
    expect(formatSiret(null)).toBeNull()
  })
})

describe('site web', () => {
  it('ajoute https:// seulement si absent', () => {
    expect(normalizeWebsite('ibe.fr')).toBe('https://ibe.fr')
    expect(normalizeWebsite(' http://ibe.fr ')).toBe('http://ibe.fr')
    expect(normalizeWebsite('HTTPS://ibe.fr')).toBe('HTTPS://ibe.fr')
    expect(normalizeWebsite('  ')).toBeNull()
  })
  it('valide grossièrement', () => {
    expect(websiteError('ibe.fr')).toBeNull()
    expect(websiteError('')).toBeNull()
    expect(websiteError('pas un site')).not.toBeNull()
    expect(websiteError('localhost')).not.toBeNull()
  })
  it('refuse les schémas dangereux à l’affichage', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('https://ibe.fr')).toBe('https://ibe.fr')
  })
})

describe('trimOrNull et emailError', () => {
  it('trim et vide en null', () => {
    expect(trimOrNull('  a ')).toBe('a')
    expect(trimOrNull('   ')).toBeNull()
  })
  it('valide un email simple', () => {
    expect(emailError('')).toBeNull()
    expect(emailError('a@b.fr')).toBeNull()
    expect(emailError('a@b')).not.toBeNull()
  })
})

describe('matchesQuery', () => {
  const client = { name: 'Ibé Santé', billing_city: 'Lyon', siret: '73282932000074' }
  const contacts = [{ name: 'Marie Dupont', email: 'marie@ibe.fr' }]
  it('cherche sur nom, ville, contact, email et SIRET', () => {
    expect(matchesQuery(client, contacts, 'ibe')).toBe(true)
    expect(matchesQuery(client, contacts, 'lyon')).toBe(true)
    expect(matchesQuery(client, contacts, 'DUPONT')).toBe(true)
    expect(matchesQuery(client, contacts, 'marie@')).toBe(true)
    expect(matchesQuery(client, contacts, '732 829')).toBe(true)
    expect(matchesQuery(client, contacts, 'paris')).toBe(false)
    expect(matchesQuery(client, contacts, '')).toBe(true)
  })
})

describe('needsCompletion', () => {
  const full = { siret: '73282932000074', billing_street: '1 rue A', billing_postal_code: '75001', billing_city: 'Paris' }
  it('accepte une fiche complète', () => expect(needsCompletion(full)).toBe(false))
  it('signale un SIRET ou un champ d\'adresse manquant ou vide', () => {
    expect(needsCompletion({ ...full, siret: null })).toBe(true)
    expect(needsCompletion({ ...full, billing_street: null })).toBe(true)
    expect(needsCompletion({ ...full, billing_postal_code: '  ' })).toBe(true)
    expect(needsCompletion({ ...full, billing_city: null })).toBe(true)
  })
})

describe('clientStats', () => {
  const full = { siret: '73282932000074', billing_street: '1 rue A', billing_postal_code: '75001', billing_city: 'Paris', archived_at: null }
  it('ne compte que les clients non archivés', () => {
    const stats = clientStats([
      { ...full, contacts: [{ is_primary: true }], project_statuses: [{ status: 'in_progress' }, { status: 'in_progress' }] },
      { ...full, siret: null, contacts: [], project_statuses: [{ status: 'paid' }] },
      { ...full, archived_at: '2026-01-01', siret: null, contacts: [], project_statuses: [{ status: 'in_progress' }] },
    ])
    expect(stats).toEqual({ active: 2, withOngoingProject: 1, withoutPrimaryContact: 1, toComplete: 1 })
  })
})

describe('matchesProjectsFilter', () => {
  const withActive = { projects: [{ count: 2 }], project_statuses: [{ status: 'in_progress' }, { status: 'paid' }] }
  const onlyPaid = { projects: [{ count: 1 }], project_statuses: [{ status: 'paid' }] }
  const empty = { projects: [{ count: 0 }], project_statuses: [] }
  it('tous : tout passe', () => {
    expect([withActive, onlyPaid, empty].every((c) => matchesProjectsFilter(c, ''))).toBe(true)
  })
  it('en cours : au moins un projet in_progress', () => {
    expect([withActive, onlyPaid, empty].map((c) => matchesProjectsFilter(c, 'active'))).toEqual([true, false, false])
  })
  it('sans projet', () => {
    expect([withActive, onlyPaid, empty].map((c) => matchesProjectsFilter(c, 'none'))).toEqual([false, false, true])
  })
})
