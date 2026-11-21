/**
 * Source « spotify » : état de la connexion Spotify (page Connecteurs, lu par Rust). Quand l'accès est perdu
 * (`needsReconnect`), une notification « Reconnecte Spotify » ouvre la page Connecteurs, une seule fois par
 * perte d'accès : elle ne revient qu'après une reconnexion réussie puis une nouvelle perte.
 * Lecture initiale (`spotifyStatus`), puis événements desktop://spotify.
 */
import type { SpotifyStatus } from "../../../../shared/desktop-contract";
import { createSpotifyReconnectNotification } from "../../catalog";
import type { IslandSource } from "../source";
import { listen } from "./listen";

export interface SpotifySourceDeps {
  spotifyStatus: () => Promise<SpotifyStatus>;
  onSpotify: (handler: (status: SpotifyStatus) => void) => Promise<() => void>;
}

export function createSpotifySource(deps: SpotifySourceDeps): IslandSource {
  return {
    id: "spotify",
    start(ctx) {
      /** Accès perdu déjà signalé : pas de seconde notification avant le retour de la connexion. */
      let lost = false;
      let changed = false;

      function apply(status: SpotifyStatus): void {
        if (!status.needsReconnect) {
          lost = false;
          return;
        }
        if (lost) return;
        lost = true;
        ctx.coordinator.notify(createSpotifyReconnectNotification());
      }

      const stop = listen(ctx, deps.onSpotify, (status) => {
        changed = true;
        apply(status);
      });
      deps
        .spotifyStatus()
        .then((status) => {
          // Un événement reçu entre-temps est plus récent que la lecture.
          if (!ctx.isDisposed() && !changed) apply(status);
        })
        .catch((e: unknown) => console.warn("[île] connexion Spotify :", e));
      return { dispose: stop };
    },
  };
}
