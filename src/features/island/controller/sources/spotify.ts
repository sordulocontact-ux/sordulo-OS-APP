/**
 * Source « spotify » : la connexion Spotify suit le compte Sordulo OS (table `spotify_connections`, page
 * Connecteurs), pas l'ordinateur. L'île est la fenêtre qui tourne toujours : c'est elle qui donne la ligne du
 * compte à Rust et qui enregistre ce que Rust apprend de Spotify.
 *
 * - Connecté à Sordulo OS : la ligne est lue au démarrage puis toutes les CONNECTION_CHECK_MS (elle change
 *   depuis la fenêtre principale ou un autre ordinateur) et envoyée à Rust à chaque lecture
 *   (`spotifySetConnection`, null sans jeton). Rust garde ce qu'il a si c'est le même jeton. Déconnexion de
 *   Sordulo OS ou changement de compte : null envoyé, plus rien de lu.
 * - Rotation (`desktop://spotify-token` avec un jeton) : le nouveau jeton remplace l'ancien sur le compte,
 *   seulement si la ligne contient encore l'ancien ; puis la ligne est relue et renvoyée (Rust sait ainsi que
 *   c'est enregistré, ou prend le jeton d'un autre ordinateur).
 * - Refus (jeton null) : la ligne est relue. Un autre jeton y est : un autre ordinateur l'a fait tourner, il est
 *   envoyé à Rust. Le même : relu encore après REFUSAL_CONFIRM_MS (l'autre ordinateur enregistre peut-être),
 *   puis l'accès est déclaré perdu sur le compte (jeton à null, compte gardé : « À reconnecter » partout).
 * - Nom et Premium relus chez Spotify par Rust (statut) : reportés sur le compte s'ils diffèrent.
 * - Accès perdu (ligne avec un compte mais sans jeton) : « Reconnecte Spotify » ouvre la page Connecteurs, une
 *   seule fois par perte d'accès (de nouveau après une reconnexion puis une nouvelle perte).
 *
 * Les opérations passent une à une (file) : jamais deux envois à Rust qui se croisent. Jamais de jeton dans
 * les journaux.
 */
import {
  desktopConnectionOf,
  spotifyConnectionState,
  type SpotifyAccountConnection,
} from "../../../../lib/spotify";
import type {
  SpotifyConnection,
  SpotifyStatus,
  SpotifyTokenChange,
} from "../../../../shared/desktop-contract";
import { createSpotifyReconnectNotification } from "../../catalog";
import type { TimerId } from "../../coordinator/clock";
import type { IslandSource } from "../source";
import { listen } from "./listen";

/** Relecture de la ligne du compte. */
export const CONNECTION_CHECK_MS = 60_000;
/** Jeton refusé et toujours sur la ligne : seconde lecture avant de déclarer l'accès perdu. */
export const REFUSAL_CONFIRM_MS = 10_000;

