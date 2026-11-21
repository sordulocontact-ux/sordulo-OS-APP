/**
 * Labo de l'île (développement seulement) : /desktop/ile-labo. Le vrai composant `Island`, piloté par un vrai
 * IslandCoordinator, dans une scène de la taille de la fenêtre de l'île (640 × 260), pour le comparer à l'œil
 * avec design/prototypes/ile-sordulo-os.html ouvert à côté. Sans Tauri, sans connexion.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, Select } from "../../../components/ui";
import type { CallService } from "../../../shared/desktop-contract";
import { CALL_SERVICES, callBrand } from "../brands";
import { Garden } from "../garden";
import { SPRING, WAVE, islandSize, sizeKeyFor } from "../geometry";
import type { IslandPlatform, NotificationKind } from "../types";
import { Island, islandLabel, type IslandDropZone } from "../view";
import { musicHasProgress } from "../view/music";
import {
  MAX_LAB_SESSIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_LABELS,
  type DropFile,
} from "./fixtures";
import styles from "./IslandLab.module.css";
import { LabRuntime, SCENARIOS, type ScenarioId } from "./runtime";

/** Taille de la vraie fenêtre de l'île (src-tauri). */
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 260;

type Backdrop = "light" | "dark";

const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
const NO_HIT_RECTS = () => undefined;

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

export default function IslandLab() {
  const [runtime] = useState(() => new LabRuntime());
  useEffect(() => {
    runtime.start();
    return runtime.stop;
  }, [runtime]);
  const view = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const { snapshot } = view;

  const [platform, setPlatform] = useState<IslandPlatform>("win");
  const [backdrop, setBackdrop] = useState<Backdrop>("light");
  const [callService, setCallService] = useState<CallService | null>("meet");
  const [forcedHover, setForcedHover] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [simulatedWave, setSimulatedWave] = useState(false);
  const [notificationKind, setNotificationKind] =
    useState<NotificationKind>("tickets");
  const [sessionCount, setSessionCount] = useState(3);
  const [waitingSession, setWaitingSession] = useState(true);
  const [filesZone, setFilesZone] = useState(false);
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

      <div className={styles.stageBlock}>
        <div
          className={styles.scene}
          data-backdrop={backdrop}
          style={{ width: WINDOW_WIDTH, height: WINDOW_HEIGHT }}
          data-testid="island-scene"
        >
          <Island
            snapshot={snapshot}
            platform={platform}
            hover={view.hover}
            call={view.call}
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
            onBubbleClick={runtime.pinBubble}
            onNotificationAction={runtime.pressNotification}
            onNotificationDismiss={runtime.dismissNotification}
            onAskDecision={(decision, ask) =>
              runtime.decideAsk(decision, ask.id)
            }
            onCallAccept={runtime.acceptCall}
            onCallIgnore={runtime.ignoreCall}
            onProjectChange={runtime.changeCallProject}
            onStopRecording={runtime.stopRecording}
            onAnswerSession={runtime.answerSession}
            onOpenSession={(sessionId) =>
              console.info("[labo] ouvrir la session", sessionId)
            }
            onMusicCommand={runtime.musicCommand}
            onHitRectsChange={NO_HIT_RECTS}
          />
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
            <Check
              label="Zone Fichiers"
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
                <option value="files">Fichiers</option>
                <option value="claude">Claude Code</option>
              </Select>
            </label>
          </div>
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
                value={platform}
                onChange={(e) => setPlatform(e.target.value as IslandPlatform)}
              >
                <option value="win">Windows</option>
                <option value="mac">Mac avec encoche</option>
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
