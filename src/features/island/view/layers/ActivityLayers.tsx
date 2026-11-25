/**
 * Couches compactes : progression (progress, et progressOpen au survol) et musique (music, et musicOpen au
 * survol). La pochette et l'égaliseur de la musique, l'icône, l'anneau et le libellé fermé de la progression
 * sont des éléments partagés (SharedElements) : ils glissent et grandissent de l'île compacte vers la vue ouverte.
 */
import { RING, islandSize } from "../../geometry";
import type { IslandMusic, MusicCommand } from "../../types";
import { cx } from "../cx";
import { useLastNonNull } from "../hooks";
import { MusicControlIcon } from "../icons";
import styles from "../Island.module.css";
import { formatElapsed, type BackgroundRow } from "../labels";
import { Layer } from "../Layer";
import { Marquee } from "../Marquee";
import { musicHasProgress } from "../music";
import type { ActivityOfKind } from "../types";
import type { BaseLayerProps } from "./CallLayers";
import { BackgroundList } from "./BackgroundList";

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
  onSelectRow,
  elapsedRef,
  fillRef,
  ...base
}: BaseLayerProps & {
  music: IslandMusic | null;
  /**
   * Ce qui tourne aussi (sessions Claude, dont les Claude marchent devant ; progressions), une ligne cliquable
   * chacun au survol (dépliée : toutes) ; la hauteur de la couche suit.
   */
  rows: readonly BackgroundRow[];
  onSelectRow: (row: BackgroundRow) => void;
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
        <BackgroundList
          rows={rows}
          platform={base.platform}
          label="Aussi en cours"
          onSelectRow={onSelectRow}
        />
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

/**
 * Progression (import, analyse, déploiement). Fermée : rien ici (icône de l'étape, anneau et, sous Windows, le
 * libellé sont partagés). Ouverte (survol) : à droite de l'icône, le libellé (dépôt d'un déploiement), le
 * détail (message du commit) et la petite ligne (branche), une ligne chacun, qui défilent s'ils sont trop
 * longs ; sans détail (import, analyse), le libellé seul, centré en hauteur. L'anneau reste celui de l'île fermée.
 */
export function ProgressLayer({
  progress,
  rows,
  open,
  onSelectRow,
  ...base
}: BaseLayerProps & {
  progress: ActivityOfKind<"progress"> | null;
  /**
   * Ce qui tourne aussi (sessions Claude, musique), une ligne cliquable chacun au survol : pendant un
   * déploiement, les sessions restent à portée de clic. La hauteur de la couche suit.
   */
  rows: readonly BackgroundRow[];
  onSelectRow: (row: BackgroundRow) => void;
  open: boolean;
}) {
  const shown = useLastNonNull(progress);
  const label = shown?.label ?? "";
  const detail = shown?.detail || null;
  const meta = shown?.meta || null;
  const height = islandSize(base.platform, "progressOpen", rows.length).h;
  return (
    <Layer
      {...base}
      state="progress"
      open={open}
      replayKey={shown ? `${shown.id}:${shown.stage}` : null}
      style={{ height }}
    >
      <div className={cx(styles.detail, styles.progDetail)}>
        <div className={styles.progHead}>
        <span className={styles.progText}>
          <strong>
            <Marquee text={label} active={open} />
          </strong>
          {detail ? (
            <small>
              <Marquee text={detail} active={open} />
            </small>
          ) : null}
          {meta ? (
            <small className={styles.progMeta}>
              <Marquee text={meta} active={open} />
            </small>
          ) : null}
        </span>
        </div>
        <BackgroundList
          rows={rows}
          platform={base.platform}
          label="Aussi en cours"
          onSelectRow={onSelectRow}
        />
      </div>
    </Layer>
  );
}
