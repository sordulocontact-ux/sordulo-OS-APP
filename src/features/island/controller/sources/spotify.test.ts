import { describe, expect, it, vi } from "vitest";
import type { SpotifyStatus } from "../../../../shared/desktop-contract";
import { fakeEvent, flush, setupRuntime } from "../testUtils";
import { createSpotifySource } from "./spotify";

function status(fields: Partial<SpotifyStatus> = {}): SpotifyStatus {
  return {
    connected: true,
    account: "Maël",
    premium: true,
    needsReconnect: false,
    connecting: false,
    ...fields,
  };
}

function setup(initial: SpotifyStatus) {
  const event = fakeEvent<SpotifyStatus>();
  const deps = {
    spotifyStatus: vi.fn(async () => initial),
    onSpotify: event.subscribe,
  };
  const env = setupRuntime({ sources: [createSpotifySource(deps)] });
  const notification = () => env.snap().notification;
  return { ...env, event, deps, notification };
}

describe("source « spotify »", () => {
  it("connexion en bon état : aucune notification", async () => {
    const t = setup(status());
    await flush();
    expect(t.notification()).toBeNull();
  });

  it("accès déjà perdu au démarrage : « Reconnecte Spotify », bouton vers les Connecteurs", async () => {
    const t = setup(status({ needsReconnect: true }));
    await flush();
    expect(t.notification()).toMatchObject({
      title: "Reconnecte Spotify",
      button: "Ouvrir",
      action: { type: "openMain", route: "/connectors" },
    });
  });

  it("accès perdu pendant l’exécution : notification", async () => {
    const t = setup(status());
    await flush();
    t.event.emit(status({ connected: false, needsReconnect: true }));
    expect(t.notification()?.title).toBe("Reconnecte Spotify");
  });

  it("une seule fois par perte d’accès, de nouveau après une reconnexion", async () => {
    const t = setup(status({ needsReconnect: true }));
    const notify = vi.spyOn(t.coordinator, "notify");
    await flush();
    t.event.emit(status({ needsReconnect: true }));
    t.event.emit(status({ needsReconnect: true }));
    expect(notify).toHaveBeenCalledTimes(1);
    t.event.emit(status());
    t.event.emit(status({ needsReconnect: true }));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("un événement arrivé avant la lecture initiale l’emporte sur elle", async () => {
    const t = setup(status({ needsReconnect: true }));
    t.event.emit(status());
    const notify = vi.spyOn(t.coordinator, "notify");
    await flush();
    expect(notify).not.toHaveBeenCalled();
  });

  it("se désabonne à l’arrêt", async () => {
    const t = setup(status());
    await flush();
    expect(t.event.listeners).toBe(1);
    t.runtime.dispose();
    expect(t.event.listeners).toBe(0);
  });
});
