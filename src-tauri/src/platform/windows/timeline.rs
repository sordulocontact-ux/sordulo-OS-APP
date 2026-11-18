//! Ligne de temps commune aux deux sources.
//!
//! Positions exprimées en échantillons à 16 kHz depuis le début de l'enregistrement, mesurées sur
//! l'horloge du système (`Instant`). Le loopback ne livre AUCUN paquet quand rien ne joue : chaque
//! source place donc ses échantillons d'après l'horloge, et les trous sont remplis de silence au mix.
//!
//! - [`SourcePipeline`] (côté capture) : mono → 16 kHz → position sur la ligne de temps.
//! - [`Track`] (côté mixeur) : tampon positionné ; ce qui manque est lu comme du silence.

use super::dsp::{interleaved_to_mono, MonoResampler, TARGET_RATE};
use anyhow::Result;
use std::collections::VecDeque;

/// Au-delà de ce retard entre l'horloge et la position attendue, on considère qu'il y a eu un trou
/// (loopback muet, périphérique figé) et on se recale sur l'horloge. 200 ms.
const GAP_SAMPLES: f64 = 0.2 * TARGET_RATE as f64;
/// Au-delà de cette avance sur l'horloge (horloge du périphérique plus rapide), on se recale. 1 s.
const AHEAD_SAMPLES: f64 = 1.0 * TARGET_RATE as f64;

/// Bloc d'échantillons mono 16 kHz, placé sur la ligne de temps.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    pub pos: u64,
    pub samples: Vec<f32>,
}

/// Décision de placement d'un paquet.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Placement {
    /// Le paquet suit directement le précédent.
    Continue,
    /// Premier paquet, ou trou / dérive : le paquet commence à cette position.
    Resync(u64),
}

/// Suit la position attendue d'une source et détecte les trous par rapport à l'horloge.
#[derive(Debug, Default)]
struct Placer {
    next: Option<f64>,
}

impl Placer {
    /// `len`: durée du paquet (échantillons 16 kHz) ; `clock_end`: horloge à la réception du paquet.
    fn place(&mut self, len: f64, clock_end: f64) -> Placement {
        let clock_start = (clock_end - len).max(0.0);
        match self.next {
            Some(expected)
                if clock_start - expected <= GAP_SAMPLES
                    && expected - clock_start <= AHEAD_SAMPLES =>
            {
                self.next = Some(expected + len);
                Placement::Continue
            }
            _ => {
                self.next = Some(clock_start + len);
                Placement::Resync(clock_start.round() as u64)
            }
        }
    }
}

/// Chaîne de traitement d'une source : entrelacé → mono → 16 kHz → positions.
pub struct SourcePipeline {
    channels: usize,
    input_rate: u32,
    resampler: MonoResampler,
    placer: Placer,
    /// Position du prochain échantillon émis par le rééchantillonneur.
    cursor: u64,
}

impl SourcePipeline {
    pub fn new(input_rate: u32, channels: usize) -> Result<Self> {
        Ok(Self {
            channels,
            input_rate,
            resampler: MonoResampler::new(input_rate)?,
            placer: Placer::default(),
            cursor: 0,
        })
    }

    /// Traite un paquet entrelacé reçu quand l'horloge valait `clock_end` (échantillons 16 kHz).
    pub fn push(&mut self, interleaved: &[f32], clock_end: f64) -> Result<Vec<Chunk>> {
        let mono = interleaved_to_mono(interleaved, self.channels);
        if mono.is_empty() {
            return Ok(Vec::new());
        }
        let len = mono.len() as f64 * f64::from(TARGET_RATE) / f64::from(self.input_rate);
        let mut chunks = Vec::new();
        if let Placement::Resync(pos) = self.placer.place(len, clock_end) {
            // Ce qui restait dans le rééchantillonneur appartient au passage précédent.
            let tail = self.resampler.flush()?;
            self.emit(tail, &mut chunks);
            self.resampler.reset()?;
            self.cursor = pos;
        }
        let out = self.resampler.process(&mono)?;
        self.emit(out, &mut chunks);
        Ok(chunks)
    }

    /// Fin du flux : vide le rééchantillonneur.
    pub fn finish(&mut self) -> Result<Vec<Chunk>> {
        let mut chunks = Vec::new();
        let tail = self.resampler.flush()?;
        self.emit(tail, &mut chunks);
        Ok(chunks)
    }

    fn emit(&mut self, samples: Vec<f32>, chunks: &mut Vec<Chunk>) {
        if samples.is_empty() {
            return;
        }
        let pos = self.cursor;
        self.cursor += samples.len() as u64;
        chunks.push(Chunk { pos, samples });
    }
}

/// Tampon positionné d'une source, lu par le mixeur au rythme de l'horloge.
///
/// Couvre les positions `[start, start + buf.len())`. `start` avance à chaque lecture : tout ce qui
/// arrive pour une position déjà lue est abandonné (trop tard), tout trou est complété par du silence.
#[derive(Debug, Default)]
pub struct Track {
    start: u64,
    buf: VecDeque<f32>,
    /// Échantillons réellement reçus (hors silence ajouté), pour les statistiques.
    received: u64,
}

