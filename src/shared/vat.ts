/**
 * Numéro de TVA intracommunautaire français et mise en forme des identifiants pour l'affichage.
 * Aucune dépendance Node (partagé front / API).
 */
import { checkSiret, normalizeSiret } from './siret.js'

function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

/**
 * « FR » + clé sur 2 chiffres + SIREN, clé = (12 + 3 × (SIREN mod 97)) mod 97.
 * Accepte un SIRET (14 chiffres, clé de contrôle vérifiée) ou un SIREN (9 chiffres, Luhn), avec ou sans
 * espaces. Renvoie null si l'identifiant n'est pas valide.
 */
export function frenchVatNumber(siretOrSiren: string | null | undefined): string | null {
  if (!siretOrSiren) return null
  const digits = normalizeSiret(siretOrSiren)
  let siren: string
  if (/^\d{14}$/.test(digits)) {
    if (checkSiret(digits) !== 'ok') return null
    siren = digits.slice(0, 9)
  } else if (/^\d{9}$/.test(digits)) {
    if (!luhnValid(digits)) return null
    siren = digits
  } else {
    return null
  }
  const key = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(key).padStart(2, '0')}${siren}`
}

/** « 732 829 320 00074 » : SIREN groupé par 3, puis les 5 chiffres de l'établissement. Autre valeur : renvoyée telle quelle. */
export function formatSiret(value: string): string {
  const digits = normalizeSiret(value)
  if (/^\d{14}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  if (/^\d{9}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  return value.trim()
}

/** « FR76 3000 6000 … » : majuscules, groupes de 4 caractères. */
export function formatIban(value: string): string {
  return value
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1 ')
}

/** Raison sociale suivie de la forme juridique, sans doublon : « Sordulo SAS » + « SAS » reste « Sordulo SAS ». */
export function sellerDisplayName(
  seller: { name: string; legal_name: string | null; legal_form: string | null },
): string {
  const base = seller.legal_name?.trim() || seller.name
  const form = seller.legal_form?.trim()
  if (!form) return base
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const already = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(base)
  return already ? base : `${base}, ${form}`
}
