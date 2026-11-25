/**
 * Pilote du labo : un vrai IslandCoordinator (horloge système) plus ce que fera le contrôleur de l'app, simulé :
 * sessions, appel détecté, glisser-déposer, fin des progressions, décisions des boutons. Pas de React ici :
 * le composant lit `getSnapshot()` avec useSyncExternalStore.
 */
import type { CallService } from "../../../shared/desktop-contract";
import { callBrand } from "../brands";
import { createSpotifyReconnectNotification } from "../catalog";
import { claudeActivityFor } from "../claude";
import { IslandCoordinator, systemClock, type TimerId } from "../coordinator";
import type {
  Activity,
  ClaudeActivity,
  ClaudeSession,
  IslandMusic,
  IslandNotification,
  IslandSnapshot,
  MusicCommand,
  PermissionDecision,
  ProgressStage,
} from "../types";
import type { IslandCallPrompt, IslandDropInfo, IslandDropZone } from "../view";
import { musicPosition } from "../view/music";
import { ACTIVITY_NAMES } from "../view/tone";
import {
  LAB_CALL_APP,
  LAB_PROJECTS,
  LAB_REMOTE_APP,
  LAB_TRACKS,
  MAX_LAB_SESSIONS,
  labArtwork,
  makeAsk,
  makeDrop,
  makeSessions,
  sampleNotification,
  type DropFile,
  type DropOptions,
} from "./fixtures";
import type { ChoiceDecision, IslandChoice, NotificationKind } from "../types";
import {
  islandViewOf,
  proposalAppliedNotification,
  proposalUndoneNotification,
} from "../appNotifications/logic";
import {
  FILING_PROGRESS_ID,
  FILING_PROGRESS_STAGE,
  autoFiledNotification,
  batchRoute,
  estimateFilingMs,
  filedManyNotification,
  filedNotification,
  filingErrorNotification,
  filingItemsOf,
  filingProgressLabel,
  intakeRoute,
  planBatch,
  readyChoice,
  readyManyChoice,
  reviewNotification,
  setAsideNotification,
  undoneNotification,
  type FilingItem,
} from "../drop/filing";
import {
  SAMPLE_APP_NOTIFICATIONS,
  SAMPLE_BATCH_ID,
  SAMPLE_NAMES,
  sampleBatchItems,
  sampleFiledFile,
  type SampleFilingCase,
} from "../drop/filingFixtures";

/** Classement simulé d'un fichier dans le labo (ms). */
const LAB_FILING_MS_PER_FILE = 1100;

/** Décision simulée : ce que le labo fait des boutons. */
type LabChoice =
  | { kind: "filingOne"; item: FilingItem }
  | { kind: "filingMany"; items: readonly FilingItem[] }
  | { kind: "proposal"; proposalId: string; title: string };

export interface LabView {
  snapshot: IslandSnapshot;
  sessions: readonly ClaudeSession[];
  call: IslandCallPrompt | null;
  drop: IslandDropInfo | null;
  hotZone: IslandDropZone | null;
  /** Musique simulée (pochette, couleurs, position) ; null : pas de musique. */
  music: IslandMusic | null;
  /** Survol forcé ou réel : ce que reçoit l'île. */
  hover: boolean;
  focusMode: boolean;
  /** Dernières réactions aux boutons de l'île, la plus récente en premier. */
  log: readonly string[];
}

type ProgressChainStage = Extract<
  ProgressStage,
  "upload" | "analyse" | "deploy"
>;

/** Durées simulées (prototype : PROGS, et 9 s pour l'analyse en coordination). */
const PROGRESS: Record<
  ProgressChainStage,
  { label: string; detail?: string; meta?: string; durationMs: number }
> = {
  upload: { label: "Import de l’audio", durationMs: 3200 },
  analyse: { label: "Analyse de l’appel", durationMs: 9000 },
  // Comme la source « déploiements » : dépôt, message du commit, branche (vue ouverte au survol).
  deploy: {
    label: "sordulo-OS-APP",
    detail: "feat(ile): plus d'aperçu de la place pendant le glisser",
    meta: "main",
    durationMs: 5200,
  },
};

/** Délai entre la fin d'une progression et ce qui la suit (prototype : 350 ms). */
const PROGRESS_END_DELAY_MS = 350;
/** Un clic automatique du prototype part 180 ms après (animation d'appui). */
const AUTO_PRESS_DELAY_MS = 180;
const LOG_LIMIT = 6;
/** Passage agent → multi du prototype (scnMulti : 1,3 s). */
const GARDEN_FROM_ICON_MS = 1300;
/** Durée d'un conflit simulé (la dispute dure 6,2 s). */
const GARDEN_CONFLICT_MS = 8000;
/** Position de départ d'un morceau simulé (ms) : la barre de progression est déjà entamée. */
const MUSIC_START_MS = 42_000;

