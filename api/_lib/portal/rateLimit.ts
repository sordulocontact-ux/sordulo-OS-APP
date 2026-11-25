/**
 * Limitation de débit du portail client, en mémoire (best effort).
 * Chaque instance de fonction Vercel a sa propre mémoire et peut être recyclée à tout moment : ce
 * n'est pas une protection forte, seulement un frein contre un script qui martèle un lien. Le jeton
 * (256 bits d'aléa) rend de toute façon la recherche d'un lien valide impraticable.
 */

export interface RateLimiter {
  /** Compte une requête pour `key` ; false si la limite de la fenêtre est atteinte (rien n'est compté). */
  take(key: string, now?: number): boolean
  reset(): void
}

export interface RateLimitOptions {
  /** Requêtes permises par fenêtre. */
  limit: number
  windowMs: number
  /** Nombre de clés gardées au plus (les plus anciennes sont oubliées au-delà). */
  maxKeys?: number
}

/** Fenêtre glissante : horodatages des requêtes récentes par clé. */
export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>()

  function prune(since: number): void {
    for (const [key, times] of hits) {
      if (times.every((t) => t <= since)) hits.delete(key)
    }
    // Encore trop de clés : on oublie les plus anciennes (ordre d'insertion de la Map).
    for (const key of hits.keys()) {
      if (hits.size <= maxKeys) break
      hits.delete(key)
    }
  }

  return {
    take(key, now = Date.now()) {
      const since = now - windowMs
      const recent = (hits.get(key) ?? []).filter((t) => t > since)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(now)
      hits.delete(key)
      hits.set(key, recent)
      if (hits.size > maxKeys) prune(since)
      return true
    },
    reset() {
      hits.clear()
    },
  }
}

/** Adresse du client d'après les en-têtes du proxy Vercel (première adresse de x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return request.headers.get('x-real-ip')?.trim() || 'inconnue'
}
