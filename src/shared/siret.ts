/**
 * SIRET : 14 chiffres dont le dernier est une clé de Luhn.
 * Exception : les établissements de La Poste (SIREN 356000000) suivent une règle propre
 * (somme des chiffres multiple de 5). Aucune dépendance Node (partagé front / API).
 */

/** Retire espaces et points saisis pour la lisibilité (« 123 456 789 00012 »). */
export function normalizeSiret(value: string): string {
  return value.replace(/[\s.]/g, '')
}

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

export type SiretCheck = 'ok' | 'format' | 'checksum'

/** 'format' : pas 14 chiffres ; 'checksum' : clé de contrôle fausse. La valeur doit être normalisée. */
export function checkSiret(siret: string): SiretCheck {
  if (!/^\d{14}$/.test(siret)) return 'format'
  if (siret.startsWith('356000000')) {
    const sum = [...siret].reduce((acc, d) => acc + Number(d), 0)
    return sum % 5 === 0 ? 'ok' : 'checksum'
  }
  return luhnValid(siret) ? 'ok' : 'checksum'
}

/** Message d'erreur en français pour un champ SIRET, ou null s'il est vide ou valide. */
export function siretError(raw: string): string | null {
  const siret = normalizeSiret(raw)
  if (siret === '') return null
  const result = checkSiret(siret)
  if (result === 'format') return 'Le SIRET doit faire 14 chiffres.'
  if (result === 'checksum') return 'Ce SIRET n’est pas valide : vérifie les chiffres.'
  return null
}
