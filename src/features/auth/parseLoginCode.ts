export type LoginCredential =
  | { kind: 'code'; token: string }
  | { kind: 'link'; tokenHash: string; type: LinkOtpType }

export type LinkOtpType = 'magiclink' | 'signup' | 'invite' | 'recovery' | 'email_change' | 'email'

const LINK_TYPES: readonly string[] = ['magiclink', 'signup', 'invite', 'recovery', 'email_change', 'email']

/** Interprète la saisie : code à 6-8 chiffres, ou lien de connexion contenant `token` / `token_hash`. */
export function parseLoginCode(input: string): LoginCredential | null {
  const value = input.trim()
  if (/^\d{6,8}$/.test(value)) return { kind: 'code', token: value }
  if (!/^https?:\/\//i.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const tokenHash = url.searchParams.get('token_hash') ?? url.searchParams.get('token')
  if (!tokenHash) return null
  const rawType = url.searchParams.get('type') ?? ''
  const type = (LINK_TYPES.includes(rawType) ? rawType : 'magiclink') as LinkOtpType
  return { kind: 'link', tokenHash, type }
}