export class LabRuntime {
  private coordinator: IslandCoordinator;
  private unsubscribe: (() => void) | null = null;
  private readonly timers = new Set<TimerId>();
  private readonly listeners = new Set<() => void>();
  private sessions: ClaudeSession[] = [];
  private call: IslandCallPrompt | null = null;
  private drop: IslandDropInfo | null = null;
  private dropFile: DropFile | null = null;
  private dropOptions: DropOptions = { files: true, claude: true };
  private hotZone: IslandDropZone | null = null;
  private focusMode = false;
  /** Service d'appel simulé (logo et couleur) ; null : inconnu. */
  private callService: CallService | null = "meet";
  private music: IslandMusic | null = null;
  private trackIndex = 0;
  private musicArtwork = true;
  private musicProgress = true;
  /** Spotify sur un autre appareil sans Premium : nom de l'appareil, pas de boutons. */
  private musicRemote = false;
  /** Fin du morceau simulé en lecture : on passe au suivant. */
  private trackEnd: TimerId | null = null;
  private forcedHover = false;
  private realHover = false;
  private log: string[] = [];
  private view: LabView;
  /** Décisions du labo affichées ou mises de côté, par id. */
  private readonly choices = new Map<string, LabChoice>();

  constructor() {
    this.coordinator = new IslandCoordinator({
      clock: systemClock,
      focusMode: this.focusMode,
    });
    this.view = this.buildView();
  }

  // --- Cycle de vie et lecture -------------------------------------------------------------------------------

  /** À appeler au montage (relancé après un démontage, StrictMode compris). */
  start = (): void => {
    if (this.unsubscribe) return;
    this.unsubscribe = this.coordinator.subscribe(this.emit);
    this.emit();
  };

  stop = (): void => {
    this.clearTimers();
    this.clearTrackEnd();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.coordinator.dispose();
    // Un coordinateur neuf attend le prochain `start`.
    this.coordinator = new IslandCoordinator({
      clock: systemClock,
      focusMode: this.focusMode,
    });
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LabView => this.view;

  private buildView(): LabView {
    return {
      snapshot: this.coordinator.getSnapshot(),
      sessions: this.sessions,
      call: this.call,
      drop: this.drop,
      hotZone: this.hotZone,
      music: this.music,
      hover: this.forcedHover || this.realHover,
      focusMode: this.focusMode,
      log: this.log,
    };
  }

  private emit = (): void => {
    this.view = this.buildView();
    this.listeners.forEach((l) => l());
  };

  private remember(text: string): void {
    this.log = [text, ...this.log].slice(0, LOG_LIMIT);
  }

  // --- Minuteurs du labo -------------------------------------------------------------------------------------

  private later(ms: number, fn: () => void): void {
    const id = systemClock.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    this.timers.forEach((id) => systemClock.clearTimeout(id));
    this.timers.clear();
  }

  // --- Réglages ----------------------------------------------------------------------------------------------

  setFocusMode(on: boolean): void {
    this.focusMode = on;
    this.coordinator.setFocusMode(on);
    this.emit();
  }

  setForcedHover(on: boolean): void {
    this.forcedHover = on;
    this.coordinator.setHover(on || this.realHover);
    this.emit();
  }

  setRealHover = (on: boolean): void => {
    this.realHover = on;
    this.coordinator.setHover(on || this.forcedHover);
    this.emit();
  };

  setHotZone(zone: IslandDropZone | null): void {
    this.hotZone = zone;
    this.emit();
  }

  setDropOptions(options: DropOptions): void {
    this.dropOptions = options;
    if (this.dropFile) this.drop = makeDrop(this.dropFile, options);
    this.emit();
  }

  // --- États -------------------------------------------------------------------------------------------------

  /** Efface tout : activités, notifications, sessions, files d'attente (le mode concentration et le survol restent). */
  reset(): void {
    this.clearTimers();
    this.unsubscribe?.();
    this.coordinator.dispose();
    this.coordinator = new IslandCoordinator({
      clock: systemClock,
      focusMode: this.focusMode,
    });
    this.coordinator.setHover(this.forcedHover || this.realHover);
    this.unsubscribe = this.coordinator.subscribe(this.emit);
    this.sessions = [];
    this.call = null;
    this.drop = null;
    this.dropFile = null;
    this.hotZone = null;
    this.clearTrackEnd();
    this.music = null;
    this.musicRemote = false;
    this.choices.clear();
    this.emit();
  }

  /** Nom de l'app d'appel simulée : le libellé du service, ou celui par défaut du labo. */
  private callAppName(): string {
    return this.callService ? callBrand(this.callService).label : LAB_CALL_APP;
  }

  /** Choisit le service simulé (logo et couleur) et met à jour l'appel affiché, détecté ou en cours. */
  setCallService = (service: CallService | null): void => {
    this.callService = service;
    if (this.call)
      this.call = { ...this.call, appName: this.callAppName(), service };
    this.coordinator.updateActivity("meet", {
      appName: this.callAppName(),
      service,
    });
    this.emit();
  };

  detectCall(): void {
    this.call = {
      appName: this.callAppName(),
      service: this.callService,
      projects: LAB_PROJECTS,
      selectedProjectId: LAB_PROJECTS[0]?.id ?? null,
    };
    this.coordinator.showOverlay("appel");
    this.emit();
  }

  startMeet(): void {
    const project = LAB_PROJECTS[0];
    this.coordinator.addActivity({
      id: "meet",
      kind: "meet",
      appName: this.callAppName(),
      service: this.callService,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      startedAt: systemClock.now(),
    });
  }

  addMusic(): void {
    this.setTrack(this.trackIndex, MUSIC_START_MS, true);
    this.coordinator.addActivity({ id: "music", kind: "music" });
  }

  /**
   * Une session Claude travaille, puis la musique démarre : une seule île, la musique en haut et le Claude qui
   * part de son icône pour marcher en bas en hochant la tête (pas de bulle). Second appui : plusieurs sessions.
   */
  musicWithClaude(count: number): void {
    const several =
      this.coordinator.getActivity("agent") !== null &&
      this.coordinator.getActivity("music") !== null;
    this.reset();
    if (several) {
      this.setSessions(Math.max(2, count));
      this.coordinator.addActivity({ id: "multi", kind: "multi" });
      this.addMusic();
      return;
    }
    this.addAgent();
    this.later(GARDEN_FROM_ICON_MS, () => this.addMusic());
  }

  /**
   * Musique avec `count` sessions Claude (une attend si `waiting`) : sous la musique ouverte, une ligne par
   * session ; au-delà de 3, « N autres activités », qui déplie la liste.
   */
  musicWithSessions(count: number, waiting: boolean): void {
    this.reset();
    this.setSessions(count, waiting);
    this.coordinator.addActivity({ id: "multi", kind: "multi" });
    this.addMusic();
  }

  /**
   * Appel en cours avec `count` sessions Claude, la musique et un déploiement : sous l'appel ouvert, plus de
   * lignes que la liste dépliée n'en montre (elle défile).
   */
  meetWithActivities(count: number, waiting: boolean): void {
    this.reset();
    this.startMeet();
    this.setSessions(count, waiting);
    this.coordinator.addActivity({ id: "multi", kind: "multi" });
    this.addMusic();
    this.runProgress("deploy", false);
  }

  // --- Musique simulée (ce que fera la source « musique » du contrôleur) ---------------------------------------

  private clearTrackEnd(): void {
    if (this.trackEnd !== null) systemClock.clearTimeout(this.trackEnd);
    this.trackEnd = null;
  }

  /** Morceau `index` à la position donnée ; en lecture, le suivant part à la fin. */
  private setTrack(index: number, positionMs: number, playing: boolean): void {
    const count = LAB_TRACKS.length;
    this.trackIndex = ((index % count) + count) % count;
    const track = LAB_TRACKS[this.trackIndex];
    if (!track) return;
    this.music = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      appName: this.musicRemote ? LAB_REMOTE_APP : track.appName,
      playing,
      positionMs: this.musicProgress ? positionMs : null,
      durationMs: this.musicProgress ? track.durationMs : null,
      positionAt: systemClock.now(),
      artworkUrl: this.musicArtwork ? labArtwork(track) : null,
      palette: this.musicArtwork ? track.palette : null,
      canControl: !this.musicRemote,
    };
    this.clearTrackEnd();
    if (playing) {
      this.trackEnd = systemClock.setTimeout(
        () => {
          this.trackEnd = null;
          this.changeTrack(1);
        },
        Math.max(0, track.durationMs - positionMs),
      );
    }
  }

