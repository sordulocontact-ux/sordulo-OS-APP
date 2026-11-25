import { describe, expect, it } from 'vitest'
import type { Partner } from '../../shared/types'
import {
  activePartnerFilterCount,
  draftFromPartner,
  EMPTY_PARTNER_FILTERS,
  emptyPartnerDraft,
  filterPartners,
  formatRating,
  linkableProjects,
  parseOptionalMoney,
  parseSkills,
  partnerPayload,
  partnerSkills,
  partnerSubtitle,
  totalPartnerAmount,
  validatePartnerDraft,
} from './partnerLogic'

const partner = (over: Partial<Partner> = {}): Partner => ({
  id: 'p1',
  organization_id: 'o',
  name: 'Léa Martin',
  company: null,
  category: 'photographer',
  skills: [],
  day_rate_cents: null,
  email: null,
  phone: null,
  website: null,
  city: null,
  notes: null,
  rating: null,
  availability: null,
  archived_at: null,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
})

describe('parseSkills', () => {
  it('découpe, nettoie et dédoublonne sans tenir compte de la casse', () => {
    expect(parseSkills(' React, figma ;  Motion  design,react,, ')).toEqual(['React', 'figma', 'Motion design'])
    expect(parseSkills('')).toEqual([])
  })
})

describe('partnerSkills', () => {
  it('réunit les compétences du réseau, triées', () => {
    expect(partnerSkills([partner({ skills: ['Figma', 'React'] }), partner({ skills: ['react', 'Éclairage'] })])).toEqual([
      'Éclairage',
      'Figma',
      'React',
    ])
  })
})

describe('formulaire', () => {
  it('valide les champs', () => {
    const errors = validatePartnerDraft({ ...emptyPartnerDraft(), dayRate: 'abc', email: 'x', website: 'pas un site', rating: '7' })
    expect(errors.name).toBeTruthy()
    expect(errors.dayRate).toBeTruthy()
    expect(errors.email).toBeTruthy()
    expect(errors.website).toBeTruthy()
    expect(errors.rating).toBeTruthy()
    expect(errors.any).toBe(true)
    expect(validatePartnerDraft({ ...emptyPartnerDraft(), name: 'Max' }).any).toBe(false)
    expect(validatePartnerDraft({ ...emptyPartnerDraft(), name: 'Max', skills: 'x'.repeat(41) }).skills).toBeTruthy()
  })

  it('construit le payload (vide = null, site complété, tarif en centimes)', () => {
    const payload = partnerPayload({
      ...emptyPartnerDraft(),
      name: '  Max  ',
      company: ' ',
      category: 'developer',
      skills: 'Rust, rust, Tauri',
      dayRate: '450,5',
      website: 'max.dev',
      rating: '4',
    })
    expect(payload).toMatchObject({
      name: 'Max',
      company: null,
      category: 'developer',
      skills: ['Rust', 'Tauri'],
      day_rate_cents: 45050,
      website: 'https://max.dev',
      rating: 4,
      email: null,
    })
  })

  it('aller-retour partenaire → brouillon → payload', () => {
    const p = partner({ skills: ['A', 'B'], day_rate_cents: 50000, rating: 3, website: 'https://lea.photo' })
    expect(partnerPayload(draftFromPartner(p))).toMatchObject({ skills: ['A', 'B'], day_rate_cents: 50000, rating: 3, website: 'https://lea.photo' })
  })

  it('montant facultatif', () => {
    expect(parseOptionalMoney('')).toEqual({ ok: true, value: null })
    expect(parseOptionalMoney('12')).toEqual({ ok: true, value: 1200 })
    expect(parseOptionalMoney('-3').ok).toBe(false)
  })
})

describe('filterPartners', () => {
  const list = [
    partner({ id: 'a', name: 'Zoé', category: 'printer', city: 'Lyon', skills: ['Offset'] }),
    partner({ id: 'b', name: 'Alain', category: 'developer', skills: ['React'] }),
    partner({ id: 'c', name: 'Bruno', archived_at: '2026-11-02T00:00:00Z', skills: ['React'] }),
  ]

  it('masque les archivés par défaut et trie par nom', () => {
    expect(filterPartners(list, EMPTY_PARTNER_FILTERS).map((p) => p.id)).toEqual(['b', 'a'])
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, showArchived: true }).map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('filtre par métier, compétence et recherche (ville, métier, sans accents)', () => {
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, category: 'printer' }).map((p) => p.id)).toEqual(['a'])
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, skill: 'react', showArchived: true }).map((p) => p.id)).toEqual(['b', 'c'])
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, query: 'lyon' }).map((p) => p.id)).toEqual(['a'])
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, query: 'developpeur' }).map((p) => p.id)).toEqual(['b'])
    expect(filterPartners(list, { ...EMPTY_PARTNER_FILTERS, query: 'zoe' }).map((p) => p.id)).toEqual(['a'])
  })

  it('compte les filtres actifs', () => {
    expect(activePartnerFilterCount(EMPTY_PARTNER_FILTERS)).toBe(0)
    expect(activePartnerFilterCount({ query: 'x', category: 'printer', skill: 'a', showArchived: true })).toBe(3)
  })
})

describe('affichage', () => {
  it('sous-titre, évaluation, total, projets liables', () => {
    expect(partnerSubtitle({ category: 'printer', company: 'Imprim’', city: null })).toBe('Imprimeur · Imprim’')
    expect(formatRating(null)).toBeNull()
    expect(formatRating(4)).toBe('4 / 5')
    expect(totalPartnerAmount([{ amount_cents: null }])).toBeNull()
    expect(totalPartnerAmount([{ amount_cents: 100 }, { amount_cents: null }, { amount_cents: 50 }])).toBe(150)
    expect(
      linkableProjects(
        [
          { id: '1', name: 'Zèbre' },
          { id: '2', name: 'App Ibé' },
          { id: '3', name: 'Autre' },
        ],
        [{ project_id: '3' }],
      ).map((p) => p.id),
    ).toEqual(['2', '1'])
  })
})
