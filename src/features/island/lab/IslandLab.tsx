/**
 * Labo de l'île (développement seulement) : /desktop/ile-labo. Le vrai composant `Island`, piloté par un vrai
 * IslandCoordinator, dans une scène de la taille de la fenêtre de l'île (ISLAND_WINDOW_SIZE), pour le comparer à l'œil
 * avec design/prototypes/ile-sordulo-os.html ouvert à côté. Sans Tauri, sans connexion.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button, Select } from "../../../components/ui";
import { ISLAND_WINDOW_SIZE, type CallService } from "../../../shared/desktop-contract";
import { CALL_SERVICES, callBrand } from "../brands";
import { Garden } from "../garden";
import {
  BOUNCY_SPRING,
  SPRING,
  WAVE,
  dampingRatio,
  edgePlatform,
  islandSize,
  progressShowsName,
  sizeKeyFor,
} from "../geometry";
import type {
  ClaudeActivity,
  IslandEdge,
  IslandPlatform,
  NotificationKind,
} from "../types";
import { Island, islandLabel, type IslandDropZone } from "../view";
import { musicHasProgress } from "../view/music";
import { PUDDLE } from "../view/puddle";
import type { DragMotionReader } from "../view/types";
import {
  MAX_LAB_SESSIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_LABELS,
  type DropFile,
} from "./fixtures";
import type { SampleFilingCase } from "../drop/filingFixtures";
import styles from "./IslandLab.module.css";
import { LabRuntime, SCENARIOS, type ScenarioId } from "./runtime";

const EDGE_LABELS: Record<IslandEdge, string> = {
  top: "Haut",
  bottom: "Bas",
  left: "Gauche",
  right: "Droite",
};
const EDGES = Object.keys(EDGE_LABELS) as IslandEdge[];

/** Taille de la vraie fenêtre de l'île au bord donné (contrat). */
function windowSizeFor(edge: IslandEdge) {
  return edge === "left" || edge === "right"
    ? ISLAND_WINDOW_SIZE.vertical
    : ISLAND_WINDOW_SIZE.horizontal;
}

type Backdrop = "light" | "dark";

const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
/** Activités du Claude de l'île, dans l'ordre des boutons du labo. */
const LAB_ACTIVITIES: ReadonlyArray<readonly [ClaudeActivity, string]> = [
  ["read", "Lit"],
  ["search", "Fouille"],
  ["write", "Écrit"],
  ["command", "Commande"],
  ["web", "Web"],
  ["think", "Réfléchit"],
  ["subagent", "Sous-agent"],
];
const NO_HIT_RECTS = () => undefined;
/** Cas de rangement simulés (drop/filingFixtures.ts). */
const FILING_CASES: ReadonlyArray<readonly [SampleFilingCase, string]> = [
  ["sure", "Fichier sûr"],
  ["version", "Nouvelle version"],
  ["three", "3 fichiers sûrs"],
  ["review", "Fichier à vérifier"],
  ["duplicate", "Doublon"],
  ["auto", "Rangé automatiquement"],
  ["error", "Erreur de classement"],
];
/** Notifications de la base simulées (drop/filingFixtures.ts, SAMPLE_APP_NOTIFICATIONS). */
const APP_NOTIFICATION_CASES: ReadonlyArray<readonly [string, string]> = [
  ["prospect.created", "Site ajouté par l’apporteur"],
  ["prospect.offer_ready", "Offre prête"],
  ["input.ready", "Tickets à valider"],
  ["proposal.created", "Proposition de l’IA"],
  ["proposal.auto_applied", "Proposition appliquée seule"],
  ["deliverable.comment", "Commentaire sur un livrable"],
  ["commission.created", "Commission"],
  ["recap.weekly", "Récap du lundi"],
];

/** Onde simulée façon prototype (nextSample) : des phases de parole et de silence, niveaux 0..1. */
function useSimulatedWave(enabled: boolean): readonly number[] | undefined {
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: WAVE.bars }, () => 0),
  );
  const talk = useRef({ talking: true, left: 14 });
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const t = talk.current;
      t.left -= 1;
      if (t.left <= 0) {
        t.talking = !t.talking;
        t.left = t.talking ? 8 + Math.random() * 18 : 3 + Math.random() * 7;
      }
      let level = 0;
      if (t.talking)
        level =
          Math.random() < 0.15
            ? 0.15
            : Math.round(5 + Math.random() * 9) / WAVE.maxHeight;
      setLevels((prev) => [...prev.slice(1), level]);
    }, WAVE.scrollMs);
    return () => window.clearInterval(id);
  }, [enabled]);
  return enabled ? levels : undefined;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** Part de la nouvelle mesure dans la vitesse lissée du glisser simulé (Rust lisse sur 150 ms). */
