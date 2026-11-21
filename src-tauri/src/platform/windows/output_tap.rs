//! Écoute du son joué par l'ordinateur pour l'analyse de la musique de l'île (`music_levels`).
//!
//! Loopback WASAPI du périphérique de SORTIE par défaut, en mode partagé : même ouverture que le son de
//! l'ordinateur de l'enregistrement des appels (`capture::Stream::open(Source::System)`), sans autorisation
//! ni voyant. Un second flux loopback en parallèle de l'enregistrement est permis en mode partagé :
//! l'enregistrement n'est pas touché (ni son flux, ni ses niveaux `LIVE_LEVELS`).
//!
//! Lecture non bloquante par l'appelant (sondage), flottants 32 bits convertis en mono (`dsp::append_mono`),
//! tampons réutilisés : aucune allocation par lecture une fois la capacité atteinte.

use super::capture::{append_f32, Stream};
use super::dsp::append_mono;
use super::mixer::Source;
use crate::platform::OutputTap;
use anyhow::{Context, Result};
use std::collections::VecDeque;

/// COM (MTA) du thread qui ouvre l'écoute, libéré APRÈS les objets WASAPI (dernier champ de [`LoopbackTap`]).
struct ComGuard(bool);

impl ComGuard {
    fn init() -> Self {
        Self(wasapi::initialize_mta().is_ok())
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            wasapi::deinitialize();
        }
    }
}

/// Loopback de la sortie par défaut. À utiliser sur le thread qui l'a ouvert (objets COM).
pub struct LoopbackTap {
    stream: Stream,
    bytes: VecDeque<u8>,
    interleaved: Vec<f32>,
    // Dernier champ : libéré après le flux.
    _com: ComGuard,
}

impl LoopbackTap {
    pub fn open() -> Result<Self> {
        let com = ComGuard::init();
        let stream = Stream::open(Source::System).context("écoute du son de l'ordinateur")?;
        stream
            .client
            .start_stream()
            .context("démarrage de l'écoute du son de l'ordinateur")?;
        log::debug!(
            "écoute du son de l'ordinateur pour l'île : « {} » ({} Hz, {} canal(aux))",
            stream.device_name,
            stream.rate,
            stream.channels
        );
        Ok(Self {
            stream,
            bytes: VecDeque::with_capacity(64 * 1024),
            interleaved: Vec::with_capacity(16 * 1024),
            _com: com,
        })
    }
}

impl OutputTap for LoopbackTap {
    fn sample_rate(&self) -> u32 {
        self.stream.rate
    }

    fn read(&mut self, out: &mut Vec<f32>) -> Result<()> {
        self.stream
            .read_available(&mut self.bytes)
            .context("lecture du son de l'ordinateur (périphérique débranché ou changé ?)")?;
        if self.bytes.is_empty() {
            return Ok(());
        }
        self.interleaved.clear();
        append_f32(&mut self.interleaved, self.bytes.make_contiguous());
        self.bytes.clear();
        append_mono(&self.interleaved, self.stream.channels, out);
        Ok(())
    }
}

impl Drop for LoopbackTap {
    fn drop(&mut self) {
        let _ = self.stream.client.stop_stream();
        log::debug!("écoute du son de l'ordinateur pour l'île fermée");
    }
}
