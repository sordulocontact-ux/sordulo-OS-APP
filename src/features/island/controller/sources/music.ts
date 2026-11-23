/**
 * Source « musique » : ce que joue l'ordinateur (lecteur du système, lu par Rust) → activité `music` et
 * `view.music` (pochette, couleurs, titre, artiste, position), et gestes du lecteur.
 *
 * - Lecture initiale (`getMusic`), puis événements desktop://music (envoyés au changement seulement).
 * - En lecture : activité `{ id: 'music', kind: 'music' }` (rang 4, derrière appel, progression et Claude ;
 *   dans la bulle quand une autre activité est principale), `view.music` à jour.
 * - En pause : l'île garde la musique (`playing: false`) MUSIC_PAUSE_LINGER_MS, puis la range. Une reprise
 *   dans ce délai annule le minuteur ; des pauses répétées ne le relancent pas. Un morceau déjà en pause
 *   (au démarrage, ou après le délai) n'est pas montré tant qu'il ne rejoue pas.
 * - `null` (rien ne joue, ou musique coupée dans le menu du soleil) : activité retirée, `view.music = null`.
 * - Pochette : à chaque nouvel `artworkId`, octets lus par `getMusicArtwork` → Blob → URL blob: (l'ancienne
 *   est révoquée, comme à l'arrêt), puis couleurs tirées de l'image (../../music). Une réponse arrivée après
 *   un autre changement ou après l'arrêt est ignorée. Erreur : pas de pochette (dégradé par défaut).
 * - `canControl` faux (Spotify sur un autre appareil sans Premium) : précédent, lecture / pause et suivant ne
 *   font rien (pas de mise à jour immédiate non plus) ; le lecteur au premier plan (`open`) reste possible.
 * - Geste `onMusicCommand` (précédent, lecture / pause, suivant, lecteur au premier plan) : commande Rust.
 *   Lecture / pause change l'île tout de suite (position figée en pause) ; l'événement Rust suivant fait foi,
 *   et un échec de la commande rend l'état d'avant.
 * - Vrai son (Windows, desktop://music-levels, environ 30 par seconde pendant la musique du PC) : la dernière
 *   analyse est gardée dans un lecteur stable (`view.musicLevels`, posé UNE fois au démarrage) que la boucle
 *   de l'île et le jardin lisent à chaque image. Aucun patch du rendu par analyse (pas de rendu React à
 *   30 Hz). `get(now)` renvoie null si la musique n'est pas montrée ou si l'analyse a plus de
 *   MUSIC_LEVELS_STALE_MS (macOS, Spotify sur un autre appareil, analyse arrêtée) : égaliseur et hochement
 *   simulés.
 * - Tempo du morceau (`tempoBpm`, trouvé par Rust chez Deezer) : `tempoPhase(now)` du même lecteur donne la
 *   phase des temps d'après la position, pour le hochement et l'égaliseur quand le vrai son n'en donne pas
 *   (musique sur le téléphone, macOS). null en pause, sans tempo, ou musique non montrée.
 * - Mode concentration : il ne touche à aucune activité (il ne fait qu'attendre la fin de l'appel pour les
 *   notifications, voir la coordination), donc rien de particulier pour la musique.
 */
import type { MusicCommand, MusicLevels, MusicState } from '../../../../shared/desktop-contract'
import type { TimerId } from '../../coordinator/clock'
import { imageMimeType } from '../../music/artwork'
import type { IslandMusic, MusicLevelsReader, MusicPalette } from '../../types'
import { musicTempoPhase } from '../../view/music'
import type { IslandSource } from '../source'
import { listen } from './listen'

/** Id de l'activité musique. */
export const MUSIC_ACTIVITY_ID = 'music'
/** En pause, l'île garde la musique ce temps avant de se ranger (décision de Maël). */
export const MUSIC_PAUSE_LINGER_MS = 10_000
/** Au-delà de cet âge (ms, d'après `at`), l'analyse du vrai son est périmée : retour à la simulation. */
export const MUSIC_LEVELS_STALE_MS = 400

