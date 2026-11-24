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
import { EQ, EQ_BAR, eqBarGeometry, eqBarStyle } from "./music";

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
  agent: Pick<ClaudeSession, "status" | "activity" | "error" | "startedAt"> | null;
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
  agent,
  reduced,
}: SharedElementsProps) {
  const agentWorking = agent?.status === "working";
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
        <ClaudeMascot
          status={agent?.status ?? null}
          activity={agent?.activity ?? null}
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
    </div>
  );
}
