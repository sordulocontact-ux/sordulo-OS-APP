/**
 * Source « déploiements » : déploiements de PRODUCTION Vercel du jeton du compte (page Connecteurs, table
 * `vercel_connections`), tous projets, compte personnel et équipes. Progression pendant la construction,
 * notification à la fin.
 *
 * - Tourne seulement connecté (session suivie comme la source « attribution » : arrêt à la déconnexion,
 *   reprise de zéro à la connexion suivante ou au changement de compte) et quand la case « Afficher les
 *   déploiements dans l'île » du menu du soleil est cochée (lue au démarrage, puis suivie ; vraie par
 *   défaut, et si la lecture échoue). Décochée : plus de sondage, activités retirées, pas de notification.
 * - Jeton : `readVercelConnection`, relu toutes les CONNECTION_CHECK_MS (il peut être ajouté, remplacé ou
 *   retiré depuis la fenêtre principale). Pas de jeton : rien. Jeton changé (valeur ou `updatedAt`) : on
 *   repart de zéro (nouvel état de référence).
 * - Sondage par les minuteurs de `ctx.clock`, jamais deux à la fois : équipes du jeton (rafraîchies toutes
 *   les TEAMS_REFRESH_MS) + compte personnel, déploiements de production de chaque portée en parallèle,
 *   dédoublonnés par id. Toutes les POLL_ACTIVE_MS tant qu'un déploiement est en cours, POLL_IDLE_MS sinon.
 *   Toutes les portées en erreur (réseau…) : l'état est gardé et on réessaie après un délai qui grandit
 *   (retryDelayMs, jusqu'à RETRY_MAX_MS). Une portée seule en erreur : les autres sont traitées.
 * - Première réponse d'une portée = état de référence : ses déploiements déjà finis ne sont pas notifiés,
 *   ceux en cours sont affichés (une équipe qui apparaît plus tard a aussi sa référence).
 * - En cours : une progression `deploy` par projet (id `prog:deploy:<projet>`, le déploiement le plus récent
 *   du projet gagne), libellé « projet · branche », anneau estimé d'après les derniers déploiements en ligne
 *   du même projet (estimateDeployMs).
 * - Fin observée (il était en cours, ou il est apparu déjà fini après la référence) : en ligne → progression
 *   retirée, « X est en ligne » avec le message du commit, Ouvrir → adresse de production (alias, sinon URL
 *   du déploiement) ; échec → « X : échec », « Voir les logs » ; annulé → progression
 *   retirée, sans notification. Jamais deux notifications pour le même déploiement.
 * - Jeton refusé (`VercelApiError.unauthorized`) : « Reconnecte Vercel » une fois, progressions retirées,
 *   plus de sondage jusqu'à un nouveau jeton (la relecture du jeton continue).
 * - Les boutons des notifications sont des actions par défaut du contrôleur (openUrl, openMain).
 */
import type { DeploymentsEnabledState } from '../../../../shared/desktop-contract'
import {
  isDeploymentActive,
  VercelApiError,
  type VercelConnection,
  type VercelDeployment,
  type VercelTeam,
} from '../../../../lib/vercel'
import { createNotification, createVercelReconnectNotification } from '../../catalog'
import type { TimerId } from '../../coordinator/clock'
import type { ProgressActivity } from '../../types'
import type { IslandSource } from '../source'
import { listen } from './listen'

/** Relecture du jeton (ajouté ou remplacé depuis la fenêtre principale). */
export const CONNECTION_CHECK_MS = 60_000
/** Rafraîchissement de la liste des équipes du jeton. */
export const TEAMS_REFRESH_MS = 10 * 60_000
/** Sondage pendant un déploiement en cours. */
export const POLL_ACTIVE_MS = 3000
/** Sondage sans déploiement en cours. */
export const POLL_IDLE_MS = 10_000
/** Premier délai après une erreur ; il double à chaque erreur suivante, jusqu'à RETRY_MAX_MS. */
export const RETRY_BASE_MS = 5000
export const RETRY_MAX_MS = 60_000
/** Anneau : durée estimée sans historique, et bornes de l'estimation. */
export const DEFAULT_DEPLOY_MS = 60_000
export const MIN_DEPLOY_MS = 15_000
export const MAX_DEPLOY_MS = 15 * 60_000
/** Nombre de déploiements en ligne récents d'un projet pris pour l'estimation. */
export const DURATION_SAMPLE = 5

/** Préfixe des ids des progressions de déploiement. */
export const DEPLOY_ACTIVITY_PREFIX = 'prog:deploy:'