impl Track {
    pub fn push(&mut self, pos: u64, samples: &[f32]) {
        let mut pos = pos;
        let mut samples = samples;
        // Trop tard : déjà mixé (comme du silence).
        if pos < self.start {
            let late = (self.start - pos) as usize;
            if late >= samples.len() {
                return;
            }
            samples = &samples[late..];
            pos = self.start;
        }
        let end = self.end();
        if pos < end {
            // Chevauchement (recalage d'horloge) : on garde ce qui est déjà là.
            let overlap = (end - pos) as usize;
            if overlap >= samples.len() {
                return;
            }
            samples = &samples[overlap..];
        } else if pos > end {
            // Trou : silence.
            let len = self.buf.len() + (pos - end) as usize;
            self.buf.resize(len, 0.0);
        }
        self.received += samples.len() as u64;
        self.buf.extend(samples.iter().copied());
    }

    /// Lit `n` échantillons à partir de la position courante ; ce qui manque vaut 0.
    pub fn take(&mut self, n: usize) -> Vec<f32> {
        let available = n.min(self.buf.len());
        let mut out: Vec<f32> = self.buf.drain(..available).collect();
        out.resize(n, 0.0);
        self.start += n as u64;
        out
    }

    /// Première position non couverte.
    pub fn end(&self) -> u64 {
        self.start + self.buf.len() as u64
    }

    pub fn received(&self) -> u64 {
        self.received
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placer_continues_then_resyncs_after_gap() {
        let mut p = Placer::default();
        // Premier paquet de 10 ms reçu à t = 0,5 s.
        assert_eq!(p.place(160.0, 8000.0), Placement::Resync(7840));
        // Paquets suivants avec un peu de gigue : continuité.
        assert_eq!(p.place(160.0, 8170.0), Placement::Continue);
        assert_eq!(p.place(160.0, 8300.0), Placement::Continue);
        // Plus rien pendant 3 s (loopback muet), puis un paquet : recalage sur l'horloge.
        assert_eq!(p.place(160.0, 56_160.0), Placement::Resync(56_000));
        assert_eq!(p.place(160.0, 56_320.0), Placement::Continue);
    }

    #[test]
    fn placer_resyncs_when_far_ahead_of_clock() {
        let mut p = Placer::default();
        assert_eq!(p.place(1600.0, 1600.0), Placement::Resync(0));
        // La source livre des paquets de 100 ms bien plus vite que l'horloge (figée à 0,2 s) :
        // continuité tant que l'avance reste sous 1 s, puis recalage.
        let mut continued = 0;
        loop {
            match p.place(1600.0, 3200.0) {
                Placement::Continue => continued += 1,
                Placement::Resync(pos) => {
                    assert_eq!(pos, 1600);
                    break;
                }
            }
        }
        assert_eq!(continued, 11);
    }

    #[test]
    fn pipeline_places_packets_on_clock_and_fills_gaps() {
        // 16 kHz stéréo : pas de rééchantillonnage, on vérifie seulement le placement.
        let mut pipe = SourcePipeline::new(16_000, 2).unwrap();
        let packet = vec![0.5f32; 320]; // 160 trames stéréo = 10 ms
        let a = pipe.push(&packet, 1600.0).unwrap();
        assert_eq!(
            a,
            vec![Chunk {
                pos: 1440,
                samples: vec![0.5; 160]
            }]
        );
        let b = pipe.push(&packet, 1760.0).unwrap();
        assert_eq!(b[0].pos, 1600);
        // Trou de 2 s.
        let c = pipe.push(&packet, 33_760.0).unwrap();
        assert_eq!(c[0].pos, 33_600);
        assert!(pipe.finish().unwrap().is_empty());
    }

    #[test]
    fn pipeline_resamples_48k() {
        let mut pipe = SourcePipeline::new(48_000, 1).unwrap();
        let mut total = 0usize;
        let mut first_pos = None;
        for i in 1..=100u32 {
            // 10 ms à 48 kHz, reçus toutes les 10 ms.
            for chunk in pipe.push(&[0.1; 480], f64::from(i) * 160.0).unwrap() {
                first_pos.get_or_insert(chunk.pos);
                total += chunk.samples.len();
            }
        }
        for chunk in pipe.finish().unwrap() {
            total += chunk.samples.len();
        }
        assert_eq!(first_pos, Some(0));
        // 1 s → 16 000 échantillons (+ retard du filtre, quelques ms).
        assert!((16_000..16_000 + 800).contains(&total), "total {total}");
    }

    #[test]
    fn track_pads_gaps_and_drops_late_data() {
        let mut t = Track::default();
        t.push(2, &[1.0, 1.0]);
        assert_eq!(t.take(5), vec![0.0, 0.0, 1.0, 1.0, 0.0]);
        // Trop tard pour les positions 3 et 4, la position 5 passe.
        t.push(3, &[2.0, 2.0, 2.0]);
        assert_eq!(t.take(2), vec![2.0, 0.0]);
        // Chevauchement : on garde l'existant.
        t.push(8, &[3.0, 3.0]);
        t.push(9, &[4.0, 4.0]);
        assert_eq!(t.take(5), vec![0.0, 3.0, 3.0, 4.0, 0.0]);
        assert_eq!(t.end(), 12);
        assert_eq!(t.received(), 2 + 1 + 2 + 1);
    }
}
