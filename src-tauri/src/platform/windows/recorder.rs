//! Orchestration de l'enregistrement : deux threads de capture + un thread de mix/encodage.
//!
//! ```text
//! capture micro ──┐  (Source, Chunk 16 kHz positionné)
//!                 ├──► mixeur (horloge) ──► MP3 ──► fichier
//! capture système ┘
//! ```
//!
//! Le mixeur avance au rythme de l'horloge (moins une marge de 300 ms pour laisser arriver les
//! paquets) : il n'attend jamais une source. Ce qui manque (loopback muet, périphérique débranché)
//! devient du silence.

use super::capture::{self, Ready};
use super::dsp::{to_dbfs, LIVE_LEVELS, TARGET_RATE};
use super::encoder::Mp3Writer;
use super::mixer::{LevelStats, Mixer, Source};
use super::timeline::Chunk;
use crate::platform::{Recorder, RecordingInfo};
use anyhow::{anyhow, bail, Context, Result};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Retard du mix sur l'horloge : laisse le temps aux paquets d'arriver (latence WASAPI + sondage).
const MIX_MARGIN: u64 = (TARGET_RATE as u64 * 3) / 10;
/// Délai maximal d'ouverture d'un périphérique au démarrage.
const START_TIMEOUT: Duration = Duration::from_secs(5);
/// Période des logs de niveau (debug).
const LEVEL_LOG_EVERY: u64 = TARGET_RATE as u64 * 5;

/// Enregistreur Windows : micro + son de l'ordinateur → MP3 mono 16 kHz 32 kb/s.
pub struct WasapiRecorder {
    session: Option<Session>,
}

struct Session {
    path: PathBuf,
    t0: Instant,
    stop: Arc<AtomicBool>,
    captures: Vec<JoinHandle<()>>,
    mixer: JoinHandle<Result<MixOutcome>>,
}

struct MixOutcome {
    samples: u64,
    bytes: u64,
}

impl WasapiRecorder {
    pub fn new() -> Self {
        Self { session: None }
    }

    /// Niveau sonore de l'enregistrement en cours (RMS linéaire, le plus fort des deux sources),
    /// `None` hors enregistrement. Sans verrou ni instance : lisible à haute fréquence.
    pub fn live_level() -> Option<f32> {
        LIVE_LEVELS.current()
    }
}

impl Default for WasapiRecorder {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WasapiRecorder {
    fn drop(&mut self) {
        if self.session.is_some() {
            match self.stop() {
                Ok(info) => log::warn!(
                    "Enregistrement arrêté à la fermeture : {}",
                    info.path.display()
                ),
                Err(err) => log::error!("Arrêt de l'enregistrement à la fermeture : {err:#}"),
            }
        }
    }
}

impl Recorder for WasapiRecorder {
    fn start(&mut self, output: &Path) -> Result<()> {
        if self.session.is_some() {
            bail!("Un enregistrement est déjà en cours");
        }
        let file = File::create(output).with_context(|| {
            format!(
                "Impossible de créer le fichier d'enregistrement {}",
                output.display()
            )
        })?;

        let t0 = Instant::now();
        let stop = Arc::new(AtomicBool::new(false));
        let (data_tx, data_rx) = mpsc::channel::<(Source, Chunk)>();
        let (ready_tx, ready_rx) = mpsc::channel::<Ready>();
        let (mixer_ready_tx, mixer_ready_rx) = mpsc::channel::<std::result::Result<(), String>>();

        let mixer = {
            let stop = stop.clone();
            thread::Builder::new()
                .name("sordulo-mix-mp3".into())
                .spawn(move || run_mixer(file, data_rx, &stop, t0, mixer_ready_tx))
                .context("Impossible de démarrer le thread d'encodage")?
        };

        let mut captures = Vec::new();
        let mut errors = Vec::new();
        for source in [Source::Mic, Source::System] {
            match capture::spawn(source, t0, stop.clone(), data_tx.clone(), ready_tx.clone()) {
                Ok(handle) => captures.push(handle),
                Err(err) => errors.push(format!(
                    "Impossible de démarrer la capture ({}) : {err}",
                    source.label()
                )),
            }
        }
        // Seuls les threads de capture gardent un émetteur : quand ils s'arrêtent, le mixeur termine.
        drop(data_tx);
        drop(ready_tx);

        let deadline = Instant::now() + START_TIMEOUT;
        for _ in 0..captures.len() {
            let wait = deadline.saturating_duration_since(Instant::now());
            match ready_rx.recv_timeout(wait) {
                Ok((source, Ok(device))) => {
                    log::debug!("Enregistrement : {} prêt (« {device} »)", source.label())
                }
                Ok((_, Err(message))) => errors.push(message),
                Err(_) => {
                    errors.push("Les périphériques audio ne répondent pas (délai dépassé)".into());
                    break;
                }
            }
        }
        match mixer_ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => {}
            Ok(Err(message)) => errors.push(message),
            Err(_) => errors.push("L'encodeur MP3 ne répond pas".into()),
        }

        let session = Session {
            path: output.to_path_buf(),
            t0,
            stop,
            captures,
            mixer,
        };
        if !errors.is_empty() {
            // Démarrage raté : on arrête tout et on supprime le fichier vide.
            let _ = session.finish();
            let _ = std::fs::remove_file(output);
            bail!("{}", errors.join(" ; "));
        }

        LIVE_LEVELS.set_active(true);
        log::info!("Enregistrement démarré : {}", output.display());
        self.session = Some(session);
        Ok(())
    }

