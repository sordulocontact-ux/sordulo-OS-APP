//! Vrai son de la musique pour l'île : bandes basses → aigus et temps forts, analysés en direct sur le son
//! joué par l'ordinateur, émis à l'île par `desktop://music-levels` (payload `MusicLevels`, ~30 fois par
//! seconde, seulement pendant l'analyse). Sans événement depuis ~400 ms, le front garde sa simulation.
//!
//! - `analysis` (pur, testé) : FFT, 8 bandes, gain automatique, silence, lissage, temps forts.
//! - `tempo` (pur, testé) : période et phase des temps.
//! - `fft` (pur, testé) : FFT radix-2 maison.
//! - Ici : le fil d'analyse et son cycle de vie (seule partie qui touche Tauri et `platform`).
//!
//! Cycle de vie (piloté par `music.rs`, [`set_active`]) : le fil tourne seulement quand l'île montre une
//! musique EN LECTURE du lecteur de l'ordinateur (pas Spotify sur un autre appareil : aucun son ici) et que
//! la case « Afficher la musique dans l'île » est cochée. Pause, arrêt, passage sur Spotify à distance ou
//! case décochée : arrêt, écoute fermée. Écoute impossible : log et nouvel essai après une attente (jamais
//! de boucle rapide) ; non disponible sur ce système (macOS, voir `platform::output_tap`) : plus aucun essai.

mod analysis;
mod fft;
mod tempo;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use analysis::{Analyzer, Frame, BAND_COUNT, FRAMES_PER_SEC};

use crate::events::{EVENT_MUSIC_LEVELS, WINDOW_PROMPT};
use crate::platform::{self, OutputTap, OutputTapUnavailable};
use crate::time::now_ms;

/// Attente avant de rouvrir l'écoute après un échec d'ouverture (aucune sortie audio…).
const OPEN_RETRY: Duration = Duration::from_secs(10);
/// Attente avant de rouvrir l'écoute après une erreur de lecture (périphérique débranché).
const READ_RETRY: Duration = Duration::from_secs(3);
/// Silence continu au-delà duquel l'écoute est rouverte (la sortie par défaut a peut-être changé : casque
/// branché…), au plus une fois par `REOPEN_MIN_INTERVAL`.
const REOPEN_AFTER_SILENCE: Duration = Duration::from_secs(5);
const REOPEN_MIN_INTERVAL: Duration = Duration::from_secs(15);

/// `MusicLevels` du contrat (`src/shared/desktop-contract.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLevels {
    /// 8 bandes 0..1, basses → aigus, gain automatique ; toutes à 0 : silence.
    pub bands: [f32; BAND_COUNT],
    /// Période des temps (ms), `null` sans tempo stable.
    pub beat_period_ms: Option<f64>,
    /// Epoch Unix (ms) du dernier temps, `null` si aucun.
    pub last_beat_at: Option<u64>,
    /// Epoch Unix (ms) de cette trame.
    pub at: u64,
}

impl MusicLevels {
    /// Trame analysée à l'instant `at` (epoch ms, horloge passée à `Analyzer::analyze`). Valeurs arrondies
    /// (bandes au millième, période au dixième de ms) : message plus court, rien de visible perdu.
    pub fn from_frame(frame: &Frame, at: u64) -> Self {
        Self {
            bands: frame.bands.map(|b| (b * 1_000.0).round() / 1_000.0),
            beat_period_ms: frame.beat_period_ms.map(|p| (p * 10.0).round() / 10.0),
            last_beat_at: frame
                .last_beat_at
                .filter(|t| t.is_finite() && *t >= 0.0)
                .map(|t| t.round() as u64),
            at,
        }
    }
}

/// Fil d'analyse en cours (au plus un actif).
struct Worker {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);
/// Écoute non disponible sur ce système : plus aucun essai jusqu'à la fin du processus.
static UNAVAILABLE: AtomicBool = AtomicBool::new(false);