/** Accès de la source (Tauri, URL blob:, canvas), remplacés par des faux en test. */
export interface MusicSourceDeps {
  getMusic: () => Promise<MusicState | null>
  onMusic: (handler: (state: MusicState | null) => void) => Promise<() => void>
  /** Vrai son (Windows) : bandes et temps, environ 30 par seconde pendant la musique du PC. */
  onMusicLevels: (handler: (levels: MusicLevels) => void) => Promise<() => void>
  getMusicArtwork: (args: { artworkId: string }) => Promise<ArrayBuffer>
  musicCommand: (args: { command: MusicCommand }) => Promise<void>
  /** Couleurs d'une pochette (URL blob:) ; navigateur : ../../music/artwork.ts. */
  paletteFromImageUrl: (url: string) => Promise<MusicPalette | null>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

export function createMusicSource(deps: MusicSourceDeps): IslandSource {
  return {
    id: 'musique',
    start(ctx) {
      /** Dernier état reçu (null : rien ne joue). */
      let current: MusicState | null = null
      /** Musique montrée par l'île (activité présente). */
      let shown = false
      let pauseTimer: TimerId | null = null
      // Pochette : id demandé, URL blob: et couleurs obtenues ; `artworkToken` invalide les réponses périmées.
      let artworkId: string | null = null
      let artworkUrl: string | null = null
      let palette: MusicPalette | null = null
      let artworkToken = 0
      /** Dernière analyse du vrai son (null : aucune, ou effacée à l'arrêt de la musique). */
      let levels: MusicLevels | null = null

      // Lecteur stable donné une fois au rendu : lu à chaque image, hors React.
      const levelsReader: MusicLevelsReader = {
        get(nowMs) {
          if (!shown || levels === null || ctx.isDisposed()) return null
          return nowMs - levels.at > MUSIC_LEVELS_STALE_MS ? null : levels
        },
        tempoPhase(nowMs) {
          if (!shown || current === null || ctx.isDisposed()) return null
          return musicTempoPhase(current, nowMs)
        },
      }
      ctx.view.patch({ musicLevels: levelsReader })

      function clearPauseTimer(): void {
        if (pauseTimer !== null) ctx.clock.clearTimeout(pauseTimer)
        pauseTimer = null
      }

      function releaseArtwork(): void {
        artworkToken++
        if (artworkUrl !== null) deps.revokeObjectURL(artworkUrl)
        artworkId = null
        artworkUrl = null
        palette = null
      }

      function publish(): void {
        if (!shown || current === null) return
        const music: IslandMusic = {
          title: current.title,
          artist: current.artist,
          album: current.album,
          appName: current.appName,
          playing: current.playing,
          positionMs: current.positionMs,
          durationMs: current.durationMs,
          positionAt: current.positionAt,
          artworkUrl,
          palette,
          canControl: current.canControl !== false,
        }
        ctx.view.patch({ music })
      }

      function hide(): void {
        clearPauseTimer()
        shown = false
        ctx.coordinator.removeActivity(MUSIC_ACTIVITY_ID)
        ctx.view.patch({ music: null })
      }

      function loadArtwork(id: string | null): void {
        if (id === artworkId) return
        releaseArtwork()
        artworkId = id
        if (id === null) return
        const token = artworkToken
        const stale = () => ctx.isDisposed() || token !== artworkToken
        deps
          .getMusicArtwork({ artworkId: id })
          .then((bytes) => {
            if (stale()) return
            artworkUrl = deps.createObjectURL(new Blob([bytes], { type: imageMimeType(bytes) }))
            publish()
            deps
              .paletteFromImageUrl(artworkUrl)
              .then((colors) => {
                if (stale()) return
                palette = colors
                publish()
              })
              .catch((e: unknown) => {
                if (!stale()) console.warn('[île] couleurs de la pochette :', e)
              })
          })
          .catch((e: unknown) => {
            if (stale()) return
            console.warn('[île] pochette :', e)
            artworkUrl = null
            publish()
          })
      }

      function apply(state: MusicState | null): void {
        current = state
        if (state === null) {
          hide()
          releaseArtwork()
          levels = null
          return
        }
        if (state.playing) {
          clearPauseTimer()
          shown = true
          if (!ctx.coordinator.getActivity(MUSIC_ACTIVITY_ID)) {
            ctx.coordinator.addActivity({ id: MUSIC_ACTIVITY_ID, kind: 'music' })
          }
        } else if (!shown) {
          // Déjà en pause au démarrage, ou après le délai : rien à montrer tant qu'il ne rejoue pas.
          return
        } else if (pauseTimer === null) {
          pauseTimer = ctx.clock.setTimeout(() => {
            pauseTimer = null
            if (!ctx.isDisposed()) hide()
          }, MUSIC_PAUSE_LINGER_MS)
        }
        loadArtwork(state.artworkId)
        publish()
      }

      /**
       * Geste lecture / pause : l'île change tout de suite, sans attendre le sondage Rust (environ 1 s), avec
       * les règles d'un vrai événement (pause : minuteur ; reprise : minuteur annulé). En pause, la position
       * est figée à maintenant ; à la reprise, elle repart de maintenant. L'événement Rust suivant fait foi.
       * Renvoie l'état d'avant et l'état local (null : aucune musique montrée).
       */
      function togglePlaying(): { before: MusicState; next: MusicState } | null {
        const before = current
        if (!shown || before === null) return null
        const now = ctx.clock.now()
        let positionMs = before.positionMs
        if (before.playing && positionMs !== null) {
          positionMs += Math.max(0, now - before.positionAt)
          if (before.durationMs !== null) positionMs = Math.min(positionMs, before.durationMs)
        }
        const next: MusicState = { ...before, playing: !before.playing, positionMs, positionAt: now }
        apply(next)
        return { before, next }
      }

      let changed = false
      const stop = listen(ctx, deps.onMusic, (state) => {
        changed = true
        apply(state)
      })
      // Pas de patch du rendu ici : la boucle lit `levelsReader` à chaque image.
      const stopLevels = listen(ctx, deps.onMusicLevels, (next) => {
        levels = next
      })
      deps
        .getMusic()
        .then((state) => {
          // Un événement reçu entre-temps est plus récent que la lecture.
          if (!ctx.isDisposed() && !changed) apply(state)
        })
        .catch((e: unknown) => console.warn('[île] musique :', e))

      return {
        dispose() {
          stop()
          stopLevels()
          levels = null
          clearPauseTimer()
          releaseArtwork()
        },
        gestures: {
          onMusicCommand(command) {
            // Spotify sur un autre appareil sans Premium : aucune commande possible (seul « open » reste).
            if (command !== 'open' && current?.canControl === false) return
            const toggle = command === 'playPause' ? togglePlaying() : null
            deps.musicCommand({ command }).catch((e: unknown) => {
              console.warn('[île] commande du lecteur :', e)
              // Retour à l'état d'avant, sauf si un événement Rust l'a déjà remplacé.
              if (toggle && !ctx.isDisposed() && current === toggle.next) apply(toggle.before)
            })
          },
        },
      }
    },
  }
}