const LAB_DRAG_SMOOTHING = 0.35;

/** Lancer simulé comme dans l'app (geometry.rs) : ressort, vitesse plafonnée, arrivée à 28 px de la place. */
const LAB_THROW = { stiffness: 320, damping: 25, maxSpeed: 5000, land: 28 };

/**
 * Glisser simulé : île détachée, la flaque suit la souris dans la scène et sa vitesse est donnée à l'île comme
 * celle que Rust envoie (island-motion). Au lâcher, elle est lancée vers son bord et s'y écrase.
 */

function useLabDrag(
  active: boolean,
  layerRef: RefObject<HTMLDivElement | null>,
  onLand: () => void,
) {
  const drag = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    at: -Infinity,
    grab: null as { x: number; y: number } | null,
    last: { x: 0, y: 0, t: 0 },
    flight: 0,
  });
  const landRef = useRef(onLand);
  useEffect(() => {
    landRef.current = onLand;
  });
  useEffect(() => () => cancelAnimationFrame(drag.current.flight), []);

  useEffect(() => {
    if (active || drag.current.flight) return;
    const d = drag.current;
    d.x = 0;
    d.y = 0;
    d.grab = null;
    d.at = -Infinity;
    if (layerRef.current) layerRef.current.style.transform = "";
  }, [active, layerRef]);

  const reader = useCallback<DragMotionReader>((nowMs) => {
    const d = drag.current;
    return nowMs - d.at < PUDDLE.staleMs ? { vx: d.vx, vy: d.vy } : null;
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!active || e.button !== 0 || drag.current.flight) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = drag.current;
    d.grab = { x: e.clientX - d.x, y: e.clientY - d.y };
    d.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    d.vx = 0;
    d.vy = 0;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.grab) return;
    const dt = (e.timeStamp - d.last.t) / 1000;
    if (dt > 0) {
      const k = LAB_DRAG_SMOOTHING;
      d.vx = d.vx * (1 - k) + ((e.clientX - d.last.x) / dt) * k;
      d.vy = d.vy * (1 - k) + ((e.clientY - d.last.y) / dt) * k;
      d.at = e.timeStamp;
    }
    d.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    d.x = e.clientX - d.grab.x;
    d.y = e.clientY - d.grab.y;
    if (layerRef.current) {
      layerRef.current.style.transform = `translate(${d.x}px, ${d.y}px)`;
    }
  };
  /**
   * Lâcher : la forme est lancée vers sa place (le bord de la scène) avec un ressort qui part de la vitesse du
   * geste ; à LAB_THROW.land px de la place, le glisser se termine (la flaque s'écrase sur le bord).
   */
  const onPointerUp = () => {
    const d = drag.current;
    if (!d.grab) return;
    d.grab = null;
    const speed = Math.hypot(d.vx, d.vy);
    if (speed > LAB_THROW.maxSpeed) {
      d.vx = (d.vx / speed) * LAB_THROW.maxSpeed;
      d.vy = (d.vy / speed) * LAB_THROW.maxSpeed;
    }
    let last = performance.now();
    let landed = false;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const ax = -LAB_THROW.stiffness * d.x - LAB_THROW.damping * d.vx;
      const ay = -LAB_THROW.stiffness * d.y - LAB_THROW.damping * d.vy;
      d.vx += ax * dt;
      d.vy += ay * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.at = now;
      if (!landed && Math.hypot(d.x, d.y) < LAB_THROW.land) {
        landed = true;
        landRef.current();
      }
      const settled = Math.hypot(d.x, d.y) < 0.5 && Math.hypot(d.vx, d.vy) < 5;
      if (settled) {
        d.x = 0;
        d.y = 0;
        d.at = -Infinity;
        d.flight = 0;
        if (layerRef.current) layerRef.current.style.transform = "";
        return;
      }
      if (layerRef.current) {
        layerRef.current.style.transform = `translate(${d.x}px, ${d.y}px)`;
      }
      d.flight = requestAnimationFrame(tick);
    };
    d.flight = requestAnimationFrame(tick);
  };

  return {
    reader,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

export default function IslandLab() {
  const [runtime] = useState(() => new LabRuntime());
  useEffect(() => {
    runtime.start();
    return runtime.stop;
  }, [runtime]);
  const view = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { snapshot } = view;

  const [chosenPlatform, setPlatform] = useState<IslandPlatform>("win");
  const [edge, setEdge] = useState<IslandEdge>("top");
  const [dragging, setDragging] = useState(false);
  const dragLayerRef = useRef<HTMLDivElement>(null);
  const { reader: dragMotion, handlers: dragHandlers } = useLabDrag(
    dragging,
    dragLayerRef,
    () => setDragging(false),
  );
  // « Mac avec encoche » ne vaut qu'en haut ; ailleurs, la variante sans encoche.
  const platform = edgePlatform(chosenPlatform, edge);
  const windowSize = windowSizeFor(edge);
  const [backdrop, setBackdrop] = useState<Backdrop>("light");
  const [callService, setCallService] = useState<CallService | null>("meet");
  const [forcedHover, setForcedHover] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [simulatedWave, setSimulatedWave] = useState(false);
  const [notificationKind, setNotificationKind] =
    useState<NotificationKind>("tickets");
  const [sessionCount, setSessionCount] = useState(3);
  const [waitingSession, setWaitingSession] = useState(true);
  const [filesZone, setFilesZone] = useState(true);
  const [claudeZone, setClaudeZone] = useState(true);
  const [musicArtwork, setMusicArtwork] = useState(true);
  const [musicProgress, setMusicProgress] = useState(true);
  const audioLevels = useSimulatedWave(simulatedWave);
  const [showGarden, setShowGarden] = useState(true);
  const [gardenCall, setGardenCall] = useState(false);
  const gardenMood = useMemo(() => ({ call: gardenCall }), [gardenCall]);

  /** Applique un état : repart d'une île vide, puis ajoute ce qui le fait apparaître. */
  function apply(build: (r: LabRuntime) => void) {
    runtime.reset();
    build(runtime);
  }

  const musicGarden =
    snapshot.state === "music" &&
    showGarden &&
    snapshot.background.some((a) => a.kind === "agent" || a.kind === "multi");
  const sizeKey = sizeKeyFor(
    snapshot.state,
    view.hover,
    snapshot.withCall,
    musicGarden,
    progressShowsName(
      snapshot.primary?.kind === "progress" ? snapshot.primary : null,
    ),
  );
  const size = islandSize(platform, sizeKey, 0, musicHasProgress(view.music), view.music?.canControl !== false);
  const label = islandLabel(
    snapshot,
    view.sessions.length,
    view.call?.appName ?? null,
    view.music,
  );


  function resetAll() {
    runtime.reset();
    runtime.setFocusMode(false);
    setForcedHover(false);
    runtime.setForcedHover(false);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Labo de l’île</h1>
        <p className={styles.intro}>
          Page de développement. Compare l’île au prototype{" "}
          <code>design/prototypes/ile-sordulo-os.html</code> ouvert à côté :
          même état, même plateforme, même survol.
        </p>
      </header>

      <section
        className={`${styles.group} ${styles.dragPicker}`}
        aria-label="Glisser de l’île"
      >
        <div className={styles.buttons}>
          <Button
            size="sm"
            variant={dragging ? "primary" : "secondary"}
            aria-pressed={dragging}
            onClick={() => setDragging(!dragging)}
          >
            {dragging ? "Reposer l’île" : "Détacher l’île (flaque)"}
          </Button>
        </div>
        <p className={styles.hint}>
          Traîner la flaque dans la scène à la souris puis lâcher : comme dans
          l’app, elle est lancée vers son bord et s’y écrase.
        </p>
      </section>

      <div className={styles.stageBlock}>
        <div
          className={styles.scene}
          data-backdrop={backdrop}
          data-edge={edge}
          style={{ width: windowSize.width, height: windowSize.height }}
          data-testid="island-scene"
        
          {...dragHandlers}
        >
          <div ref={dragLayerRef} className={styles.dragLayer}>
          <Island
            snapshot={snapshot}
            platform={chosenPlatform}
            edge={edge}
            dragging={dragging}
            dragMotion={dragMotion}
            hover={view.hover}
            call={view.call}
            markers={view.markers}
            review={view.review}
            audioLevels={audioLevels}
            sessions={view.sessions}
            drop={view.drop}
            hotZone={view.hotZone}
            music={view.music}
            garden={
              showGarden ? (
                <Garden sessions={view.sessions} mood={gardenMood} />
              ) : undefined
            }
            reducedMotion={reducedMotion}
            onHoverChange={runtime.setRealHover}
            onBubbleClick={runtime.showActivity}
            onNotificationAction={runtime.pressNotification}
            onNotificationDismiss={runtime.dismissNotification}
            onAskDecision={(decision, ask) =>
              runtime.decideAsk(decision, ask.id)
            }
            onCallAccept={runtime.acceptCall}
            onCallIgnore={runtime.ignoreCall}
            onProjectChange={runtime.changeCallProject}
            onStopRecording={runtime.stopRecording}
            onMarkMoment={runtime.markMoment}
            onUndoMarker={runtime.undoMarker}
            onReviewAction={runtime.reviewAction}
            onAnswerSession={runtime.answerSession}
            onOpenSession={runtime.openSession}
            onChoiceDecision={runtime.decideChoice}
            onMusicCommand={runtime.musicCommand}
            onHitRectsChange={NO_HIT_RECTS}
          />
          </div>
        </div>
        <div className={styles.values}>
          <h2 className={styles.valuesTitle}>Valeurs pour Maël</h2>
          <dl className={styles.specs}>
            <dt>État</dt>
            <dd>
              {snapshot.state}
              {view.hover ? " (survol)" : ""}{" "}
              <span className={styles.muted}>{label}</span>
            </dd>
            <dt>Clé de taille</dt>
            <dd>
              {sizeKey}{" "}
              <span className={styles.muted}>
                ({platform === "win" ? "Windows" : "Mac avec encoche"})
              </span>
            </dd>
            <dt>Taille</dt>
            <dd>
              {size.w} × {size.h} px
            </dd>
            <dt>Rayon bas</dt>
            <dd>{size.r} px</dd>
            <dt>Ressort</dt>
            <dd>
              raideur {SPRING.stiffness}, amortissement {SPRING.damping}
              <span className={styles.muted}>
                {" "}
                (élargissement Mac du déploiement : amortissement{" "}
                {BOUNCY_SPRING.damping}, rapport{" "}
                {dampingRatio(BOUNCY_SPRING).toFixed(2).replace(".", ",")})
              </span>
            </dd>
          </dl>
          {view.log.length > 0 && (
            <ul
              className={styles.log}
              aria-label="Réactions aux boutons de l’île"
            >
              {view.log.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <Group title="États">
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => apply(() => undefined)}>
              Repos
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.detectCall())}>
              Appel détecté
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.startMeet())}>
              Appel en cours
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.detectCallFromCalendar())}>
              Appel détecté (agenda)
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.startMeetWithMarkers(2))}>
              Appel avec repères
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.showReview("tickets"))}>
              Valider ici
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.showReview("busy"))}>
              Validation : erreur
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.showReview("loading"))}>
              Validation : chargement
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.showReview("done"))}>
              Validation : tout traité
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.showReview("error"))}>
              Validation : illisible
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.addMusic())}>
              Musique
            </Button>
            <Button
              size="sm"
              onClick={() => apply((r) => r.runProgress("upload", false))}
            >
              Import audio
            </Button>
            <Button
              size="sm"
              onClick={() => apply((r) => r.runProgress("analyse", false))}
            >
              Analyse d’appel
            </Button>
            <Button
              size="sm"
              onClick={() => apply((r) => r.runProgress("deploy", false))}
            >
              Déploiement
            </Button>
            <Button
              size="sm"
              onClick={() => apply((r) => r.runProgress("deploy"))}
            >
              Déploiement réussi
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => r.runProgress("deploy", true, "deployFailed"))
              }
            >
              Déploiement en échec
            </Button>
            <Button size="sm" onClick={() => apply((r) => r.addAgent())}>
              Session Claude
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => {
                  r.addAgent();
                  r.requestAsk();
                })
              }
            >
              Demande d’autorisation
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => {
                  r.startMeet();
                  r.addAgent();
                  r.requestAsk();
                })
              }
            >
              Demande pendant un appel
            </Button>
          </div>
          <div className={styles.row}>
            <label className={styles.inline}>
              Sessions
              <Select
                value={sessionCount}
                onChange={(e) => setSessionCount(Number(e.target.value))}
              >
                {Array.from(
                  { length: MAX_LAB_SESSIONS - 1 },
                  (_, i) => i + 2,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <Check
              label="Une session attend (Répondre)"
              checked={waitingSession}
              onChange={setWaitingSession}
            />
            <Button
              size="sm"
              onClick={() =>
                apply((r) => r.addMulti(sessionCount, waitingSession))
              }
            >
              Plusieurs sessions
            </Button>
          </div>
          <div className={styles.row}>
            <Button
              size="sm"
              onClick={() => apply((r) => r.showDragWake("audio"))}
            >
              Glisser : réveil
            </Button>
            <Button
              size="sm"
              onClick={() => apply((r) => r.showDragOver("audio"))}
            >
              Glisser : fichier audio
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => r.showDragOver("document" satisfies DropFile))
              }
            >
              Glisser : document
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => r.showDragOver("several" satisfies DropFile))
              }
            >
              Glisser : 3 fichiers
            </Button>
            <Check
              label="Zone Ranger"
              checked={filesZone}
              onChange={(on) => {
                setFilesZone(on);
                runtime.setDropOptions({ files: on, claude: claudeZone });
              }}
            />
            <Check
              label="Zone Claude Code"
              checked={claudeZone}
              onChange={(on) => {
                setClaudeZone(on);
                runtime.setDropOptions({ files: filesZone, claude: on });
              }}
            />
            <label className={styles.inline}>
              Zone survolée
              <Select
                value={view.hotZone ?? ""}
                onChange={(e) =>
                  runtime.setHotZone(
                    (e.target.value || null) as IslandDropZone | null,
                  )
                }
              >
                <option value="">Aucune</option>
                <option value="transcribe">Transcrire</option>
                <option value="analyse">Analyser</option>
                <option value="files">Ranger</option>
                <option value="claude">Claude Code</option>
              </Select>
            </label>
          </div>
        </Group>

        <Group title="Aussi en cours">
          <div className={styles.buttons}>
            <Button
              size="sm"
              onClick={() =>
                runtime.musicWithSessions(sessionCount, waitingSession)
              }
            >
              Musique + {sessionCount} sessions
            </Button>
            <Button
              size="sm"
              onClick={() =>
                runtime.meetWithActivities(sessionCount, waitingSession)
              }
            >
              Appel + {sessionCount} sessions, musique, déploiement
            </Button>
          </div>
          <p className={styles.hint}>
            Nombre de sessions et « Une session attend » : réglages de
            « États ». Survol (ou « Survol forcé ») : une ligne par activité
            sous la musique ou l’appel, chacune cliquable ; au-delà de 3,
            « N autres activités » déplie la liste, qui défile au-delà de 6.
            Les clics s’affichent dans le journal à droite de l’île.
          </p>
        </Group>

        <Group title="Musique">
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => apply((r) => r.addMusic())}>
              Musique
            </Button>
            <Button
              size="sm"
              onClick={() => runtime.musicWithClaude(sessionCount)}
            >
              Musique pendant Claude
            </Button>
            <Button size="sm" onClick={() => runtime.musicOnPhone()}>
              Spotify sur le téléphone (sans Premium)
            </Button>
            <Button
              size="sm"
              disabled={!view.music}
              onClick={() => runtime.musicOnComputer()}
            >
              Retour au lecteur de l’ordinateur
            </Button>
            <Button size="sm" onClick={() => runtime.spotifyReconnect()}>
              Notification « Reconnecte Spotify »
            </Button>
            <Button
              size="sm"
              disabled={!view.music}
              onClick={() => runtime.toggleMusicPause()}
            >
              Pause ou reprise
            </Button>
            <Button
              size="sm"
              disabled={!view.music}
              onClick={() => runtime.changeTrack(1)}
            >
              Morceau suivant
            </Button>
            <Button
              size="sm"
              variant={musicArtwork ? "secondary" : "primary"}
              aria-pressed={!musicArtwork}
              onClick={() => {
                setMusicArtwork(!musicArtwork);
                runtime.setMusicArtwork(!musicArtwork);
              }}
            >
              Sans pochette
            </Button>
            <Button
              size="sm"
              variant={musicProgress ? "secondary" : "primary"}
              aria-pressed={!musicProgress}
              onClick={() => {
                setMusicProgress(!musicProgress);
                runtime.setMusicProgress(!musicProgress);
              }}
            >
              Sans progression
            </Button>
          </div>
          <p className={styles.hint}>
            Survol de l’île : vue ouverte, ses boutons agissent sur cette
            musique simulée. En pause, les barres se mettent à plat et les
            Claude du jardin ne dansent plus.
          </p>
        </Group>

        <Group title="Claude de l’île">
          <div className={styles.buttons}>
            {LAB_ACTIVITIES.map(([activity, label]) => (
              <Button
                key={activity}
                size="sm"
                onClick={() => runtime.setAgentActivity(activity)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => runtime.agentMoment("start")}>
              Réveil
            </Button>
            <Button size="sm" onClick={() => runtime.agentMoment("done")}>
              Fin
            </Button>
            <Button size="sm" onClick={() => runtime.agentMoment("error")}>
              Erreur
            </Button>
            <Button size="sm" onClick={() => runtime.agentMoment("waiting")}>
              Attend une autorisation
            </Button>
            <Button size="sm" onClick={() => runtime.toggleAgentLongSession()}>
              Session longue ou courte
            </Button>
          </div>
          <p className={styles.hint}>
            La session seule (bouton « Session Claude » si besoin). Commande :
            au bout de 7 s, il attend en tapant du pied. Session longue :
            bâillements et front essuyé.
          </p>
        </Group>

        <Group title="Jardin des Claude">
          <div className={styles.buttons}>
            <Button
              size="sm"
              onClick={() => apply((r) => r.addMulti(sessionCount, false))}
            >
              Jardin ({sessionCount} sessions)
            </Button>
            <Button
              size="sm"
              onClick={() => runtime.gardenFromIcon(sessionCount)}
            >
              Départ depuis l’icône
            </Button>
          </div>
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => runtime.gardenConflict()}>
              Conflit
            </Button>
            <Button size="sm" onClick={() => runtime.gardenWait()}>
              Attente d’autorisation
            </Button>
            <Button size="sm" onClick={() => runtime.gardenBackground()}>
              Patiente (arrière-plan) ou reprise
            </Button>
            <Button size="sm" onClick={() => runtime.gardenFinish()}>
              Fin de session
            </Button>
            <Button size="sm" onClick={() => runtime.gardenBlock()}>
              Bloquée ou débloquée
            </Button>
            <Button size="sm" onClick={() => runtime.gardenPause()}>
              En pause ou reprise
            </Button>
            <Button size="sm" onClick={() => runtime.gardenSleep()}>
              Sieste ou réveil
            </Button>
            <Button size="sm" onClick={() => runtime.gardenSubagent(1)}>
              Sous-agent
            </Button>
            <Button size="sm" onClick={() => runtime.gardenSubagent(-1)}>
              Sous-agent qui rentre
            </Button>
            <Button size="sm" onClick={() => runtime.gardenSessionCount(1)}>
              Nouvelle session
            </Button>
            <Button size="sm" onClick={() => runtime.gardenSessionCount(-1)}>
              Session qui part
            </Button>
          </div>
          <div className={styles.row}>
            <Button
              size="sm"
              variant={gardenCall ? "primary" : "secondary"}
              aria-pressed={gardenCall}
              onClick={() => setGardenCall(!gardenCall)}
            >
              Humeur appel en cours
            </Button>
            <Check
              label="Afficher le jardin"
              checked={showGarden}
              onChange={setShowGarden}
            />
          </div>
          <p className={styles.hint}>
            Les sessions du nombre choisi dans « États ». Scénario E : les
            Claude dansent sur la musique.
          </p>
        </Group>

        <Group title="Rangement des fichiers (zone Ranger)">
          <div className={styles.buttons}>
            {FILING_CASES.map(([kind, label]) => (
              <Button
                key={kind}
                size="sm"
                onClick={() => apply((r) => r.simulateFiling(kind))}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className={styles.hint}>
            Progression du classement, puis ce que l’île annonce. Les
            boutons des décisions et des notifications enchaînent (Ranger,
            Annuler, Réessayer…) ; sans survol, une décision est mise de
            côté au bout de 20 s (« Fichier prêt à ranger », Voir).
          </p>
        </Group>

        <Group title="Notifications de la base">
          <div className={styles.buttons}>
            {APP_NOTIFICATION_CASES.map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                onClick={() => runtime.simulateAppNotification(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className={styles.hint}>
            S’ajoutent à l’état courant, comme dans l’app (la proposition de
            l’IA ouvre une décision Valider / Refuser / Toujours).
          </p>
        </Group>

        <Group title="Notifications">
          <div className={styles.row}>
            <Select
              aria-label="Sorte de notification"
              value={notificationKind}
              onChange={(e) =>
                setNotificationKind(e.target.value as NotificationKind)
              }
            >
              {NOTIFICATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {NOTIFICATION_LABELS[kind]}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => runtime.notify(notificationKind)}>
              Envoyer
            </Button>
            <Button
              size="sm"
              onClick={() =>
                apply((r) => {
                  r.startMeet();
                  r.notify(notificationKind);
                })
              }
            >
              Pendant un appel
            </Button>
          </div>
          <p className={styles.hint}>
            « Envoyer » s’ajoute à l’état courant et à la file ; plusieurs
            envois se regroupent.
          </p>
        </Group>

        <Group title="Priorités entre activités">
          <div className={styles.buttons}>
            {SCENARIO_IDS.map((id) => (
              <Button
                key={id}
                size="sm"
                onClick={() => runtime.runScenario(id)}
              >
                {id} : {SCENARIOS[id]}
              </Button>
            ))}
          </div>
          <div className={styles.row}>
            <Button
              size="sm"
              variant={view.focusMode ? "primary" : "secondary"}
              aria-pressed={view.focusMode}
              onClick={() => runtime.setFocusMode(!view.focusMode)}
            >
              Concentration pendant les appels
            </Button>
          </div>
        </Group>

        <Group title="Affichage">
          <div className={styles.row}>
            <label className={styles.inline}>
              Plateforme
              <Select
                value={chosenPlatform}
                onChange={(e) => setPlatform(e.target.value as IslandPlatform)}
              >
                <option value="win">Windows</option>
                <option value="mac">Mac avec encoche</option>
              </Select>
            </label>
            <label className={styles.inline}>
              Bord
              <Select
                value={edge}
                onChange={(e) => setEdge(e.target.value as IslandEdge)}
              >
                {EDGES.map((value) => (
                  <option key={value} value={value}>
                    {EDGE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </label>
            <label className={styles.inline}>
              Service d’appel
              <Select
                value={callService ?? ""}
                onChange={(e) => {
                  const service =
                    e.target.value === ""
                      ? null
                      : (e.target.value as CallService);
                  setCallService(service);
                  runtime.setCallService(service);
                }}
              >
                <option value="">Inconnu (jaune)</option>
                {CALL_SERVICES.map((service) => (
                  <option key={service} value={service}>
                    {callBrand(service).label}
                  </option>
                ))}
              </Select>
            </label>
            <label className={styles.inline}>
              Fond
              <Select
                value={backdrop}
                onChange={(e) => setBackdrop(e.target.value as Backdrop)}
              >
                <option value="light">Clair</option>
                <option value="dark">Sombre</option>
              </Select>
            </label>
          </div>
          <div className={styles.row}>
            <Check
              label="Survol forcé"
              checked={forcedHover}
              onChange={(on) => {
                setForcedHover(on);
                runtime.setForcedHover(on);
              }}
            />
            <Check
              label="Réduire les animations"
              checked={reducedMotion}
              onChange={setReducedMotion}
            />
            <Check
              label="Onde simulée"
              checked={simulatedWave}
              onChange={setSimulatedWave}
            />
          </div>
          <div className={styles.row}>
            <Button size="sm" variant="danger" onClick={resetAll}>
              Réinitialiser
            </Button>
          </div>
        </Group>
      </div>
    </main>
  );
}
