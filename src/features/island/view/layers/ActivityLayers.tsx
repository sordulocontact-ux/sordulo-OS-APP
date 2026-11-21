/**
 * Couches compactes : progression (import, analyse) et musique (music, et musicOpen au survol).
 * La pochette et l'égaliseur de la musique sont des éléments partagés (SharedElements) : ils glissent et
 * grandissent de l'île compacte vers la vue ouverte.
 */
import { RING, islandSize } from "../../geometry";
import type { IslandMusic, MusicCommand } from "../../types";
import { cx } from "../cx";
import { useLastNonNull } from "../hooks";
import { IslandIcon, MusicControlIcon } from "../icons";
import styles from "../Island.module.css";
import { formatElapsed, type BackgroundRow } from "../labels";
import { Layer } from "../Layer";
import { Marquee } from "../Marquee";
import { musicHasProgress } from "../music";
import { PROGRESS_VISUALS, toneStyle } from "../tone";
import type { ActivityOfKind } from "../types";
import type { BaseLayerProps } from "./CallLayers";
import { ROW_TONE_CLASS } from "./rowTone";

/**
 * Musique. Compacte : rien ici (pochette et égaliseur partagés). Ouverte (survol ou focus) : bouton sur la
 * pochette (lecteur au premier plan), titre, artiste et lecteur, progression si le lecteur la donne,
 * précédent / lecture-pause / suivant. La boucle écrit le temps écoulé et le remplissage de la barre.
 */
export function MusicLayer({
  music,
  rows,
  open,
  onMusicCommand,
  elapsedRef,
  fillRef,
  ...base
}: BaseLayerProps & {
  music: IslandMusic | null;
  /** Sessions Claude en cours (avec la musique : leurs Claude marchent devant), une ligne chacune au survol. */
  rows: readonly BackgroundRow[];
  open: boolean;
  onMusicCommand?: (command: MusicCommand) => void;
  elapsedRef: (el: HTMLElement | null) => void;
  fillRef: (el: HTMLElement | null) => void;
}) {
  const shown = useLastNonNull(music);
  const progress = musicHasProgress(shown);
  const durationMs = progress ? (shown?.durationMs ?? null) : null;
  const playing = shown?.playing ?? true;
  const appName = shown?.appName ?? "";
  const height = islandSize(
    base.platform,
    "musicOpen",
    rows.length,
    progress,
    shown?.canControl !== false,
  ).h;
  /** Faux : Spotify sur un autre appareil sans Premium, pas de boutons (la pochette ouvre toujours le lecteur). */
  const canControl = shown?.canControl !== false;
  const send = (command: MusicCommand) => onMusicCommand?.(command);
  return (
    <Layer
      {...base}
      state="music"
      open={open}
      label={playing ? "Musique en lecture" : "Musique en pause"}
      style={{ height }}
    >
      <div className={cx(styles.detail, styles.musicDetail)}>
        <div className={styles.musicHead}>
          {/* La pochette visible est l'élément partagé, juste au-dessus : ce bouton porte le clic et le focus. */}
          <button
            type="button"
            className={styles.musicCoverBtn}
            onClick={() => send("open")}
            aria-label={appName ? `Ouvrir ${appName}` : "Ouvrir le lecteur"}
          />
          <span className={styles.musicText}>
            <strong>
              <Marquee text={shown?.title || "Musique"} active={open} />
            </strong>
            {shown?.artist ? (
              <small>
                <Marquee text={shown.artist} active={open} />
              </small>
            ) : null}
            {shown?.appName ? (
              <small className={styles.musicApp}>
                <Marquee text={shown.appName} active={open} />
              </small>
            ) : null}
          </span>
        </div>
        {durationMs !== null && (
          <div className={styles.musicProgress}>
            <span className={styles.musicTime} ref={elapsedRef} />
            <span className={styles.musicTrack} aria-hidden="true">
              <span className={styles.musicFill} ref={fillRef} />
            </span>
            <span className={styles.musicTime}>
              {formatElapsed(durationMs)}
            </span>
          </div>
        )}
        {canControl && (
          <div
            className={styles.musicControls}
            role="group"
            aria-label={
              appName ? `Commandes de ${appName}` : "Commandes du lecteur"
            }
          >
            <button
              type="button"
              className={styles.musicBtn}
              onClick={() => send("previous")}
              aria-label="Morceau précédent"
            >
              <MusicControlIcon name="previous" />
            </button>
            <button
              type="button"
              className={cx(styles.musicBtn, styles.musicBtnMain)}
              onClick={() => send("playPause")}
              aria-label={playing ? "Pause" : "Lecture"}
            >
              <MusicControlIcon name={playing ? "pause" : "play"} />
            </button>
            <button
              type="button"
              className={styles.musicBtn}
              onClick={() => send("next")}
              aria-label="Morceau suivant"
            >
              <MusicControlIcon name="next" />
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <ul
            className={styles.meetBackground}
            aria-label="Sessions Claude en cours"
          >
            {rows.map((row) => (
              <li
                key={row.id}
                className={cx(styles.row, styles.meetBackgroundRow)}
              >
                <b>{row.title}</b>
                <span className={styles.task}>{row.detail}</span>
                {row.status && (
                  <span className={cx(styles.st, ROW_TONE_CLASS[row.tone])}>
                    {row.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layer>
  );
}

/** Anneau de progression (18 px, rayon 7) ; la boucle écrit stroke-dashoffset. */
export function ProgressRing({
  barRef,
  className,
}: {
  barRef: (el: SVGCircleElement | null) => void;
  className?: string;
}) {
  return (
    <svg
      className={[styles.ring, className].filter(Boolean).join(" ")}
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle className={styles.ringTrack} cx="9" cy="9" r="7" />
      <circle
        ref={barRef}
        className={styles.ringBar}
        cx="9"
        cy="9"
        r="7"
        strokeDasharray={RING.circumference}
        strokeDashoffset={RING.circumference}
      />
    </svg>
  );
}

export function ProgressLayer({
  progress,
  ringRef,
  ...base
}: BaseLayerProps & {
  progress: ActivityOfKind<"progress"> | null;
  ringRef: (el: SVGCircleElement | null) => void;
}) {
  const shown = useLastNonNull(progress);
  const visual = PROGRESS_VISUALS[shown?.stage ?? "upload"];
  return (
    <Layer
      {...base}
      state="progress"
      className={styles.layerProg}
      style={toneStyle(visual.tone)}
      replayKey={shown ? `${shown.id}:${shown.stage}` : null}
    >
      <span className={styles.progLeft}>
        <IslandIcon name={visual.icon} className={styles.progIcon} />
        <span className={styles.progLabel}>{shown?.label}</span>
      </span>
      <ProgressRing barRef={ringRef} />
    </Layer>
  );
}