  private currentPosition(): number {
    return this.music
      ? (musicPosition(this.music, systemClock.now()) ?? MUSIC_START_MS)
      : MUSIC_START_MS;
  }

  /** Pause ou reprise, à la position atteinte. */
  toggleMusicPause(): void {
    if (!this.music) return;
    this.setTrack(this.trackIndex, this.currentPosition(), !this.music.playing);
    this.emit();
  }

  /** Morceau suivant ou précédent (autre pochette, autres couleurs). Précédent après 3 s : retour au début. */
  changeTrack(delta: 1 | -1): void {
    if (!this.music) return;
    const restart = delta < 0 && this.currentPosition() > 3000;
    this.setTrack(
      restart ? this.trackIndex : this.trackIndex + delta,
      0,
      this.music.playing,
    );
    this.emit();
  }

  /** Avec ou sans pochette (sans : dégradé des tokens, pas de couleurs). */
  setMusicArtwork(on: boolean): void {
    this.musicArtwork = on;
    if (this.music)
      this.setTrack(
        this.trackIndex,
        this.currentPosition(),
        this.music.playing,
      );
    this.emit();
  }

  /** Lecteur qui donne (ou non) la position et la durée. */
  setMusicProgress(on: boolean): void {
    this.musicProgress = on;
    if (this.music)
      this.setTrack(
        this.trackIndex,
        this.currentPosition(),
        this.music.playing,
      );
    this.emit();
  }