    fn stop(&mut self) -> Result<RecordingInfo> {
        let session = self
            .session
            .take()
            .ok_or_else(|| anyhow!("Aucun enregistrement en cours"))?;
        let path = session.path.clone();
        LIVE_LEVELS.set_active(false);
        let outcome = session.finish()?;
        let size_bytes = std::fs::metadata(&path)
            .map(|m| m.len())
            .unwrap_or(outcome.bytes);
        let info = RecordingInfo {
            path,
            duration_secs: outcome.samples as f64 / f64::from(TARGET_RATE),
            size_bytes,
            mime_type: "audio/mpeg".into(),
        };
        log::info!(
            "Enregistrement terminé : {} ({:.1} s, {} octets)",
            info.path.display(),
            info.duration_secs,
            info.size_bytes
        );
        Ok(info)
    }

    fn is_recording(&self) -> bool {
        self.session.is_some()
    }

    fn elapsed_secs(&self) -> f64 {
        self.session
            .as_ref()
            .map_or(0.0, |s| s.t0.elapsed().as_secs_f64())
    }

    fn audio_level(&self) -> Option<f32> {
        Self::live_level()
    }
}

impl Session {
    /// Arrête les captures, attend la fin du mix et la fermeture du fichier.
    fn finish(self) -> Result<MixOutcome> {
        self.stop.store(true, Ordering::Relaxed);
        for handle in self.captures {
            if handle.join().is_err() {
                log::error!("Un thread de capture s'est arrêté brutalement");
            }
        }
        self.mixer
            .join()
            .map_err(|_| anyhow!("Le thread d'encodage s'est arrêté brutalement"))?
    }
}

fn clock_pos(t0: Instant) -> u64 {
    (t0.elapsed().as_secs_f64() * f64::from(TARGET_RATE)) as u64
}

/// Boucle du mixeur : reçoit les blocs, mixe jusqu'à « horloge - marge », encode, écrit.
fn run_mixer(
    file: File,
    data: Receiver<(Source, Chunk)>,
    stop: &AtomicBool,
    t0: Instant,
    ready: Sender<std::result::Result<(), String>>,
) -> Result<MixOutcome> {
    let mut writer = match Mp3Writer::new(file) {
        Ok(w) => {
            let _ = ready.send(Ok(()));
            w
        }
        Err(err) => {
            let _ = ready.send(Err(format!("{err:#}")));
            return Err(err);
        }
    };
    let mut mixer = Mixer::new(true);
    let mut stop_pos: Option<u64> = None;
    let mut next_level_log = LEVEL_LOG_EVERY;

    let result = (|| -> Result<()> {
        loop {
            let mut disconnected = false;
            match data.recv_timeout(Duration::from_millis(50)) {
                Ok((source, chunk)) => mixer.push(source, &chunk),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => disconnected = true,
            }
            while let Ok((source, chunk)) = data.try_recv() {
                mixer.push(source, &chunk);
            }

            let now = clock_pos(t0);
            if stop_pos.is_none() && stop.load(Ordering::Relaxed) {
                stop_pos = Some(now);
            }
            if disconnected {
                break;
            }
            let target = now
                .saturating_sub(MIX_MARGIN)
                .min(stop_pos.unwrap_or(u64::MAX));
            mix_until(&mut mixer, &mut writer, target)?;

            if mixer.pos() >= next_level_log {
                next_level_log += LEVEL_LOG_EVERY;
                let (mic, system) = mixer.take_window();
                let (mic_gain, system_gain) = mixer.gains();
                log::debug!(
                    "Niveaux (5 s) : micro {} gain ×{mic_gain:.2} | son de l'ordinateur {} gain ×{system_gain:.2}",
                    describe(&mic),
                    describe(&system),
                );
            }
        }
        // Tout est arrivé : on termine à l'instant de l'arrêt (ou un peu après si une source a
        // livré des données au-delà, dans la limite d'une seconde).
        let stop_at = stop_pos.unwrap_or_else(|| clock_pos(t0));
        let end = stop_at.max(mixer.max_end().min(stop_at + u64::from(TARGET_RATE)));
        mix_until(&mut mixer, &mut writer, end)
    })();

    let (mic, system) = mixer.totals();
    let (mic_secs, system_secs) = mixer.received_secs();
    log::info!(
        "Niveaux de l'enregistrement : micro {} ({mic_secs:.1} s reçues) | son de l'ordinateur {} ({system_secs:.1} s reçues)",
        describe(&mic),
        describe(&system),
    );

    if let Err(err) = result {
        log::error!("Enregistrement interrompu : {err:#}");
        // On ferme quand même proprement ce qui a été écrit.
        let samples = writer.samples();
        if let Err(close_err) = writer.finish() {
            log::error!("Finalisation du fichier impossible : {close_err:#}");
        }
        log::warn!(
            "Fichier partiel : {:.1} s",
            samples as f64 / f64::from(TARGET_RATE)
        );
        return Err(err);
    }
    let samples = writer.samples();
    let bytes = writer.finish()?;
    Ok(MixOutcome { samples, bytes })
}

fn mix_until(mixer: &mut Mixer, writer: &mut Mp3Writer, target: u64) -> Result<()> {
    while mixer.pos() < target {
        let n = (target - mixer.pos()).min(Mixer::BLOCK as u64 * 10) as usize;
        let block = mixer.mix(n);
        writer.write(&block)?;
    }
    Ok(())
}

fn describe(stats: &LevelStats) -> String {
    format!(
        "RMS {:.4} ({:.1} dBFS, crête {:.3})",
        stats.rms(),
        to_dbfs(stats.rms()),
        stats.peak()
    )
}
