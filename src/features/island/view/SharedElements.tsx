/**
 * Éléments partagés (prototype : .shared / .sh) : ils glissent d'un état à l'autre au lieu de disparaître.
 * Le moteur écrit leur position, leur opacité et la taille de l'icône Claude, de la pochette et de l'icône de
 * la progression ; la boucle écrit le minuteur, le temps écoulé, la hauteur des barres de l'onde et de
 * l'égaliseur, et l'avancement de l'anneau de la progression (un seul anneau, fermée comme ouverte).
 */
import {
  MAX_SESSION_ROWS,
  WAVE,
  progressLabelMaxWidth,
  type SharedElementId,
} from "../geometry";
import type { CallService } from "../../../shared/desktop-contract";
import type {
  ClaudeSession,
  ClaudeSessionStatus,
  IslandPlatform,
  ProgressActivity,
} from "../types";
import { cx } from "./cx";
import { ClaudeMascot } from "./ClaudeMascot";
import { CallIcon, DropIcon, IslandIcon, MusicCover } from "./icons";
import styles from "./Island.module.css";
import { ProgressRing } from "./layers/ActivityLayers";
import { MarkCount } from "./MarkCount";
import { EQ, EQ_BAR, eqBarGeometry, eqBarStyle } from "./music";
import { PROGRESS_VISUALS, toneStyle } from "./tone";
import type { IslandMarkers } from "./types";

const SEG_IDS: SharedElementId[] = ["seg0", "seg1", "seg2", "seg3", "seg4"];

function segClass(status: ClaudeSessionStatus): string | undefined {
  if (status === "working") return styles.segWorking;
  if (status === "waiting") return styles.segWaiting;
  if (status === "background") return styles.segBackground;
  if (status === "done") return styles.segDone;
  return undefined;
}

const WAVE_INDEXES = Array.from({ length: WAVE.bars }, (_, i) => i);
const EQ_INDEXES = Array.from({ length: EQ.bars }, (_, i) => i);
const EQ_WIDTH = EQ.bars * EQ_BAR.width + (EQ.bars - 1) * EQ_BAR.gap;
/** Hauteur de départ (avant la première image de la boucle) : la barre à plat. */
const EQ_START = eqBarGeometry(EQ.flatScale);

export interface SharedElementsProps {
  sessions: readonly ClaudeSession[];
  /** Service de l'appel affiché (logo de l'icône partagée) ; null : icône générique. */
  callService?: CallService | null;
  register: (id: SharedElementId, el: HTMLElement | null) => void;
  timerRef: (el: HTMLElement | null) => void;
  elapsedRef: (el: HTMLElement | null) => void;
  waveBarRef: (index: number, el: HTMLElement | null) => void;
  /** Barres de l'égaliseur de la musique (la boucle écrit leur échelle). */
  eqBarRef: (index: number, el: SVGRectElement | null) => void;
  /** Pochette du morceau en cours ; null : dégradé de repli. */
  artworkUrl: string | null;
  /** Session Claude affichée (le Claude de l'île joue ce qu'elle fait) ; null : aucune. */
  agent: Pick<ClaudeSession, "status" | "activity" | "activityAt" | "error" | "startedAt"> | null;
  reduced: boolean;
  /** Progression affichée (gardée pendant le fondu de sortie) : icône et couleur de l'étape, libellé fermé. */
  progress: Pick<ProgressActivity, "stage" | "label"> | null;
  /** Variante dessinée (edgePlatform) : largeur maximale du libellé fermé (Mac : jusqu'à l'encoche). */
  platform: IslandPlatform;
  /** Anneau de la progression (la boucle écrit stroke-dashoffset). */
  ringRef: (el: SVGCircleElement | null) => void;
  /** Moments marqués de l'enregistrement (étoile et nombre à gauche du minuteur) ; null : rien. */
  markers?: IslandMarkers | null;
}