  /** Spotify sur le téléphone, sans Premium : « Spotify sur iPhone de Maël », boutons masqués. */
  musicOnPhone(): void {
    this.musicRemote = true;
    this.addMusic();
    this.remember("Musique : Spotify sur le téléphone (sans Premium)");
  }

  /** Retour au lecteur de l'ordinateur (boutons du lecteur de nouveau là). */
  musicOnComputer(): void {
    this.musicRemote = false;
    if (this.music)
      this.setTrack(
        this.trackIndex,
        this.currentPosition(),
        this.music.playing,
      );
    this.emit();
  }

  /** Accès Spotify perdu : notification « Reconnecte Spotify » (page Connecteurs). */
  spotifyReconnect(): void {
    this.coordinator.notify(createSpotifyReconnectNotification());
  }

  /** Boutons du lecteur dans l'île. */
  musicCommand = (command: MusicCommand): void => {
    if (command === "playPause") this.toggleMusicPause();
    else if (command === "next") this.changeTrack(1);
    else if (command === "previous") this.changeTrack(-1);
    this.remember(
      {
        playPause: this.music?.playing
          ? "Lecteur : reprise"
          : "Lecteur : pause",
        next: "Lecteur : morceau suivant",
        previous: "Lecteur : morceau précédent",
        open: `Lecteur : ouvrir ${this.music?.appName ?? "le lecteur"}`,
      }[command],
    );
    this.emit();
  };

  setSessions(count: number, waiting = false): void {
    this.sessions = makeSessions(count, systemClock.now(), waiting);
    this.emit();
  }

  addAgent(): void {
    if (this.sessions.length === 0) this.setSessions(1);
    this.coordinator.addActivity({
      id: "agent",
      kind: "agent",
      sessionId: this.sessions[0]?.id ?? "lab-session-1",
    });
  }

  addMulti(count: number, waiting = false): void {
    this.setSessions(count, waiting);
    this.coordinator.addActivity({ id: "multi", kind: "multi" });
  }

  requestAsk(): void {
    if (this.sessions.length === 0) this.setSessions(1);
    const ask = makeAsk(
      this.sessions[0]?.id ?? "lab-session-1",
      systemClock.now(),
    );
    this.coordinator.requestAsk(ask);
    // Le relais rend la main au terminal au bout de CLAUDE_PERMISSION_TIMEOUT_MS (10 min).
    this.later(ask.expiresAt - ask.receivedAt, () => {
      this.coordinator.resolveAsk(ask.id);
    });
  }

  notify(kind: NotificationKind): void {
    this.coordinator.notify(sampleNotification(kind));
  }

  showDragWake(file: DropFile): void {
    this.dropFile = file;
    this.drop = makeDrop(file, this.dropOptions);
    this.coordinator.showOverlay("dragWake");
    this.emit();
  }

  showDragOver(file: DropFile): void {
    this.dropFile = file;
    this.drop = makeDrop(file, this.dropOptions);
    this.coordinator.showOverlay("dragOver");
    this.emit();
  }

  /**
   * Progression qui se termine seule (le contrôleur de l'app fera de même) puis enchaîne. Déploiement :
   * `deployOutcome` choisit la fin (en ligne, ou échec avec « Voir les logs »).
   */
  runProgress(
    stage: ProgressChainStage,
    chain = true,
    deployOutcome: "deployed" | "deployFailed" = "deployed",
  ): void {
    const { label, detail = null, meta = null, durationMs } = PROGRESS[stage];
    const id = `prog:${stage}`;
    this.coordinator.addActivity({
      id,
      kind: "progress",
      stage,
      label,
      detail,
      meta,
      fraction: null,
      startedAt: systemClock.now(),
      estimatedMs: durationMs,
    });
    if (!chain) return;
    this.later(durationMs + PROGRESS_END_DELAY_MS, () => {
      this.coordinator.removeActivity(id);
      if (stage === "upload") this.runProgress("analyse");
      else if (stage === "analyse")
        this.coordinator.notify(sampleNotification("tickets"));
      else this.coordinator.notify(sampleNotification(deployOutcome));
    });
  }

  /** Fin d'appel : le contrôleur ajoute ensuite l'import (ou, comme le prototype, directement l'analyse). */
  endCall(first: "upload" | "analyse" = "upload"): void {
    this.coordinator.endMeet();
    this.runProgress(first);
  }

  // --- Claude de l'île : activité et moments de la session seule -------------------------------------------

  /** Session seule au travail sur `activity` (le Claude de l'île joue la scène correspondante). */
  setAgentActivity(activity: ClaudeActivity): void {
    if (this.sessions.length === 0) this.addAgent();
    this.patchSession(0, { status: "working", activity, error: false });
    this.emit();
  }

