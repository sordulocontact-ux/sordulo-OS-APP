import { describe, expect, it, vi } from "vitest";
import type { SpotifyAccountConnection } from "../../../../lib/spotify";
import type {
  SpotifyConnection,
  SpotifyStatus,
  SpotifyTokenChange,
} from "../../../../shared/desktop-contract";
import { SIGNED_OUT } from "../source";
import { SIGNED_IN, fakeEvent, flush, setupRuntime } from "../testUtils";
import {
  CONNECTION_CHECK_MS,
  REFUSAL_CONFIRM_MS,
  createSpotifySource,
  profileToSave,
  refusalOutcome,
  type SpotifySourceDeps,
} from "./spotify";

const CLIENT = "0123456789abcdef0123456789abcdef";

function row(fields: Partial<SpotifyAccountConnection> = {}): SpotifyAccountConnection {
  return {
    clientId: CLIENT,
    refreshToken: "rt-1",
    account: "Maël",
    premium: true,
    updatedAt: "2026-11-24T10:00:00Z",
    ...fields,
  };
}

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

function setup(options: { row?: SpotifyAccountConnection | null; signedIn?: boolean } = {}) {
  const statusEvent = fakeEvent<SpotifyStatus>();
  const tokenEvent = fakeEvent<SpotifyTokenChange>();
  let current: SpotifyAccountConnection | null | Error = options.row === undefined ? row() : options.row;
  let rustStatus = status();
  const deps = {
    onSpotify: statusEvent.subscribe,
    onSpotifyToken: tokenEvent.subscribe,
    spotifySetConnection: vi.fn(async (_c: SpotifyConnection | null) => rustStatus),
    readSpotifyConnection: vi.fn(async () => {
      if (current instanceof Error) throw current;
      return current;
    }),
    replaceSpotifyRefreshToken: vi.fn(async (previous: string, next: string | null) => {
      if (current instanceof Error || current?.refreshToken !== previous) return false;
      current = { ...current, refreshToken: next };
      return true;
    }),
    saveSpotifyProfile: vi.fn(async (account: string | null, premium: boolean) => {
      if (current && !(current instanceof Error)) current = { ...current, account, premium };
    }),
  } satisfies SpotifySourceDeps;
  const env = setupRuntime({ sources: [createSpotifySource(deps)], signedIn: options.signedIn });
  const notify = vi.spyOn(env.coordinator, "notify");
  return {
    ...env,
    deps,
    statusEvent,
    tokenEvent,
    notify,
    pushed: () => deps.spotifySetConnection.mock.calls.map(([c]) => c),
    lastPushed: () => deps.spotifySetConnection.mock.calls.at(-1)?.[0],
    setRow(next: SpotifyAccountConnection | null | Error) {
      current = next;
    },
    setRustStatus(next: SpotifyStatus) {
      rustStatus = next;
    },
    async tick(ms: number) {
      env.clock.advance(ms);
      await flush();
    },
  };
}

describe("spotify : fonctions pures", () => {
  it("profil à reporter seulement s’il diffère et avec un compte connecté", () => {
    expect(profileToSave(status(), row())).toBeNull();
    expect(profileToSave(status({ premium: false }), row())).toEqual({ account: "Maël", premium: false });
    expect(profileToSave(status({ account: "Autre" }), row())).toEqual({ account: "Autre", premium: true });
    expect(profileToSave(status({ connected: false, premium: false }), row())).toBeNull();
    expect(profileToSave(status({ account: null, premium: false }), row())).toBeNull();
    expect(profileToSave(status({ premium: false }), row({ refreshToken: null }))).toBeNull();
    expect(profileToSave(status({ premium: false }), null)).toBeNull();
  });

  it("refus : autre jeton, même jeton ou plus de jeton sur la ligne", () => {
    expect(refusalOutcome(row({ refreshToken: "rt-2" }), "rt-1")).toBe("other");
    expect(refusalOutcome(row(), "rt-1")).toBe("same");
    expect(refusalOutcome(row({ refreshToken: null }), "rt-1")).toBe("none");
    expect(refusalOutcome(null, "rt-1")).toBe("none");
  });
});