export interface SpotifySourceDeps {
  /** Statut de Rust (nom et Premium relus chez Spotify). */
  onSpotify: (handler: (status: SpotifyStatus) => void) => Promise<() => void>;
  /** Rotation ou refus du jeton par Spotify. */
  onSpotifyToken: (handler: (change: SpotifyTokenChange) => void) => Promise<() => void>;
  spotifySetConnection: (connection: SpotifyConnection | null) => Promise<SpotifyStatus>;
  readSpotifyConnection: () => Promise<SpotifyAccountConnection | null>;
  replaceSpotifyRefreshToken: (previous: string, next: string | null) => Promise<boolean>;
  saveSpotifyProfile: (account: string | null, premium: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/** Nom et Premium à reporter sur le compte d'après le statut de Rust, ou null s'il n'y a rien à faire. */
export function profileToSave(
  status: SpotifyStatus,
  row: SpotifyAccountConnection | null,
): { account: string; premium: boolean } | null {
  if (!status.connected || !status.account || !row?.refreshToken) return null;
  if (status.account === row.account && status.premium === row.premium) return null;
  return { account: status.account, premium: status.premium };
}

/**
 * Jeton `previous` refusé par Spotify, d'après la ligne relue : `other` (un autre jeton est sur la ligne :
 * l'envoyer), `same` (toujours lui : accès sans doute perdu), `none` (plus de jeton sur la ligne).
 */
export function refusalOutcome(
  row: SpotifyAccountConnection | null,
  previous: string,
): "other" | "same" | "none" {
  if (!row?.refreshToken) return "none";
  return row.refreshToken === previous ? "same" : "other";
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

interface Stoppable {
  stop: () => void;
}

export function createSpotifySource(deps: SpotifySourceDeps): IslandSource {
  return {
    id: "spotify",
    start(ctx) {
      const { clock } = ctx;
      /** Accès perdu déjà signalé : pas de seconde notification avant le retour de la connexion. */
      let lostNotified = false;
      /** Une connexion a été envoyée à Rust (null à envoyer à la déconnexion de Sordulo OS). */
      let pushedConnection = false;

      function push(connection: SpotifyConnection | null): Promise<SpotifyStatus | null> {
        pushedConnection = connection !== null;
        return deps.spotifySetConnection(connection).catch((e: unknown) => {
          console.warn("[île] connexion Spotify non transmise :", e);
          return null;
        });
      }

      /** Suivi de la ligne pour un compte Sordulo OS. */
      function startRun(): Stoppable {
        let stopped = false;
        let checkTimer: TimerId | null = null;
        /** Dernière ligne lue (undefined : pas encore lue). */
        let row: SpotifyAccountConnection | null | undefined;
        /** File des opérations : une à la fois. */
        let queue: Promise<void> = Promise.resolve();

        const alive = () => !stopped && !ctx.isDisposed();

        function enqueue(task: () => Promise<void>): void {
          queue = queue
            .then(() => (alive() ? task() : undefined))
            .catch((e: unknown) => console.warn("[île] connexion Spotify :", e));
        }

        function wait(ms: number): Promise<void> {
          return new Promise((resolve) => {
            clock.setTimeout(resolve, ms);
          });
        }

        function notifyIfLost(current: SpotifyAccountConnection | null): void {
          const state = spotifyConnectionState(current);
          if (state === "connected" || state === "none") lostNotified = false;
          if (state !== "lost" || lostNotified) return;
          lostNotified = true;
          ctx.coordinator.notify(createSpotifyReconnectNotification());
        }

        /** Lit la ligne ; undefined si la lecture échoue (on garde ce qu'on a). */
        async function read(): Promise<SpotifyAccountConnection | null | undefined> {
          try {
            return await deps.readSpotifyConnection();
          } catch (e) {
            console.warn("[île] connexion Spotify illisible :", e);
            return undefined;
          }
        }

        async function syncProfile(status: SpotifyStatus | null): Promise<void> {
          const profile = status && row !== undefined ? profileToSave(status, row) : null;
          if (!profile || !row) return;
          try {
            await deps.saveSpotifyProfile(profile.account, profile.premium);
            if (alive() && row) row = { ...row, ...profile };
          } catch (e) {
            console.warn("[île] compte Spotify non mis à jour :", e);
          }
        }

        /** Relit la ligne et l'envoie à Rust. */
        async function check(): Promise<void> {
          const fresh = await read();
          if (!alive() || fresh === undefined) return;
          row = fresh;
          notifyIfLost(fresh);
          const status = await push(desktopConnectionOf(fresh));
          if (alive()) await syncProfile(status);
        }

        function scheduleCheck(): void {
          if (checkTimer !== null) clock.clearTimeout(checkTimer);
          checkTimer = clock.setTimeout(() => {
            checkTimer = null;
            enqueue(check);
            enqueue(async () => scheduleCheck());
          }, CONNECTION_CHECK_MS);
        }

        async function onRotation(previous: string, next: string): Promise<void> {
          try {
            await deps.replaceSpotifyRefreshToken(previous, next);
          } catch (e) {
            // Pas enregistré : Rust garde le nouveau jeton et le signale de nouveau à la prochaine lecture.
            console.warn("[île] nouveau jeton Spotify non enregistré :", e);
          }
          if (alive()) await check();
        }

        async function onRefusal(previous: string): Promise<void> {
          let fresh = await read();
          if (!alive() || fresh === undefined) return;
          if (refusalOutcome(fresh, previous) === "same") {
            await wait(REFUSAL_CONFIRM_MS);
            if (!alive()) return;
            fresh = await read();
            if (!alive() || fresh === undefined) return;
            if (refusalOutcome(fresh, previous) === "same") {
              console.warn("[île] Spotify refuse le jeton du compte : à reconnecter");
              try {
                await deps.replaceSpotifyRefreshToken(previous, null);
              } catch (e) {
                console.warn("[île] perte d'accès Spotify non enregistrée :", e);
              }
              if (!alive()) return;
            }
          }
          await check();
        }

        const stopToken = listen(ctx, deps.onSpotifyToken, (change) => {
          const { previousRefreshToken: previous, refreshToken: next } = change;
          enqueue(() => (next ? onRotation(previous, next) : onRefusal(previous)));
        });
        const stopStatus = listen(ctx, deps.onSpotify, (status) => {
          enqueue(() => syncProfile(status));
        });

        enqueue(check);
        enqueue(async () => scheduleCheck());

        return {
          stop() {
            stopped = true;
            stopToken();
            stopStatus();
            if (checkTimer !== null) clock.clearTimeout(checkTimer);
            checkTimer = null;
          },
        };
      }

      let run: Stoppable | null = null;
      /** Compte pour lequel `run` tourne. */
      let runUser: string | null = null;

      function refresh(): void {
        if (ctx.isDisposed()) return;
        const session = ctx.session.get();
        if (session.status === "loading") return;
        const user = session.status === "signedIn" ? (session.userId ?? "") : null;
        if (run && runUser !== user) {
          run.stop();
          run = null;
          runUser = null;
          lostNotified = false;
          // Déconnexion de Sordulo OS ou autre compte : Rust oublie la connexion du compte précédent.
          if (pushedConnection) void push(null);
        }
        if (user !== null && !run) {
          runUser = user;
          run = startRun();
        }
      }

      const stopSession = ctx.session.subscribe(refresh);
      refresh();

      return {
        dispose() {
          stopSession();
          // La fenêtre se recharge : Rust garde la connexion, la prochaine source la relira.
          run?.stop();
          run = null;
          runUser = null;
        },
      };
    },
  };
}
