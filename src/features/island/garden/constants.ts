/**
 * Grandeurs de la simulation du jardin des Claude (prototype design/prototypes/ile-sordulo-os.html, script du
 * jardin, lignes ~960-1380). Comme geometry.ts pour l'île : ce sont des cibles d'animation lues par le moteur
 * (garden/simulation.ts), pas des styles. Couleurs, tailles des effets, polices et durées des animations CSS :
 * section « Île / Jardin » de src/styles/tokens.css.
 *
 * Unités : px CSS, secondes, px/s (vitesses), px/s² (gravité). Une probabilité « par seconde » p s'applique
 * à chaque image sous la forme `random() < dt * p`, comme dans le prototype.
 */
import type { IslandPlatform } from '../types'

/** Intervalle [min, max] tiré au hasard (prototype : rnd(a, b)). */
export type Range = readonly [number, number]

/** Types d'interaction entre deux Claude (prototype : IA_TYPES, GAP, DUR). */
export type InteractionType =
  | 'check'
  | 'talk'
  | 'kiss'
  | 'hug'
  | 'fight'
  | 'annoyed'
  | 'conflict'
  | 'handoff'
  | 'comfort'
  | 'queue'
  | 'dance'
  | 'whisper'
  | 'apology'
  | 'race'

export const GARDEN = {
  /** Un personnage par session, 5 au plus (comme les 5 lignes de multiOpen). */
  maxSessions: 5,
  /** Sous-agents affichés par session (le prototype en montre 0 à 2). */
  maxSubagents: 3,

  /** Taille des personnages (px, carrés) : session, sous-agent. */
  size: { main: 22, sub: 13 },
  /** Hauteur du sol au-dessus du bas de la forme (prototype : gOff). */
  groundOffset: { win: 6, mac: 5 } satisfies Record<IslandPlatform, number>,
  /** Bas des pieds dans le sprite (transform-origin 50% 81%) et haut de la tête (on se pose à 62 %). */
  footRatio: 0.81,
  headRatio: 0.62,

  // --- Apparition -------------------------------------------------------------------------------------------
  /** Dispersion autour de la place de départ de chaque session (prototype : ±18 px). */
  startJitter: 18,
  /** Délai d'apparition : base + i × pas (session), base + k × pas + i × pas parent (sous-agent). */
  appearDelay: { main: 0.25, mainStep: 0.14, sub: 1, subStep: 0.2, subParentStep: 0.1 },
  /** Échelle de départ (grandit vers 1) et vitesse de fondu / de croissance. */
  appearScale: 0.2,
  fadeInRate: 4,
  subFadeOutRate: 3,
  leaveFadeRate: 4,
  growRate: 10,
  /** Sous-agents en mouvement réduit : rangés à droite du parent (16 px puis 14 px d'écart). */
  reducedSubOffset: 16,
  reducedSubGap: 14,
  /** Sous-agent qui naît : écart au parent (±30 px). */
  subSpawnSpread: 30,
  /** Nouvelle session (prototype : hello) : tombe de 28 px, échelle 0,4, les autres l'accueillent 0,9 s. */
  hello: { y: 28, scale: 0.4, margin: 20, cheer: 0.9 },
  /** Fin de session : les autres se tournent vers lui et sautent 1,6 s (prototype : celebrate). */
  celebrateCheer: 1.6,
  /** Réveil d'une sieste : petit saut. */
  wakeJump: 90,

  // --- Marche (prototype : mainStep) ------------------------------------------------------------------------
  walkSpeed: { main: [12, 20] as Range, sub: [50, 75] as Range },
  /** Facteurs de vitesse : pendant un appel, en bouderie. */
  callSlowdown: 0.5,
  sulkSlowdown: 0.6,
  /** Pause : probabilité par seconde, durée, chance de repartir dans l'autre sens. */
  pauseRate: 0.08,
  pauseDuration: [1, 2.6] as Range,
  pauseTurnChance: 0.35,
  /** Petit saut spontané : probabilité par seconde, vitesse verticale. */
  hopRate: 0.12,
  hopSpeed: 75,
  /** Saut pendant une fête : probabilité par seconde, vitesse verticale. */
  cheerHopRate: 5,
  cheerHopSpeed: 70,
  /** Rendez-vous (relais, aide, file, excuses) et conflit : vitesse d'approche, distance de rencontre. */
  meetSpeed: 50,
  meetDistance: 22,
  conflictSpeed: 55,
  conflictDistance: 24,
  /** Deux Claude qui se croisent : distance (entre 10 et 26 px) ; temps de repos avant la prochaine rencontre. */
  crossDistance: [10, 26] as Range,
  cooldown: [6, 10] as Range,
  initialCooldown: 2,
  /** Même sens : distance devant (4 à 16 px), probabilité par seconde, chance de saute-mouton (sinon course). */
  followDistance: [4, 16] as Range,
  followRate: 0.8,
  leapChance: 0.55,
  leap: { duration: 0.55, speed: 75, jump: 115, cooldown: [5, 8] as Range },
  raceCooldown: [6, 10] as Range,

  // --- Sous-agents (prototype : subStep) ---------------------------------------------------------------------
  sub: {
    /** Retour au parent quand le sous-agent a fini, saut dans ses bras. */
    homeSpeed: 120,
    homeDistance: 5,
    homeJump: 120,
    homeFollow: 10,
    /** Rebond du parent qui le reçoit. */
    parentCatch: 45,
    /** Disparition / réapparition ailleurs. */
    blinkRate: 0.05,
    blinkDuration: 0.25,
    blinkFade: 7,
    blinkMargin: 10,
    /** Perché sur le parent ou un frère : durée, saut pour descendre. */
    ride: [1.2, 2.2] as Range,
    rideJumpOff: 95,
    /** Va rejoindre la pile : vitesse, temps maximum, distance pour sauter, sauts (parent, frère). */
    seekSpeed: 110,
    seekTime: 4,
    seekDistance: 6,
    jumpOnParent: 150,
    jumpOnSibling: 190,
    jumpOnFollow: 8,
    /** Chance par seconde de grimper : sur le parent, sur un frère déjà perché (pyramide). */
    climbRate: 0.08,
    stackRate: 0.35,
    /** Zigzag : nouveau cap toutes les 0,5 à 1,4 s, nouvelle vitesse. */
    zigzag: [0.5, 1.4] as Range,
    zigzagSpeed: [45, 85] as Range,
    firstTurn: [0.4, 1.2] as Range,
    /** Petits sauts : probabilité par seconde (pendant un appel : réduite), vitesse. */
    hopRate: 0.9,
    callHopRate: 0.15,
    hopSpeed: [70, 110] as Range,
  },

  // --- Physique ----------------------------------------------------------------------------------------------
  gravity: { main: 380, sub: 520 },
  /**
   * Chute quand l'île s'ouvre sous eux (le sol descend) : chute libre bien plus forte que celle des petits
   * sauts, qui accélère franchement, puis petit rebond à l'atterrissage (px/s).
   */
  fall: { gravity: 1900, bounce: 70, bounceAbove: 220 },
  /** dt maximal d'une image de simulation (s) : un onglet qui revient ne fait pas de bond. */
  maxDt: 0.05,

  // --- Rendu (prototype : renderGarden) ----------------------------------------------------------------------
  /** Balancement de la marche : fréquence (rad/s) et amplitude (px) ; pendant un appel : 0,5 px. */
  bob: { mainFreq: 7, subFreq: 18, amplitude: 1.2, callAmplitude: 0.5, musicAmplitude: 2 },
  /** Tempo de la musique (battements par minute) : hochement de tête des Claude et battement de l'égaliseur. */
  musicTempoBpm: 116,
  /** Accroupi (bloqué, assis en file) : échelle horizontale et verticale. */
  squash: { x: 1.08, y: 0.8 },
  /** Session en pause : personnage estompé. */
  idleOpacity: 0.45,
  /** Paupières (% de la hauteur) : fermées, mi-closes. */
  lidClosed: 12.5,
  lidHalf: 6.25,
  /** Clignement des yeux : durée, intervalle (session, sous-agent), premier clignement. */
  blink: { duration: 0.14, main: [2.5, 6] as Range, sub: [1.5, 4] as Range, first: [1, 5] as Range },
  /** Sieste : allongé à -90°, vitesse de bascule, « z » par seconde. */
  sleep: { angle: -90, rate: 4, zRate: 1.1, standRate: 10 },

  // --- Effets (prototype : fx, say, showSpark) ---------------------------------------------------------------
  /** Durée de vie des effets (s) : identique aux animations CSS des tokens --island-garden-duration-*. */
  fxLife: { say: 0.85, heart: 1.1, smallHeart: 1, steam: 0.8, star: 0.5, z: 1.2, note: 1, spark: 0.6, cloud: 2, paper: 3 },
  /** Étincelle : hauteur au-dessus du sol par défaut (px). */
  sparkLift: 26,
  /** Notes de musique (hors périmètre, gardé pour le scénario E) : par seconde. */
  noteRate: 0.9,

  // --- Interactions (prototype : IA_TYPES, GAP, DUR) ---------------------------------------------------------
  /** Tirage d'une interaction quand deux Claude se croisent (talk compte double). */
  interactionTypes: ['check', 'talk', 'talk', 'kiss', 'hug', 'fight', 'annoyed', 'dance', 'whisper'] as const,
  /** Pendant un appel : discussion (60 %) ou chuchotement. Avec de la musique : danse une fois sur deux. */
  callTalkChance: 0.6,
  musicDanceChance: 0.5,
  /** Écart entre les deux pendant l'interaction (px). */
  gap: {
    check: 18,
    talk: 20,
    kiss: 13,
    hug: 10,
    fight: 0,
    annoyed: 22,
    conflict: 20,
    handoff: 18,
    comfort: 14,
    queue: 16,
    dance: 16,
    whisper: 10,
    apology: 14,
    race: 0,
  } satisfies Record<InteractionType, number>,
  /** Durée de l'interaction (s). */
  duration: {
    check: 0.9,
    talk: 2.6,
    kiss: 1.4,
    hug: 2,
    fight: 2,
    annoyed: 2,
    conflict: 6.2,
    handoff: 1.6,
    comfort: 2.6,
    queue: 4,
    dance: 2.4,
    whisper: 1.6,
    apology: 1.9,
    race: 1.6,
  } satisfies Record<InteractionType, number>,
  /** Mise en place face à face : vitesse de rapprochement. */
  placeRate: 6,
  /** Après une bagarre : chance qu'il boude (5 s), que l'autre revienne s'excuser 2,5 s plus tard. */
  fightSulkChance: 0.6,
  sulk: { duration: 5, cooldown: 9, apologyWait: 2.5 },

  // --- Événements spontanés (ajout : le prototype les déclenche par des boutons) ------------------------------
  /** Passage de relais ou file d'attente entre deux sessions qui travaillent, toutes les 14 à 28 s. */
  ambientEvery: [14, 28] as Range,
} as const

/** Couleur de chaque session (tokens, dans l'ordre d'arrivée) ; les sous-agents prennent celle du parent. */
export const GARDEN_COLOR_TOKENS = [
  '--island-garden-color-1',
  '--island-garden-color-2',
  '--island-garden-color-3',
  '--island-garden-color-4',
  '--island-garden-color-5',
] as const

/** En colère (conflit, énervé) et rougissant (chuchotement). */
export const GARDEN_ANGRY_TOKEN = '--island-garden-angry'
export const GARDEN_BLUSH_TOKEN = '--island-garden-blush'