/** Accès de la source (Tauri, Supabase, API Vercel), remplacés par des faux en test. */
export interface DeploymentsSourceDeps {
  /** Case « Afficher les déploiements dans l'île » du menu du soleil. */
  getDeploymentsEnabled: () => Promise<DeploymentsEnabledState>
  onDeploymentsEnabled: (handler: (state: DeploymentsEnabledState) => void) => Promise<() => void>
  /** Jeton Vercel du compte connecté, ou null. */
  readVercelConnection: () => Promise<VercelConnection | null>
  fetchVercelTeams: (token: string) => Promise<VercelTeam[]>
  /** Derniers déploiements de production d'une équipe, ou du compte personnel (null). */
  fetchProductionDeployments: (token: string, teamId: string | null) => Promise<VercelDeployment[]>
  /** Adresse de production d'un déploiement en ligne (premier alias), ou null. */
  fetchProductionUrl: (token: string, deploymentId: string, teamId: string | null) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Projet d'un déploiement : son id Vercel, sinon son nom. */
export function deployProjectKey(d: Pick<VercelDeployment, 'projectId' | 'projectName'>): string {
  return d.projectId ?? d.projectName
}

/** Id de la progression d'un projet. */
export function deployActivityId(d: Pick<VercelDeployment, 'projectId' | 'projectName'>): string {
  return `${DEPLOY_ACTIVITY_PREFIX}${deployProjectKey(d)}`
}

/** « projet · branche », ou le projet seul sans branche. */
export function deployLabel(d: Pick<VercelDeployment, 'projectName' | 'branch'>): string {
  return d.branch ? `${d.projectName} · ${d.branch}` : d.projectName
}

/** Durée d'un déploiement en ligne (début de la construction, sinon création, jusqu'à la mise en ligne) ; null sinon. */
export function deployDurationMs(
  d: Pick<VercelDeployment, 'state' | 'createdAt' | 'buildingAt' | 'readyAt'>,
): number | null {
  if (d.state !== 'READY' || d.readyAt === null) return null
  const ms = d.readyAt - (d.buildingAt ?? d.createdAt)
  return ms > 0 ? ms : null
}

/** Durée estimée : médiane des durées données, bornée entre MIN_DEPLOY_MS et MAX_DEPLOY_MS ; DEFAULT_DEPLOY_MS sans durée. */
export function estimateDeployMs(durations: readonly number[]): number {
  if (durations.length === 0) return DEFAULT_DEPLOY_MS
  const sorted = [...durations].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const at = (i: number) => sorted[i] ?? 0
  const median = sorted.length % 2 === 1 ? at(middle) : (at(middle - 1) + at(middle)) / 2
  return Math.min(MAX_DEPLOY_MS, Math.max(MIN_DEPLOY_MS, Math.round(median)))
}

/** Délai avant de réessayer après `failures` erreurs de suite (1 : RETRY_BASE_MS). */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1))
}

/** Progression affichée pour un déploiement en cours. */
export function deployActivity(d: VercelDeployment, estimatedMs: number): ProgressActivity & { id: string } {
  return {
    id: deployActivityId(d),
    kind: 'progress',
    stage: 'deploy',
    label: deployLabel(d),
    fraction: null,
    startedAt: d.buildingAt ?? d.createdAt,
    estimatedMs,
  }
}

function isUnauthorized(e: unknown): boolean {
  return e instanceof VercelApiError && e.unauthorized
}