export function SharedElements({
  sessions,
  callService = null,
  register,
  timerRef,
  elapsedRef,
  waveBarRef,
  eqBarRef,
  artworkUrl,
  agent,
  reduced,
  progress,
  platform,
  ringRef,
  markers = null,
}: SharedElementsProps) {
  const agentWorking = agent?.status === "working";
  const segs = sessions.slice(0, MAX_SESSION_ROWS);
  const progVisual = PROGRESS_VISUALS[progress?.stage ?? "upload"];
  const progTone = toneStyle(progVisual.tone);
  return (
    <div className={styles.shared} aria-hidden="true">
      <span
        className={cx(styles.sh, styles.meetGroup)}
        ref={(el) => register("meetGroup", el)}
      >
        <CallIcon service={callService} />
        <span className={styles.scrollWave}>
          {WAVE_INDEXES.map((i) => (
            <i key={i} ref={(el) => waveBarRef(i, el)} />
          ))}
        </span>
      </span>
      <span
        className={cx(styles.sh, styles.shText, styles.timer)}
        ref={(el) => {
          register("timer", el);
          timerRef(el);
        }}
      />
      <span
        className={cx(styles.sh, styles.agentIcon)}
        ref={(el) => register("agentIcon", el)}
      >
        <ClaudeMascot
          status={agent?.status ?? null}
          activity={agent?.activity ?? null}
          activityAt={agent?.activityAt ?? null}
          error={agent?.error ?? false}
          startedAt={agent?.startedAt ?? null}
          reduced={reduced}
        />
      </span>
      <span
        className={cx(styles.sh, styles.dots, !agentWorking && styles.still)}
        ref={(el) => register("dots", el)}
      >
        <i />
        <i />
        <i />
      </span>
      <span
        className={cx(styles.sh, styles.shText, styles.elapsed)}
        ref={(el) => {
          register("elapsed", el);
          elapsedRef(el);
        }}
      />
      <span
        className={cx(styles.sh, styles.shText, styles.count)}
        ref={(el) => register("count", el)}
      >
        {sessions.length}
      </span>
      {segs.map((s, i) => {
        const id = SEG_IDS[i];
        if (!id) return null;
        return (
          <span
            key={id}
            className={cx(styles.sh, styles.seg, segClass(s.status))}
            ref={(el) => register(id, el)}
          />
        );
      })}
      <span
        className={cx(styles.sh, styles.dropIcon)}
        ref={(el) => register("dropIcon", el)}
      >
        <DropIcon />
      </span>
      <span
        className={cx(styles.sh, styles.musicCover)}
        ref={(el) => register("musicCover", el)}
      >
        <MusicCover artworkUrl={artworkUrl} />
      </span>
      <span
        className={cx(styles.sh, styles.eq)}
        ref={(el) => register("musicEq", el)}
      >
        {/* SVG, barres à x entiers (en div, des barres de 2 px tombaient sur des demi-pixels à 125 ou
            150 %). Bouts entièrement arrondis : la boucle écrit y et height (eqBarGeometry), pas un scaleY
            qui écraserait l'arrondi ; pas de crispEdges, qui rendrait l'arrondi en escalier. */}
        <svg
          width={EQ_WIDTH}
          height={EQ_BAR.height}
          viewBox={`0 0 ${EQ_WIDTH} ${EQ_BAR.height}`}
          aria-hidden="true"
        >
          {EQ_INDEXES.map((i) => (
            <rect
              key={i}
              ref={(el) => eqBarRef(i, el)}
              style={eqBarStyle(i)}
              x={i * (EQ_BAR.width + EQ_BAR.gap)}
              y={EQ_START.y}
              width={EQ_BAR.width}
              height={EQ_START.height}
              rx={EQ_BAR.width / 2}
            />
          ))}
        </svg>
      </span>
      <span
        className={cx(styles.sh, styles.progIcon)}
        style={progTone}
        ref={(el) => register("progIcon", el)}
      >
        <IslandIcon name={progVisual.icon} />
      </span>
      <span
        className={cx(styles.sh, styles.progRing)}
        style={progTone}
        ref={(el) => register("progRing", el)}
      >
        <ProgressRing barRef={ringRef} />
      </span>
      <span
        className={cx(styles.sh, styles.shText, styles.progLabel)}
        style={{ maxWidth: progressLabelMaxWidth(platform) }}
        ref={(el) => register("progLabel", el)}
      >
        {progress?.label}
      </span>
      <span
        className={cx(styles.sh, styles.shText)}
        ref={(el) => register("markCount", el)}
      >
        <MarkCount markers={markers} reduced={reduced} />
      </span>
    </div>
  );
}