  /** Moments du Claude de l'île : réveil (début du travail), fin, erreur, demande d'autorisation. */
  agentMoment(moment: "start" | "done" | "error" | "waiting"): void {
    if (this.sessions.length === 0) this.addAgent();
    const patches: Record<typeof moment, Partial<ClaudeSession>> = {
      start: { status: "working", activity: "think", error: false },
      done: { status: "done", activity: null, error: false },
      error: { status: "idle", activity: null, error: true },
      waiting: { status: "waiting", error: false },
    };
    const patch = patches[moment];
    if (moment === "start" && this.sessions[0]?.status === "working") {
      // Réveil : la session passe d'abord hors travail (en pause), puis reprend.
      this.patchSession(0, { status: "idle", activity: null });
      this.emit();
      this.later(600, () => {
        this.patchSession(0, patch);
        this.emit();
      });
      return;
    }
    this.patchSession(0, patch);
    this.emit();
  }

  /** Session au travail depuis 10 min (bâillements, front essuyé), ou qui vient de commencer. */
  toggleAgentLongSession(): void {
    const s = this.sessions[0];
    if (!s) return;
    const now = systemClock.now();
    const long = now - s.startedAt >= 5 * 60_000;
    this.patchSession(0, { startedAt: long ? now : now - 10 * 60_000 });
    this.emit();
  }

  // --- Jardin des Claude : événements simulés sur les sessions ------------------------------------------------

  private patchSession(index: number, patch: Partial<ClaudeSession>): void {
    this.sessions = this.sessions.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
  }

  private firstIndex(accept: (s: ClaudeSession) => boolean): number {
    return this.sessions.findIndex(accept);
  }

  /** Claude part de son icône puis l'île devient un jardin (prototype : scnMulti). */
  gardenFromIcon(count: number): void {
    this.reset();
    this.addAgent();
    this.later(GARDEN_FROM_ICON_MS, () => {
      this.sessions = makeSessions(
        Math.max(2, count),
        systemClock.now(),
        false,
      );
      this.coordinator.removeActivity("agent");
      this.coordinator.addActivity({ id: "multi", kind: "multi" });
      this.emit();
    });
  }