/** Portée d'un appel : une équipe, ou le compte personnel. */
function scopeKey(teamId: string | null): string {
  return teamId ?? 'personnel'
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface Stoppable {
  stop: () => void
}

export function createDeploymentsSource(deps: DeploymentsSourceDeps): IslandSource {
  return {
    id: 'déploiements',
    start(ctx) {
      const { coordinator, clock } = ctx

      /**
       * Suivi des déploiements pour UN jeton. Tout l'état vit ici : un nouveau jeton, une déconnexion ou la
       * case décochée l'arrêtent, et le suivant repart de zéro.
       */
      function startTracker(token: string): Stoppable {
        let stopped = false
        /** Jeton refusé : plus de sondage. */
        let blocked = false
        let polling = false
        let timer: TimerId | null = null
        let failures = 0
        let teams: readonly VercelTeam[] | null = null
        let teamsAt = 0
        /** Portées dont la première réponse (état de référence) est passée. */
        const baselined = new Set<string>()
        /** Déploiements déjà vus dans une réponse. */
        const seen = new Set<string>()
        /** Déploiements dont la fin a été traitée (notifiée ou non) : jamais deux fois. */
        const finished = new Set<string>()
        /** Déploiements vus en cours à la dernière réponse de leur portée. */
        const active = new Map<string, VercelDeployment>()
        /** Projet → derniers déploiements en ligne (du plus récent au plus ancien), pour l'estimation. */
        const durations = new Map<string, { id: string; createdAt: number; ms: number }[]>()
        /** Progressions affichées : id → empreinte (déploiement, libellé, début, durée estimée). */
        const shown = new Map<string, string>()

        const alive = () => !stopped && !ctx.isDisposed()

        function clearActivities(): void {
          for (const id of shown.keys()) coordinator.removeActivity(id)
          shown.clear()
        }

        function schedule(ms: number): void {
          if (timer !== null) clock.clearTimeout(timer)
          timer = clock.setTimeout(() => {
            timer = null
            void poll()
          }, ms)
        }

        function recordDurations(deployments: Iterable<VercelDeployment>): void {
          for (const d of deployments) {
            const ms = deployDurationMs(d)
            if (ms === null) continue
            const key = deployProjectKey(d)
            const list = durations.get(key) ?? []
            if (list.some((entry) => entry.id === d.id)) continue
            list.push({ id: d.id, createdAt: d.createdAt, ms })
            list.sort((a, b) => b.createdAt - a.createdAt)
            durations.set(key, list.slice(0, DURATION_SAMPLE))
          }
        }

        function syncActivities(): void {
          const latest = new Map<string, VercelDeployment>()
          for (const d of active.values()) {
            const key = deployProjectKey(d)
            const current = latest.get(key)
            if (!current || d.createdAt > current.createdAt) latest.set(key, d)
          }
          const wanted = new Set<string>()
          for (const [key, d] of latest) {
            const activity = deployActivity(d, estimateDeployMs((durations.get(key) ?? []).map((e) => e.ms)))
            wanted.add(activity.id)
            const signature = `${d.id}|${activity.label}|${activity.startedAt}|${activity.estimatedMs}`
            const exists = coordinator.getActivity(activity.id) !== null
            if (exists && shown.get(activity.id) === signature) continue
            if (exists) {
              coordinator.updateActivity(activity.id, {
                label: activity.label,
                startedAt: activity.startedAt,
                estimatedMs: activity.estimatedMs,
              })
            } else {
              coordinator.addActivity(activity)
            }
            shown.set(activity.id, signature)
          }
          for (const id of [...shown.keys()]) {
            if (wanted.has(id)) continue
            shown.delete(id)
            coordinator.removeActivity(id)
          }
        }

        async function notifyReady(d: VercelDeployment): Promise<void> {
          let url = d.url
          try {
            url = (await deps.fetchProductionUrl(token, d.id, d.teamId)) ?? d.url
          } catch (e) {
            console.warn('[île] adresse de production Vercel :', e)
          }
          if (!alive()) return
          coordinator.notify(
            createNotification('deployed', { projectName: d.projectName, url, commitMessage: d.commitMessage }),
          )
        }

        function finish(d: VercelDeployment): void {
          if (finished.has(d.id)) return
          finished.add(d.id)
          if (d.state === 'READY') {
            void notifyReady(d)
          } else if (d.state === 'ERROR') {
            coordinator.notify(
              createNotification('deployFailed', {
                projectName: d.projectName,
                logsUrl: d.inspectorUrl ?? d.url,
                commitMessage: d.commitMessage,
                branch: d.branch,
              }),
            )
          }
          // CANCELED : la progression est déjà retirée, rien à dire.
        }

        function apply(fetched: readonly { scope: string; deployments: readonly VercelDeployment[] }[]): void {
          const byId = new Map<string, VercelDeployment>()
          /** Déploiements des portées dont c'est la première réponse : jamais notifiés. */
          const reference = new Set<string>()
          for (const { scope, deployments } of fetched) {
            const first = !baselined.has(scope)
            baselined.add(scope)
            for (const d of deployments) {
              if (byId.has(d.id)) continue
              byId.set(d.id, d)
              if (first) reference.add(d.id)
            }
          }
          recordDurations(byId.values())

          const ended: VercelDeployment[] = []
          for (const d of byId.values()) {
            const wasSeen = seen.has(d.id)
            seen.add(d.id)
            if (isDeploymentActive(d.state)) {
              if (!finished.has(d.id)) active.set(d.id, d)
              continue
            }
            const wasActive = active.delete(d.id)
            if (reference.has(d.id)) {
              finished.add(d.id)
              continue
            }
            if (wasActive || !wasSeen) ended.push(d)
          }
          // En cours, mais absent de la réponse de sa portée (supprimé, ou sorti de la liste) : retiré sans notification.
          const fetchedScopes = new Set(fetched.map((f) => f.scope))
          for (const [id, d] of active) {
            if (!byId.has(id) && fetchedScopes.has(scopeKey(d.teamId))) active.delete(id)
          }

          syncActivities()
          ended.sort((a, b) => a.createdAt - b.createdAt).forEach(finish)
        }

        /** Un sondage complet ; ne lève jamais. */
        async function pollOnce(): Promise<'ok' | 'failed' | 'unauthorized'> {
          try {
            const now = clock.now()
            if (teams === null || now - teamsAt >= TEAMS_REFRESH_MS) {
              try {
                teams = await deps.fetchVercelTeams(token)
                teamsAt = now
              } catch (e) {
                if (isUnauthorized(e)) return 'unauthorized'
                // Les équipes déjà connues restent sondées ; sans elles, le compte personnel seul cette fois.
                console.warn('[île] équipes Vercel :', e)
              }
              if (!alive()) return 'ok'
            }
            const scopes: (string | null)[] = [null, ...(teams ?? []).map((team) => team.id)]
            const results = await Promise.allSettled(
              scopes.map((teamId) => deps.fetchProductionDeployments(token, teamId)),
            )
            if (!alive()) return 'ok'
            if (results.some((r) => r.status === 'rejected' && isUnauthorized(r.reason))) return 'unauthorized'
            const fetched: { scope: string; deployments: readonly VercelDeployment[] }[] = []
            results.forEach((result, i) => {
              if (result.status === 'fulfilled') fetched.push({ scope: scopeKey(scopes[i] ?? null), deployments: result.value })
              else console.warn('[île] déploiements Vercel :', result.reason)
            })
            if (fetched.length === 0) return 'failed'
            apply(fetched)
            return 'ok'
          } catch (e) {
            console.warn('[île] déploiements Vercel :', e)
            return 'failed'
          }
        }

        function block(): void {
          blocked = true
          if (timer !== null) clock.clearTimeout(timer)
          timer = null
          active.clear()
          clearActivities()
          coordinator.notify(createVercelReconnectNotification())
        }

        async function poll(): Promise<void> {
          if (!alive() || blocked || polling) return
          polling = true
          const outcome = await pollOnce()
          polling = false
          if (!alive() || blocked) return
          if (outcome === 'unauthorized') {
            block()
            return
          }
          failures = outcome === 'failed' ? failures + 1 : 0
          schedule(failures > 0 ? retryDelayMs(failures) : active.size > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS)
        }

        void poll()

        return {
          stop() {
            stopped = true
            if (timer !== null) clock.clearTimeout(timer)
            timer = null
            active.clear()
            clearActivities()
          },
        }
      }

      /** Connexion à Sordulo OS avec la case cochée : relecture du jeton, un suivi par jeton. */
      function startRun(): Stoppable {
        let stopped = false
        let checkTimer: TimerId | null = null
        let connectionKey: string | null = null
        let tracker: Stoppable | null = null

        async function check(): Promise<void> {
          checkTimer = null
          let connection: VercelConnection | null = null
          let readable = true
          try {
            connection = await deps.readVercelConnection()
          } catch (e) {
            readable = false
            console.warn('[île] connexion Vercel :', e)
          }
          if (stopped || ctx.isDisposed()) return
          if (readable) {
            const key = connection ? `${connection.updatedAt}|${connection.token}` : null
            if (key !== connectionKey) {
              tracker?.stop()
              tracker = null
              connectionKey = key
              if (connection) tracker = startTracker(connection.token)
            }
          }
          checkTimer = clock.setTimeout(() => void check(), CONNECTION_CHECK_MS)
        }

        void check()

        return {
          stop() {
            stopped = true
            if (checkTimer !== null) clock.clearTimeout(checkTimer)
            checkTimer = null
            tracker?.stop()
            tracker = null
          },
        }
      }

      let enabled = true
      /** La case a été lue (ou sa lecture a échoué) : avant, on ne sonde pas. */
      let enabledKnown = false
      let run: Stoppable | null = null
      /** Compte pour lequel `run` tourne. */
      let runUser: string | null = null

      function refresh(): void {
        const session = ctx.session.get()
        const user = session.status === 'signedIn' ? (session.userId ?? '') : null
        const wanted = !ctx.isDisposed() && enabledKnown && enabled && user !== null
        if (run && (!wanted || runUser !== user)) {
          run.stop()
          run = null
          runUser = null
        }
        if (wanted && !run) {
          runUser = user
          run = startRun()
        }
      }

      function setEnabled(on: boolean): void {
        enabledKnown = true
        enabled = on
        refresh()
      }

      let changed = false
      const stopEnabled = listen(ctx, deps.onDeploymentsEnabled, (state) => {
        changed = true
        setEnabled(state.on)
      })
      deps
        .getDeploymentsEnabled()
        .then((state) => {
          // Un changement reçu entre-temps est plus récent que la lecture.
          if (!ctx.isDisposed() && !changed) setEnabled(state.on)
        })
        .catch((e: unknown) => {
          console.warn('[île] case des déploiements :', e)
          if (!ctx.isDisposed() && !changed) setEnabled(true)
        })
      // Connexion et déconnexion (comme la source « attribution ») : `whenSignedIn` n'appelle qu'une fois.
      const stopSession = ctx.session.subscribe(refresh)

      return {
        dispose() {
          stopEnabled()
          stopSession()
          run?.stop()
          run = null
          runUser = null
        },
      }
    },
  }
}