/// Démarre (`true`) ou arrête (`false`) l'analyse. Appelé à chaque tour de la boucle de la musique et quand
/// la case du menu est décochée ; sans effet si l'état demandé est déjà le bon. N'attend jamais le fil.
pub fn set_active(app: &AppHandle, active: bool) {
    let mut worker = WORKER.lock().unwrap_or_else(|e| e.into_inner());
    if !active {
        if let Some(w) = worker.take() {
            // Le fil s'arrête de lui-même dans les ~50 ms et ferme l'écoute.
            w.stop.store(true, Ordering::Relaxed);
            if !w.handle.is_finished() {
                log::info!("analyse du son de la musique arrêtée");
            }
        }
        return;
    }
    if UNAVAILABLE.load(Ordering::Relaxed) {
        return;
    }
    if worker.as_ref().is_some_and(|w| !w.handle.is_finished()) {
        return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_app = app.clone();
    match thread::Builder::new()
        .name("music-levels".into())
        .spawn(move || run(&thread_app, &thread_stop))
    {
        Ok(handle) => {
            log::info!("analyse du son de la musique démarrée");
            *worker = Some(Worker { stop, handle });
        }
        Err(e) => log::error!("impossible de lancer l'analyse du son de la musique : {e}"),
    }
}

/// Fin d'une période d'écoute.
enum Exit {
    Stopped,
    /// Long silence : rouvrir l'écoute (sortie par défaut peut-être changée).
    Reopen,
}

fn run(app: &AppHandle, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        let mut tap = match platform::output_tap() {
            Ok(tap) => tap,
            Err(e) if e.is::<OutputTapUnavailable>() => {
                log::info!("{e}");
                UNAVAILABLE.store(true, Ordering::Relaxed);
                return;
            }
            Err(e) => {
                log::warn!(
                    "analyse de la musique : {e:#} ; nouvel essai dans {} s",
                    OPEN_RETRY.as_secs()
                );
                sleep_unless_stopped(OPEN_RETRY, stop);
                continue;
            }
        };
        let outcome = listen(app, tap.as_mut(), stop);
        // Écoute fermée avant toute attente.
        drop(tap);
        match outcome {
            Ok(Exit::Stopped) => return,
            Ok(Exit::Reopen) => {
                log::debug!("analyse de la musique : long silence, écoute rouverte sur la sortie par défaut")
            }
            Err(e) => {
                log::warn!(
                    "analyse de la musique interrompue : {e:#} ; nouvel essai dans {} s",
                    READ_RETRY.as_secs()
                );
                sleep_unless_stopped(READ_RETRY, stop);
            }
        }
    }
}

/// Lit, analyse et émet ~30 fois par seconde jusqu'à l'arrêt, une erreur de lecture ou un long silence.
fn listen(app: &AppHandle, tap: &mut dyn OutputTap, stop: &AtomicBool) -> anyhow::Result<Exit> {
    let rate = tap.sample_rate();
    let mut analyzer = Analyzer::new(rate);
    // Tampon réutilisé (≈ 1 s de marge) : pas d'allocation par trame.
    let mut samples: Vec<f32> = Vec::with_capacity(rate as usize);
    let period = Duration::from_micros(1_000_000 / u64::from(FRAMES_PER_SEC));
    let opened = Instant::now();
    let mut silent_since: Option<Instant> = None;
    let mut emit_failed = false;
    let mut next = Instant::now();
    log::debug!("analyse de la musique : {rate} Hz");
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(Exit::Stopped);
        }
        samples.clear();
        tap.read(&mut samples)?;
        analyzer.push(&samples);
        let at = now_ms();
        let frame = analyzer.analyze(at as f64);
        if frame.beat {
            log::trace!("analyse de la musique : temps fort");
        }
        let levels = MusicLevels::from_frame(&frame, at);
        match app.emit_to(WINDOW_PROMPT, EVENT_MUSIC_LEVELS, &levels) {
            Ok(()) => emit_failed = false,
            Err(e) => {
                if !emit_failed {
                    log::debug!("émission de {EVENT_MUSIC_LEVELS} impossible : {e}");
                }
                emit_failed = true;
            }
        }

        let now = Instant::now();
        if frame.silent {
            let since = *silent_since.get_or_insert(now);
            if now.duration_since(since) >= REOPEN_AFTER_SILENCE
                && now.duration_since(opened) >= REOPEN_MIN_INTERVAL
            {
                return Ok(Exit::Reopen);
            }
        } else {
            silent_since = None;
        }

        // Cadence régulière ; en retard (machine chargée) : on repart de maintenant, sans rattrapage.
        next += period;
        match next.checked_duration_since(now) {
            Some(wait) => thread::sleep(wait),
            None => next = now,
        }
    }
}

