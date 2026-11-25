/**
 * Commission de l'apporteur d'affaires : même calcul que la base (migration 0014,
 * private.commission_tier_amount / commission_base_cents / compute_commission), qui fait foi.
 * Sert à l'aperçu (simulation d'un barème, détail d'une commission) ; aucun barème n'est écrit ici.
 *
 * Montants en centimes entiers, taux en % (0 à 100). Arrondi : les demis s'éloignent de zéro, comme
 * `round` de Postgres sur numeric.
 */
import { lineHtCents, roundHalfAwayFromZero } from './billing.js'
import type { CommissionTier, DocumentLine } from './types.js'

/**
 * Contrôle un barème : au moins une tranche, taux de 0 à 100, plafonds entiers strictement croissants (> 0),
 * la dernière tranche et elle seule sans plafond (null). Même règle que private.valid_commission_tiers.
 * Renvoie un message d'erreur en français, ou null si le barème est valide.
 */
export function validateTiers(tiers: readonly CommissionTier[]): string | null {
  if (tiers.length === 0) return 'Ajoute au moins une tranche.'
  let previous = 0
  for (const [index, tier] of tiers.entries()) {
    const n = index + 1
    if (!Number.isFinite(tier.rate) || tier.rate < 0 || tier.rate > 100) return `Tranche ${n} : le taux doit être compris entre 0 et 100 %.`
    const last = index === tiers.length - 1
    if (last) {
      if (tier.up_to_cents !== null) return 'La dernière tranche ne doit pas avoir de plafond.'
    } else {
      if (tier.up_to_cents === null) return `Tranche ${n} : seule la dernière tranche peut être sans plafond.`
      if (!Number.isInteger(tier.up_to_cents) || tier.up_to_cents <= previous) {
        return `Tranche ${n} : le plafond doit être supérieur à celui de la tranche précédente.`
      }
      previous = tier.up_to_cents
    }
  }
  return null
}

/**
 * Barème par tranches appliqué à un montant cumulé : chaque tranche prend son taux sur la part du montant qui
 * tombe entre le plafond précédent et le sien. Résultat arrondi au centime. Montant <= 0 → 0.
 * Ex. 12 % jusqu'à 3 000 €, 10 % jusqu'à 10 000 €, 8 % au-delà : 8 000 € → 360 + 500 = 860 €.
 */
export function tieredAmountCents(tiers: readonly CommissionTier[], cents: number): number {
  if (!(cents > 0)) return 0
  let previous = 0
  let total = 0
  for (const tier of tiers) {
    if (tier.up_to_cents === null || cents <= tier.up_to_cents) {
      total += ((cents - previous) * tier.rate) / 100
      return roundHalfAwayFromZero(total)
    }
    total += ((tier.up_to_cents - previous) * tier.rate) / 100
    previous = tier.up_to_cents
  }
  return roundHalfAwayFromZero(total)
}

/**
 * Commission d'un encaissement du premier devis : barème CUMULATIF sur tout l'encaissé de ce devis.
 * montant = barème(cumul avant + base) − barème(cumul avant). Base négative pour un avoir.
 * Un acompte puis le solde donnent donc le même total qu'un paiement unique.
 */
export function marginalCommissionCents(tiers: readonly CommissionTier[], cumulBeforeCents: number, baseCents: number): number {
  return tieredAmountCents(tiers, cumulBeforeCents + baseCents) - tieredAmountCents(tiers, cumulBeforeCents)
}

/** Commission d'un encaissement d'un devis suivant : taux fixe (%) sur la base, arrondi au centime. */
export function followupCommissionCents(followupRate: number, baseCents: number): number {
  return roundHalfAwayFromZero((baseCents * followupRate) / 100)
}

/** Base de commission d'une facture : HT des lignes (même arrondi que les totaux), sans les frais refacturés. */
export function commissionBaseCents(lines: readonly Pick<DocumentLine, 'quantity' | 'unit_price_cents' | 'rebilled'>[]): number {
  return lines.reduce((sum, line) => (line.rebilled === true ? sum : sum + lineHtCents(line)), 0)
}

/**
 * Détail des commissions d'une suite d'encaissements du premier devis (acompte, solde, avoir…), dans l'ordre :
 * chaque montant est marginal sur le cumul précédent. La somme vaut barème(somme des bases).
 */
export function cumulativeCommissions(tiers: readonly CommissionTier[], basesCents: readonly number[]): number[] {
  let cumul = 0
  return basesCents.map((base) => {
    const amount = marginalCommissionCents(tiers, cumul, base)
    cumul += base
    return amount
  })
}
