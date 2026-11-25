import { describe, expect, it } from 'vitest'
import {
  addAffinity,
  absenceRow,
  emptyCommissionForm,
  formatPeriod,
  normalizeSkillName,
  parseCommissionForm,
  planToForm,
  previewCommission,
  rowsToSkills,
  skillNameError,
  skillsToRows,
  sortAbsences,
  suggestSkills,
  validateAbsence,
} from './profileLogic'

describe('compétences', () => {
  it('normalise le nom', () => {
    expect(normalizeSkillName('  Dev   Front ')).toBe('dev front')
  })
  it('refuse vide, trop long et doublon', () => {
    expect(skillNameError('  ', [])).not.toBeNull()
    expect(skillNameError('x'.repeat(31), [])).not.toBeNull()
    expect(skillNameError('Motion', ['motion'])).not.toBeNull()
    expect(skillNameError('motion', ['dev'])).toBeNull()
  })
  it('garde design et dev en tête, même à 0', () => {
    const rows = skillsToRows({ motion: 4, dev: 3 })
    expect(rows.map((r) => r.name)).toEqual(['design', 'dev', 'motion'])
    expect(rows.map((r) => r.level)).toEqual([0, 3, 4])
  })
  it('n’enregistre que les niveaux 1 à 5', () => {
    expect(rowsToSkills([{ name: 'design', level: 0 }, { name: 'Dev Front', level: 3 }, { name: 'motion', level: 9 }, { name: '', level: 2 }])).toEqual({ 'dev front': 3 })
  })
  it('suggère sans accents ni doublons', () => {
    expect(suggestSkills('redac', [])).toEqual(['rédaction'])
    expect(suggestSkills('dev', ['dev'])).toEqual(['dev front', 'dev back'])
  })
})

describe('affinités', () => {
  it('ajoute sans doublon (accents et casse ignorés)', () => {
    expect(addAffinity(['Identité'], ' identite ').error).not.toBeNull()
    expect(addAffinity(['Identité'], 'web').list).toEqual(['Identité', 'web'])
    expect(addAffinity([], '  ').list).toEqual([])
  })
  it('plafonne à 30', () => {
    const full = Array.from({ length: 30 }, (_, i) => `a${i}`)
    expect(addAffinity(full, 'b').error).not.toBeNull()
  })
})

describe('absences', () => {
  const ok = { start_date: '2026-12-01', end_date: '2026-12-03', kind: 'leave' as const, note: ' ' }
  it('valide les dates', () => {
    expect(validateAbsence(ok)).toBeNull()
    expect(validateAbsence({ ...ok, end_date: '2026-11-30' })).not.toBeNull()
    expect(validateAbsence({ ...ok, start_date: '' })).not.toBeNull()
  })
  it('note vide = null', () => {
    expect(absenceRow('m', ok).note).toBeNull()
  })
  it('formate et trie', () => {
    expect(formatPeriod('2026-12-01', '2026-12-01')).toBe('1 déc. 2026')
    const sorted = sortAbsences(
      [
        { start_date: '2026-01-01', end_date: '2026-01-02' },
        { start_date: '2026-12-10', end_date: '2026-12-11' },
        { start_date: '2026-12-01', end_date: '2026-12-02' },
      ],
      '2026-11-25',
    )
    expect(sorted.map((a) => a.start_date)).toEqual(['2026-12-01', '2026-12-10', '2026-01-01'])
  })
})

describe('barème de commission', () => {
  // Valeurs neutres de test uniquement.
  const form = {
    ...emptyCommissionForm(),
    tiers: [
      { upTo: '3000', rate: '12' },
      { upTo: '10000', rate: '10' },
      { upTo: '', rate: '8' },
    ],
    followupRate: '5',
  }
  it('démarre vide', () => {
    const empty = emptyCommissionForm()
    expect(empty.tiers).toEqual([{ upTo: '', rate: '' }])
    expect(parseCommissionForm(empty).ok).toBe(false)
  })
  it('convertit en centimes et ignore le plafond de la dernière tranche', () => {
    const parsed = parseCommissionForm({ ...form, tiers: [...form.tiers.slice(0, 2), { upTo: '999', rate: '8' }] })
    expect(parsed.ok && parsed.plan.tiers).toEqual([
      { up_to_cents: 300000, rate: 12 },
      { up_to_cents: 1000000, rate: 10 },
      { up_to_cents: null, rate: 8 },
    ])
  })
  it('refuse des plafonds non croissants et des fenêtres invalides', () => {
    expect(parseCommissionForm({ ...form, tiers: [{ upTo: '5000', rate: '12' }, { upTo: '4000', rate: '10' }, { upTo: '', rate: '8' }] }).ok).toBe(false)
    expect(parseCommissionForm({ ...form, signWindow: '0' }).ok).toBe(false)
    expect(parseCommissionForm({ ...form, followupRate: '' }).ok).toBe(false)
  })
  it('aperçu : 8 000 € → 860 €', () => {
    expect(previewCommission(form, '8000')).toBe(86000)
    expect(previewCommission(form, 'abc')).toBeNull()
  })
  it('aller-retour planToForm', () => {
    const parsed = parseCommissionForm(form)
    if (!parsed.ok) throw new Error('invalide')
    expect(parseCommissionForm(planToForm(parsed.plan))).toEqual(parsed)
  })
})