fn sleep_unless_stopped(total: Duration, stop: &AtomicBool) {
    let start = Instant::now();
    while start.elapsed() < total && !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trame_arrondie_pour_le_contrat() {
        let frame = Frame {
            bands: [0.123_456, 1.0, 0.0, 0.5, 0.25, 0.75, 0.999_9, 0.000_4],
            beat_period_ms: Some(499.987),
            last_beat_at: Some(1_790_000_000_123.4),
            silent: false,
            beat: true,
        };
        let levels = MusicLevels::from_frame(&frame, 1_790_000_000_150);
        assert_eq!(levels.bands, [0.123, 1.0, 0.0, 0.5, 0.25, 0.75, 1.0, 0.0]);
        assert_eq!(levels.beat_period_ms, Some(500.0));
        assert_eq!(levels.last_beat_at, Some(1_790_000_000_123));
        assert_eq!(levels.at, 1_790_000_000_150);
        let none = MusicLevels::from_frame(
            &Frame {
                beat_period_ms: None,
                last_beat_at: None,
                ..frame
            },
            1,
        );
        assert_eq!((none.beat_period_ms, none.last_beat_at), (None, None));
    }

    /// Diagnostic manuel, avec de la musique qui joue sur l'ordinateur :
    /// `cargo test --lib print_music_levels -- --ignored --nocapture` (dans `src-tauri/`).
    /// Capture 3 s du son de l'ordinateur et affiche les bandes et le tempo ~3 fois par seconde.
    /// macOS : affiche « non disponible » (volontaire, voir `platform::output_tap`).
    #[test]
    #[ignore]
    fn print_music_levels() {
        crate::logging::init();
        let mut tap = match platform::output_tap() {
            Ok(tap) => tap,
            Err(e) => {
                println!("écoute impossible : {e:#}");
                return;
            }
        };
        let rate = tap.sample_rate();
        println!("écoute ouverte : {rate} Hz");
        let mut analyzer = Analyzer::new(rate);
        let mut samples = Vec::new();
        let period = Duration::from_micros(1_000_000 / u64::from(FRAMES_PER_SEC));
        let frames = 3 * FRAMES_PER_SEC;
        let mut beats = 0;
        for i in 0..frames {
            samples.clear();
            if let Err(e) = tap.read(&mut samples) {
                println!("lecture impossible : {e:#}");
                return;
            }
            analyzer.push(&samples);
            let at = now_ms();
            let frame = analyzer.analyze(at as f64);
            beats += usize::from(frame.beat);
            if i % 10 == 9 {
                let levels = MusicLevels::from_frame(&frame, at);
                let bars: String = levels
                    .bands
                    .iter()
                    .map(|b| {
                        [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'][(b * 8.0).round() as usize]
                    })
                    .collect();
                println!(
                    "[{bars}] {:?} silence={} tempo={} dernier temps il y a {}",
                    levels.bands,
                    frame.silent,
                    levels
                        .beat_period_ms
                        .map_or("aucun".to_owned(), |p| format!(
                            "{p} ms ({:.0} bpm)",
                            60_000.0 / p
                        )),
                    levels
                        .last_beat_at
                        .map_or("-".to_owned(), |t| format!("{} ms", at.saturating_sub(t))),
                );
            }
            thread::sleep(period);
        }
        println!("{beats} temps détectés en 3 s");
    }
}