  /** Deux sessions modifient le même fichier : leurs Claude se disputent (prototype : scnConflict). */
  gardenConflict(): void {
    const pair = this.sessions
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.status === "working" && !s.conflict)
      .slice(0, 2);
    const [a, b] = pair;
    if (!a || !b) return;
    this.patchSession(a.i, { conflict: true });
    this.patchSession(b.i, { conflict: true });
    this.remember("Jardin : conflit entre deux sessions");
    this.emit();
    // Le conflit se résout (fin du tour) : il pourra se rejouer.
    this.later(GARDEN_CONFLICT_MS, () => {
      const ids = new Set([a.s.id, b.s.id]);
      this.sessions = this.sessions.map((s) =>
        ids.has(s.id) ? { ...s, conflict: false } : s,
      );
      this.emit();
    });
  }

  /** Une session demande une autorisation ; si aucune ne travaille, celle qui attendait reprend. */
  gardenWait(): void {
    const i = this.firstIndex((s) => s.status === "working");
    if (i >= 0) this.patchSession(i, { status: "waiting" });
    else {
      const w = this.firstIndex((s) => s.status === "waiting");
      if (w >= 0) this.patchSession(w, { status: "working" });
    }
    this.emit();
  }

  /** Tour fini mais un shell tourne en arrière-plan : la première session patiente, ou reprend le travail. */
  gardenBackground(): void {
    const i = this.firstIndex((s) => s.status === "working");
    if (i >= 0)
      this.patchSession(i, {
        status: "background",
        step: "Patiente : npm run dev",
        subagents: 0,
      });
    else {
      const b = this.firstIndex((s) => s.status === "background");
      if (b >= 0)
        this.patchSession(b, {
          status: "working",
          step: "Lit le journal du serveur",
        });
    }
    this.emit();
  }

  /** Une session termine : les autres la fêtent. */
  gardenFinish(): void {
    const i = this.firstIndex((s) => s.status === "working");
    if (i >= 0)
      this.patchSession(i, { status: "done", subagents: 0, step: null });
    this.emit();
  }

  /** Sieste (session inactive) ou réveil. */
  gardenSleep(): void {
    const sleeping = this.firstIndex((s) => s.status === "sleep");
    if (sleeping >= 0) this.patchSession(sleeping, { status: "working" });
    else {
      const i = this.firstIndex((s) => s.status === "working");
      if (i >= 0) this.patchSession(i, { status: "sleep", subagents: 0 });
    }
    this.emit();
  }

  /** En pause (refus) ou reprise. */
  gardenPause(): void {
    const idle = this.firstIndex((s) => s.status === "idle" && !s.error);
    if (idle >= 0) this.patchSession(idle, { status: "working" });
    else {
      const i = this.firstIndex((s) => s.status === "working");
      if (i >= 0) this.patchSession(i, { status: "idle" });
    }
    this.emit();
  }

  /** Bloquée (outil en erreur) : un autre Claude vient la consoler ; un second appui la débloque. */
  gardenBlock(): void {
    const blocked = this.firstIndex((s) => s.error);
    if (blocked >= 0)
      this.patchSession(blocked, { error: false, status: "working" });
    else {
      const i = this.firstIndex((s) => s.status === "working");
      if (i >= 0) this.patchSession(i, { error: true, status: "idle" });
    }
    this.emit();
  }

  /** Un sous-agent de plus (tour à tour sur les sessions qui travaillent), ou un qui rentre. */
  gardenSubagent(delta: 1 | -1): void {
    if (delta > 0) {
      const working = this.sessions
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.status === "working");
      const target = working.sort((x, y) => x.s.subagents - y.s.subagents)[0];
      if (target)
        this.patchSession(target.i, { subagents: target.s.subagents + 1 });
    } else {
      const i = this.firstIndex((s) => s.subagents > 0);
      const s = this.sessions[i];
      if (s) this.patchSession(i, { subagents: s.subagents - 1 });
    }
    this.syncSoloActivity();
    this.emit();
  }

  /**
   * Session seule : avec des sous-agents → jardin, sans → icône (même règle que l'app, claudeActivityFor,
   * sans le délai de retour). Seulement si une activité Claude est déjà là (bouton « Session Claude »).
   */
  private syncSoloActivity(): void {
    if (this.sessions.length !== 1) return;
    const agent = this.coordinator.getActivity("agent");
    const multi = this.coordinator.getActivity("multi");
    if (!agent && !multi) return;
    const target = claudeActivityFor(this.sessions);
    if (target?.kind === "multi" && agent) {
      this.coordinator.removeActivity("agent");
      this.coordinator.addActivity({ id: "multi", kind: "multi" });
    } else if (target?.kind === "agent" && multi) {
      this.coordinator.removeActivity("multi");
      this.coordinator.addActivity({
        id: "agent",
        kind: "agent",
        sessionId: target.sessionId,
      });
    }
  }

  /** Nouvelle session (jusqu'à 5) ou départ de la dernière. */
  gardenSessionCount(delta: 1 | -1): void {
    const n = this.sessions.length + delta;
    if (n < 1 || n > MAX_LAB_SESSIONS) return;
    if (delta > 0) {
      const added = makeSessions(n, systemClock.now(), false)[n - 1];
      if (added)
        this.sessions = [
          ...this.sessions,
          { ...added, startedAt: systemClock.now() },
        ];
    } else {
      this.sessions = this.sessions.slice(0, n);
    }
    this.emit();
  }

  // --- Ce que font les boutons de l'île ----------------------------------------------------------------------

  /** Autoriser / Refuser / Plus tard : ferme la demande affichée. */
  decideAsk = (decision: PermissionDecision, askId: string): void => {
    this.coordinator.resolveAsk(askId);
    this.remember(
      `Demande d’autorisation : ${{ allow: "Autoriser", deny: "Refuser", later: "Plus tard" }[decision]}`,
    );
    if (decision === "deny") {
      this.coordinator.notify(sampleNotification("claudeStop"));
    }
    this.emit();
  };

  pressNotification = (notification: IslandNotification): void => {
    this.coordinator.endNotification(notification.id);
    this.remember(
      `Bouton « ${notification.button ?? "Fermer"} » : ${notification.title}`,
    );
    const action = notification.action;
    if (action.type === "undoFiling")
      this.coordinator.notify(
        undoneNotification({
          count: action.intakeIds.length,
          ruleRevoked: action.ruleIds.length > 0,
          route: action.intakeIds.length === 1 ? intakeRoute(action.intakeIds[0] ?? "") : batchRoute(SAMPLE_BATCH_ID),
        }),
      );
    else if (action.type === "retryFiling") this.simulateFiling("sure");
    else if (action.type === "showChoice") {
      const lab = this.choices.get(action.choiceId);
      if (lab?.kind === "filingOne")
        this.offerChoice(readyChoice(lab.item, SAMPLE_NAMES), lab);
      else if (lab?.kind === "filingMany")
        this.offerChoice(readyManyChoice(lab.items, SAMPLE_BATCH_ID, SAMPLE_NAMES), lab);
    } else if (action.type === "undoProposal")
      this.coordinator.notify(proposalUndoneNotification());
    if (notification.action.type === "stopRecording") this.stopRecording();
    else if (
      notification.action.type === "showSessions" &&
      this.sessions.length === 0
    )
      this.setSessions(3);
    this.emit();
  };

  dismissNotification = (notification: IslandNotification): void => {
    this.coordinator.endNotification(notification.id);
    this.remember(`Échap : ${notification.title}`);
    this.emit();
  };

  /** « Transcrire » : l'appel détecté devient un enregistrement simulé. */
  acceptCall = (projectId: string | null): void => {
    const project = LAB_PROJECTS.find((p) => p.id === projectId) ?? null;
    this.coordinator.hideOverlay("appel");
    this.call = null;
    this.coordinator.addActivity({
      id: "meet",
      kind: "meet",
      appName: this.callAppName(),
      service: this.callService,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      startedAt: systemClock.now(),
    });
    this.remember(`Transcrire : ${project?.name ?? "sans projet"}`);
    this.emit();
  };

  ignoreCall = (): void => {
    this.coordinator.hideOverlay("appel");
    this.call = null;
    this.remember("Ignorer l’appel détecté");
    this.emit();
  };

  changeCallProject = (projectId: string): void => {
    if (this.call) this.call = { ...this.call, selectedProjectId: projectId };
    this.emit();
  };

  // --- Rangement des fichiers et notifications de la base (ce que font les sources « rangement » et
  // « notifications » du contrôleur, avec les mêmes textes : drop/filing.ts, appNotifications/logic.ts) ------

  /** Fichiers déposés sur « Ranger » : progression du classement, puis ce que l'île annonce pour ce cas. */
  simulateFiling(kind: SampleFilingCase): void {
    const items = filingItemsOf(sampleBatchItems(kind));
    const total = items.length;
    const id = `${FILING_PROGRESS_ID}:lab`;
    this.coordinator.addActivity({
      id,
      kind: "progress",
      stage: FILING_PROGRESS_STAGE,
      label: filingProgressLabel(0, total),
      fraction: null,
      startedAt: systemClock.now(),
      estimatedMs: estimateFilingMs(total),
    });
    for (let done = 1; done <= total; done++) {
      this.later(done * LAB_FILING_MS_PER_FILE, () =>
        this.coordinator.updateActivity(id, {
          label: filingProgressLabel(done, total),
          fraction: done / total,
        }),
      );
    }
    this.later(total * LAB_FILING_MS_PER_FILE + PROGRESS_END_DELAY_MS, () => {
      this.coordinator.removeActivity(id);
      this.announceFiling(items);
    });
    this.remember(`Dépôt sur Ranger : ${total} fichier${total > 1 ? "s" : ""}`);
    this.emit();
  }

  private announceFiling(items: readonly FilingItem[]): void {
    const { errors, main } = planBatch(items);
    if (main.type === "auto")
      this.coordinator.notify(autoFiledNotification(main.items, SAMPLE_NAMES));
    else if (main.type === "review")
      this.coordinator.notify(reviewNotification(main, SAMPLE_BATCH_ID));
    else if (main.type === "readyOne")
      this.offerChoice(readyChoice(main.item, SAMPLE_NAMES, main.auto), {
        kind: "filingOne",
        item: main.item,
      });
    else if (main.type === "readyMany")
      this.offerChoice(
        readyManyChoice(main.items, SAMPLE_BATCH_ID, SAMPLE_NAMES, main.auto),
        { kind: "filingMany", items: main.items },
      );
    if (errors.length > 0)
      this.coordinator.notify(filingErrorNotification(errors, SAMPLE_BATCH_ID));
  }

  private offerChoice(choice: IslandChoice, lab: LabChoice): void {
    this.choices.set(choice.id, lab);
    this.coordinator.requestChoice(choice, {
      onSetAside: () => {
        if (lab.kind === "proposal") return;
        this.remember(`Décision mise de côté : ${choice.title}`);
        this.coordinator.notify(
          setAsideNotification(choice, lab.kind === "filingMany" ? lab.items.length : 1),
        );
        this.emit();
      },
    });
  }

  /** Notification de la base (table notifications) d'un type donné, filtrée et traduite comme dans l'app. */
  simulateAppNotification(key: string): void {
    const row = SAMPLE_APP_NOTIFICATIONS[key];
    if (!row) return;
    // Id neuf à chaque envoi : la coordination ignore une notification déjà connue.
    const fresh = { ...row, id: `${row.id}-${systemClock.now()}` };
    const view = islandViewOf(fresh, {
      memberId: fresh.member_id,
      ownBatchIds: new Set(),
      trackedInputIds: new Set(),
    });
    if (view.type === "notify") this.coordinator.notify(view.notification);
    else if (view.type === "choice")
      this.offerChoice(
        { ...view.choice, id: `${view.choice.id}-${systemClock.now()}` },
        { kind: "proposal", proposalId: view.proposalId, title: view.choice.title },
      );
    this.remember(`Notification de la base : ${row.kind}`);
    this.emit();
  }

  /** Boutons et Échap d'une décision. */
  decideChoice = (decision: ChoiceDecision, choice: IslandChoice, always: boolean): void => {
    this.coordinator.resolveChoice(choice.id);
    const lab = this.choices.get(choice.id);
    this.choices.delete(choice.id);
    const label =
      decision === "primary" ? choice.primary : decision === "secondary" ? (choice.secondary ?? "") : "Échap";
    this.remember(`${label}${always ? " + Toujours" : ""} : ${choice.title}`);
    if (lab && decision === "secondary" && lab.kind !== "proposal") {
      const route =
        lab.kind === "filingOne" && lab.item.intake ? intakeRoute(lab.item.intake.id) : batchRoute(SAMPLE_BATCH_ID);
      this.remember(`Ouvre l’app sur ${route}`);
    }
    if (lab && decision === "primary") {
      if (lab.kind === "filingOne" && lab.item.intake) {
        this.coordinator.notify(
          filedNotification({
            intake: lab.item.intake,
            file: sampleFiledFile({
              kind: lab.item.intake.proposal?.kind ?? "other",
              folder: lab.item.intake.proposal?.folder ?? "Divers",
            }),
            rule: always ? { id: "r-lab" } : null,
            ruleError: null,
            names: SAMPLE_NAMES,
          }),
        );
      } else if (lab.kind === "filingMany") {
        this.coordinator.notify(
          filedManyNotification({
            filed: lab.items.flatMap((item) =>
              item.intake ? [{ intake: item.intake, file: sampleFiledFile() }] : [],
            ),
            failed: 0,
            batchId: SAMPLE_BATCH_ID,
            names: SAMPLE_NAMES,
          }),
        );
      } else if (lab.kind === "proposal") {
        this.coordinator.notify(proposalAppliedNotification(lab.title, lab.proposalId, always));
      }
    }
    this.emit();
  };

  /** « Arrêter » : fin d'appel, import, analyse, puis « 6 tickets à valider ». */
  stopRecording = (): void => {
    this.remember("Arrêter l’enregistrement : import, analyse, tickets");
    this.endCall("upload");
    this.emit();
  };

  answerSession = (sessionId: string): void => {
    this.remember(`Répondre à ${sessionId}`);
    this.sessions = this.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: "working" } : s,
    );
    this.emit();
  };

  /** Clic sur une session (vue agent, plusieurs sessions, ligne « aussi en cours ») : sa fenêtre VS Code. */
  openSession = (sessionId: string): void => {
    const session = this.sessions.find((s) => s.id === sessionId);
    this.remember(`Ouvrir ${session?.projectName ?? sessionId} dans son éditeur`);
    this.emit();
  };

  /** Scénario D : la suivante dans l'ordre de priorité passe devant (ancien clic sur la bulle). */
  pinBubble = (): void => {
    const pinned = this.coordinator.pinSecondary();
    this.remember(`Bulle : ${pinned ?? "rien à épingler"} passe devant`);
    this.emit();
  };

  /** Bulle ou ligne « aussi en cours » Musique ou progression : l'activité passe devant (épinglée). */
  showActivity = (activity: Activity): void => {
    const shown = this.coordinator.pin(activity.id);
    this.remember(
      shown
        ? `Afficher ${ACTIVITY_NAMES[activity.kind]} dans l’île`
        : `Afficher ${ACTIVITY_NAMES[activity.kind]} : refusé (activité exclusive)`,
    );
    this.emit();
  };

  // --- Scénarios de priorité (prototype : PRIO ; chronologie de coordinator/scenarios.test.ts) ----------------

  private pressAsk(at: number): void {
    this.later(at, () => {
      const { state, ask } = this.coordinator.getSnapshot();
      if (state === "agentAsk" && ask)
        this.later(AUTO_PRESS_DELAY_MS, () => this.decideAsk("allow", ask.id));
    });
  }

  private pressNotificationAt(at: number): void {
    this.later(at, () => {
      const { state, notification } = this.coordinator.getSnapshot();
      if (state === "notif" && notification)
        this.later(AUTO_PRESS_DELAY_MS, () =>
          this.pressNotification(notification),
        );
    });
  }

  runScenario(id: ScenarioId): void {
    if (id === "C") this.setFocusMode(true);
    this.reset();
    this.remember(`Scénario ${id} : ${SCENARIOS[id]}`);
    switch (id) {
      case "A":
        this.startMeet();
        this.later(1500, () => this.addAgent());
        this.later(4000, () => this.runProgress("deploy"));
        this.later(7000, () => this.requestAsk());
        this.pressAsk(10_500);
        this.later(17_500, () => this.endCall("analyse"));
        break;
      case "B":
        this.addMusic();
        this.later(1200, () => this.notify("devis"));
        this.later(1500, () => this.notify("paiement"));
        this.later(1800, () => this.notify("assign"));
        this.later(2100, () => this.notify("relecture"));
        break;
      case "C":
        this.startMeet();
        this.later(2000, () => this.notify("paiement"));
        this.later(3500, () => this.notify("assign"));
        this.later(5000, () => this.notify("devis"));
        this.later(9000, () => this.endCall("upload"));
        break;
      case "D":
        this.startMeet();
        this.later(800, () => this.addMulti(5));
        this.later(3000, () => this.pinBubble());
        this.later(11_000, () => this.pinBubble());
        break;
      case "E":
        this.addMusic();
        this.later(1500, () => this.addMulti(5));
        break;
      case "F":
        this.addAgent();
        this.later(1000, () => this.addMusic());
        this.later(3000, () => {
          this.requestAsk();
          this.notify("rappel");
        });
        this.pressAsk(6500);
        this.pressNotificationAt(8600);
        break;
    }
    this.emit();
  }
}

export type ScenarioId = "A" | "B" | "C" | "D" | "E" | "F";

export const SCENARIOS: Record<ScenarioId, string> = {
  A: "Appel, Claude et déploiement",
  B: "Notifications en rafale",
  C: "Appel en mode concentration",
  D: "Épingler Claude pendant un appel",
  E: "Musique et sessions Claude",
  F: "Deux interruptions à la suite",
};
