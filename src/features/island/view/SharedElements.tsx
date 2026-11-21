/**
 * Éléments partagés (prototype : .shared / .sh) : ils glissent d'un état à l'autre au lieu de disparaître.
 * Le moteur écrit leur position, leur opacité et la taille de l'icône Claude et de la pochette ; la boucle
 * écrit le minuteur, le temps écoulé, la hauteur des barres de l'onde et de l'égaliseur.
 */
import { MAX_SESSION_ROWS, WAVE, type SharedElementId } from "../geometry";
import type { CallService } from "../../../shared/desktop-contract";
import type { ClaudeSession, ClaudeSessionStatus } from "../types";
import { cx } from "./cx";
import { ClaudeMascot } from "./ClaudeMascot";
import { CallIcon, DropIcon, MusicCover } from "./icons";
import styles from "./Island.module.css";
import { EQ, eqBarStyle } from "./music";

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
/** Égaliseur (unités SVG = px CSS) : barres de 2, espacées de 1, hautes de 14 (23 × 14 pour 8 barres). */
const EQ_BAR_WIDTH = 2;
const EQ_BAR_GAP = 1;
const EQ_HEIGHT = 14;
const EQ_WIDTH = EQ.bars * EQ_BAR_WIDTH + (EQ.bars - 1) * EQ_BAR_GAP;

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
  /** La session Claude affichée travaille : le Claude de l'île s'anime. */
  agentWorking: boolean;
  reduced: boolean;
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
  agentWorking,
  reduced,
}: SharedElementsProps) {
  const segs = sessions.slice(0, MAX_SESSION_ROWS);
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
        <ClaudeMascot working={agentWorking} reduced={reduced} />
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
        {/* SVG à bords nets : chaque barre se cale sur les pixels de l'écran (à 125 ou 150 %, des barres
            de 2 px en div tombaient sur des demi-pixels et laissaient des traits clairs sur leurs bords). */}
        <svg
          width={EQ_WIDTH}
          height={EQ_HEIGHT}
          viewBox={`0 0 ${EQ_WIDTH} ${EQ_HEIGHT}`}
          shapeRendering="crispEdges"
          aria-hidden="true"
        >
          {EQ_INDEXES.map((i) => (
            <rect
              key={i}
              ref={(el) => eqBarRef(i, el)}
              style={eqBarStyle(i)}
              x={i * (EQ_BAR_WIDTH + EQ_BAR_GAP)}
              y={0}
              width={EQ_BAR_WIDTH}
              height={EQ_HEIGHT}
            />
          ))}
        </svg>
      </span>
    </div>
  );
}