describe("source « spotify »", () => {
  it("connecté : lit la ligne et l’envoie à Rust, puis la relit régulièrement", async () => {
    const t = setup();
    await flush();
    expect(t.pushed()).toEqual([{ clientId: CLIENT, refreshToken: "rt-1", account: "Maël", premium: true }]);
    t.setRow(row({ refreshToken: "rt-autre-ordi" }));
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-autre-ordi" });
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.deps.readSpotifyConnection).toHaveBeenCalledTimes(3);
  });

  it("sans jeton ou sans ligne : null envoyé", async () => {
    const t = setup({ row: row({ refreshToken: null, account: null }) });
    await flush();
    expect(t.pushed()).toEqual([null]);
    t.setRow(null);
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.pushed()).toEqual([null, null]);
    expect(t.notify).not.toHaveBeenCalled();
  });

  it("lecture en échec : rien envoyé, nouvel essai plus tard", async () => {
    const t = setup({ row: new Error("réseau") as never });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await flush();
    expect(t.pushed()).toEqual([]);
    t.setRow(row());
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.pushed()).toHaveLength(1);
    warn.mockRestore();
  });

  it("hors connexion à Sordulo OS : rien lu ; déconnexion : null envoyé, plus de lecture", async () => {
    const out = setup({ signedIn: false });
    await flush();
    expect(out.deps.readSpotifyConnection).not.toHaveBeenCalled();

    const t = setup();
    await flush();
    t.session.set(SIGNED_OUT);
    await flush();
    expect(t.lastPushed()).toBeNull();
    await t.tick(CONNECTION_CHECK_MS * 2);
    expect(t.deps.readSpotifyConnection).toHaveBeenCalledTimes(1);
    // Reconnexion : la ligne est relue et renvoyée.
    t.session.set({ ...SIGNED_IN });
    await flush();
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-1" });
  });

  it("rotation : le nouveau jeton remplace l’ancien sur le compte, puis la ligne est renvoyée", async () => {
    const t = setup();
    await flush();
    t.tokenEvent.emit({ previousRefreshToken: "rt-1", refreshToken: "rt-2" });
    await flush();
    expect(t.deps.replaceSpotifyRefreshToken).toHaveBeenCalledWith("rt-1", "rt-2");
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-2" });
  });

  it("rotation déjà faite par un autre ordinateur : la ligne relue est envoyée telle quelle", async () => {
    const t = setup();
    await flush();
    t.setRow(row({ refreshToken: "rt-autre" }));
    t.tokenEvent.emit({ previousRefreshToken: "rt-1", refreshToken: "rt-2" });
    await flush();
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-autre" });
  });

  it("refus, un autre ordinateur a fait tourner le jeton : on prend le sien, pas de perte", async () => {
    const t = setup();
    await flush();
    t.setRow(row({ refreshToken: "rt-autre" }));
    t.tokenEvent.emit({ previousRefreshToken: "rt-1", refreshToken: null });
    await flush();
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-autre" });
    expect(t.deps.replaceSpotifyRefreshToken).not.toHaveBeenCalled();
    expect(t.notify).not.toHaveBeenCalled();
  });

  it("refus, l’autre ordinateur enregistre pendant l’attente : pas de perte", async () => {
    const t = setup();
    await flush();
    t.tokenEvent.emit({ previousRefreshToken: "rt-1", refreshToken: null });
    await flush();
    t.setRow(row({ refreshToken: "rt-autre" }));
    await t.tick(REFUSAL_CONFIRM_MS);
    expect(t.lastPushed()).toMatchObject({ refreshToken: "rt-autre" });
    expect(t.deps.replaceSpotifyRefreshToken).not.toHaveBeenCalled();
  });

  it("refus confirmé : accès perdu sur le compte, null envoyé, « Reconnecte Spotify » une fois", async () => {
    const t = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await flush();
    t.tokenEvent.emit({ previousRefreshToken: "rt-1", refreshToken: null });
    await flush();
    expect(t.deps.replaceSpotifyRefreshToken).not.toHaveBeenCalled();
    await t.tick(REFUSAL_CONFIRM_MS);
    expect(t.deps.replaceSpotifyRefreshToken).toHaveBeenCalledWith("rt-1", null);
    expect(t.lastPushed()).toBeNull();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({
      title: "Reconnecte Spotify",
      action: { type: "openMain", route: "/connectors" },
    });
    // Relectures suivantes : pas de nouvelle notification.
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.notify).toHaveBeenCalledTimes(1);
    // Reconnecté puis perdu de nouveau : nouvelle notification.
    t.setRow(row({ refreshToken: "rt-9" }));
    await t.tick(CONNECTION_CHECK_MS);
    t.setRow(row({ refreshToken: null }));
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.notify).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("accès déjà perdu au démarrage : notification ; Client ID seul : rien", async () => {
    const lost = setup({ row: row({ refreshToken: null }) });
    await flush();
    expect(lost.notify).toHaveBeenCalledTimes(1);
    const fresh = setup({ row: row({ refreshToken: null, account: null }) });
    await flush();
    expect(fresh.notify).not.toHaveBeenCalled();
  });

  it("nom et Premium relus par Rust : reportés sur le compte", async () => {
    const t = setup();
    t.setRustStatus(status({ premium: false }));
    await flush();
    expect(t.deps.saveSpotifyProfile).toHaveBeenCalledWith("Maël", false);
    t.statusEvent.emit(status({ account: "Maël A.", premium: false }));
    await flush();
    expect(t.deps.saveSpotifyProfile).toHaveBeenLastCalledWith("Maël A.", false);
    t.statusEvent.emit(status({ account: "Maël A.", premium: false }));
    await flush();
    expect(t.deps.saveSpotifyProfile).toHaveBeenCalledTimes(2);
  });

  it("se désabonne à l’arrêt sans retirer la connexion de Rust", async () => {
    const t = setup();
    await flush();
    expect(t.tokenEvent.listeners).toBe(1);
    expect(t.statusEvent.listeners).toBe(1);
    t.runtime.dispose();
    expect(t.tokenEvent.listeners).toBe(0);
    expect(t.statusEvent.listeners).toBe(0);
    expect(t.pushed()).toHaveLength(1);
    await t.tick(CONNECTION_CHECK_MS);
    expect(t.deps.readSpotifyConnection).toHaveBeenCalledTimes(1);
  });
});
