import { describe, expect, it } from 'vitest'
import { activeProjectOf, clientByEmail, normalizeDirectoryEntry, normalizeEmail } from './clientDirectory'

describe('annuaire des clients', () => {
  const raw = {
    id: 'c-1',
    name: 'Ibé',
    archived_at: null,
    client_contacts: [{ email: ' Lea@Ibe.fr ' }, { email: 'lea@ibe.fr' }, { email: null }, { email: 'pas une adresse' }],
    projects: [
      { id: 'p-old', name: 'Site Ibé', status: 'in_progress', created_at: '2026-01-01T00:00:00Z' },
      { id: 'p-new', name: 'App Ibé', status: 'in_progress', created_at: '2026-10-01T00:00:00Z' },
      { id: 'p-paid', name: 'Logo', status: 'paid', created_at: '2026-11-01T00:00:00Z' },
    ],
  }

  it('emails en minuscules, sans doublon ni valeur invalide', () => {
    expect(normalizeDirectoryEntry(raw)?.emails).toEqual(['lea@ibe.fr'])
    expect(normalizeEmail('  A@B.C ')).toBe('a@b.c')
    expect(normalizeEmail('x')).toBeNull()
  })

  it('client archivé ou ligne invalide : ignoré', () => {
    expect(normalizeDirectoryEntry({ ...raw, archived_at: '2026-11-01' })).toBeNull()
    expect(normalizeDirectoryEntry({ id: 1 })).toBeNull()
  })

  it('projet actif : le plus récent en cours', () => {
    const entry = normalizeDirectoryEntry(raw)
    expect(entry && activeProjectOf(entry)?.id).toBe('p-new')
    expect(activeProjectOf({ projects: [] })).toBeNull()
  })

  it('client par email, sans casse', () => {
    const entry = normalizeDirectoryEntry(raw)
    expect(entry && clientByEmail([entry], 'LEA@ibe.fr')?.clientId).toBe('c-1')
    expect(entry && clientByEmail([entry], 'autre@ibe.fr')).toBeNull()
  })
})
