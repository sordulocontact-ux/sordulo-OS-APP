//! Mix du micro et du son de l'ordinateur.
//!
//! - Chaque source passe par un niveau automatique LENT et BORNÉ ([`Leveler`]) : un micro faible
//!   est remonté (au plus ×3), le son de l'ordinateur est remonté (au plus ×4, il dépend du volume
//!   Windows) ou baissé (au plus ÷2), pour qu'aucune des deux voix n'écrase l'autre. Sous le seuil
//!   de bruit, le gain ne bouge pas (pas de bruit de fond remonté).
//! - Les deux sources sont additionnées (sans division par 2), puis passent par une saturation douce
//!   ([`soft_clip`]) qui évite l'écrêtage brutal quand les deux parlent fort en même temps.

use super::dsp::{rms, TARGET_RATE};
use super::timeline::{Chunk, Track};

/// Seuil de la saturation douce : linéaire en dessous, compression progressive au-dessus.
const CLIP_KNEE: f32 = 0.75;

/// Saturation douce : identité sous le seuil, puis courbe tanh tendant vers ±1 (continue et dérivable).
pub fn soft_clip(x: f32) -> f32 {
    let a = x.abs();
    if a <= CLIP_KNEE {
        return x;
    }
    let room = 1.0 - CLIP_KNEE;
    (CLIP_KNEE + room * ((a - CLIP_KNEE) / room).tanh()).copysign(x)
}

/// Les deux sources enregistrées.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Mic,
    System,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Mic => "micro",
            Source::System => "son de l'ordinateur",
        }
    }
}

/// Niveau automatique lent et borné, appliqué bloc par bloc (~100 ms).
#[derive(Debug, Clone)]
pub struct Leveler {
    gain: f32,
    min_gain: f32,
    max_gain: f32,
    gate: f32,
}

impl Leveler {
    /// Niveau visé pour la voix (≈ -22 dBFS RMS).
    const TARGET_RMS: f32 = 0.08;

    /// `gate` : niveau RMS sous lequel le bloc est considéré comme du bruit (le gain reste tel quel).
    pub fn new(min_gain: f32, max_gain: f32, gate: f32) -> Self {
        Self {
            gain: 1.0,
            min_gain,
            max_gain,
            gate,
        }
    }

    /// Micro : bruit de fond réel (souffle, clavier) ; seuil ≈ -42 dBFS ; gain de ×1 à ×3.
    pub fn for_mic() -> Self {
        Self::new(1.0, 3.0, 0.008)
    }

    /// Son de l'ordinateur : silence numérique quand rien ne joue ; seuil ≈ -60 dBFS ; ×0,5 à ×4.
    pub fn for_system() -> Self {
        Self::new(0.5, 4.0, 0.001)
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }

    /// Applique le gain au bloc, avec une rampe depuis le gain précédent (pas de « marches »).
    pub fn process(&mut self, block: &mut [f32]) {
        if block.is_empty() {
            return;
        }
        let previous = self.gain;
        let level = rms(block);
        if level > self.gate {
            let wanted = (Self::TARGET_RMS / level).clamp(self.min_gain, self.max_gain);
            // Baisse rapide (évite la saturation), remontée lente (~2 s).
            let speed = if wanted < self.gain { 0.3 } else { 0.05 };
            self.gain += (wanted - self.gain) * speed;
        }
        let n = block.len() as f32;
        for (i, sample) in block.iter_mut().enumerate() {
            let g = previous + (self.gain - previous) * (i as f32 + 1.0) / n;
            *sample *= g;
        }
    }
}

/// Statistiques de niveau d'une source (avant gain), pour les logs.
#[derive(Debug, Default, Clone, Copy)]
pub struct LevelStats {
    sum_sq: f64,
    count: u64,
    peak: f32,
}

impl LevelStats {
    fn add(&mut self, block: &[f32]) {
        for &s in block {
            self.sum_sq += f64::from(s) * f64::from(s);
            self.peak = self.peak.max(s.abs());
        }
        self.count += block.len() as u64;
    }

    pub fn rms(&self) -> f32 {
        if self.count == 0 {
            0.0
        } else {
            (self.sum_sq / self.count as f64).sqrt() as f32
        }
    }

    pub fn peak(&self) -> f32 {
        self.peak
    }
}

/// Mixeur : deux pistes positionnées, lues ensemble au même rythme.
pub struct Mixer {
    mic: Track,
    system: Track,
    levelers: Option<(Leveler, Leveler)>,
    mic_stats: LevelStats,
    system_stats: LevelStats,
    window: (LevelStats, LevelStats),
    pos: u64,
}

impl Mixer {
    /// Taille maximale d'un bloc de mix (100 ms) : rythme d'adaptation du niveau automatique.
    pub const BLOCK: usize = (TARGET_RATE / 10) as usize;

    /// `levelling` : active le niveau automatique (désactivé dans certains tests).
    pub fn new(levelling: bool) -> Self {
        Self {
            mic: Track::default(),
            system: Track::default(),
            levelers: levelling.then(|| (Leveler::for_mic(), Leveler::for_system())),
            mic_stats: LevelStats::default(),
            system_stats: LevelStats::default(),
            window: Default::default(),
            pos: 0,
        }
    }

    pub fn push(&mut self, source: Source, chunk: &Chunk) {
        match source {
            Source::Mic => self.mic.push(chunk.pos, &chunk.samples),
            Source::System => self.system.push(chunk.pos, &chunk.samples),
        }
    }

    /// Position (échantillons 16 kHz) du prochain échantillon mixé.
    pub fn pos(&self) -> u64 {
        self.pos
    }

    /// Fin des données reçues, toutes sources confondues.
    pub fn max_end(&self) -> u64 {
        self.mic.end().max(self.system.end())
    }

    /// Mixe les `n` prochains échantillons (par blocs de [`Self::BLOCK`]).
    pub fn mix(&mut self, n: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(n);
        let mut left = n;
        while left > 0 {
            let len = left.min(Self::BLOCK);
            let mut mic = self.mic.take(len);
            let mut system = self.system.take(len);
            self.mic_stats.add(&mic);
            self.system_stats.add(&system);
            self.window.0.add(&mic);
            self.window.1.add(&system);
            if let Some((mic_lev, system_lev)) = self.levelers.as_mut() {
                mic_lev.process(&mut mic);
                system_lev.process(&mut system);
            }
            out.extend(mic.iter().zip(&system).map(|(a, b)| soft_clip(a + b)));
            left -= len;
        }
        self.pos += n as u64;
        out
    }

    /// Statistiques depuis le début : (micro, son de l'ordinateur).
    pub fn totals(&self) -> (LevelStats, LevelStats) {
        (self.mic_stats, self.system_stats)
    }

    /// Statistiques depuis le dernier appel (fenêtre glissante pour les logs périodiques).
    pub fn take_window(&mut self) -> (LevelStats, LevelStats) {
        std::mem::take(&mut self.window)
    }

    /// Secondes réellement reçues par source : (micro, son de l'ordinateur).
    pub fn received_secs(&self) -> (f64, f64) {
        let rate = f64::from(TARGET_RATE);
        (
            self.mic.received() as f64 / rate,
            self.system.received() as f64 / rate,
        )
    }

    /// Gains actuels du niveau automatique : (micro, son de l'ordinateur).
    pub fn gains(&self) -> (f32, f32) {
        self.levelers
            .as_ref()
            .map_or((1.0, 1.0), |(m, s)| (m.gain(), s.gain()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(pos: u64, value: f32, len: usize) -> Chunk {
        Chunk {
            pos,
            samples: vec![value; len],
        }
    }

    #[test]
    fn soft_clip_is_linear_then_bounded() {
        assert_eq!(soft_clip(0.5), 0.5);
        assert_eq!(soft_clip(-0.75), -0.75);
        assert!(soft_clip(0.9) > 0.75 && soft_clip(0.9) < 0.9);
        assert!(soft_clip(1.6) < 1.0 && soft_clip(1.6) > soft_clip(1.2));
        assert!(soft_clip(-10.0) >= -1.0);
        // Continuité au seuil.
        assert!((soft_clip(0.750_01) - 0.75).abs() < 1e-4);
    }

    #[test]
    fn mic_alone_when_loopback_sends_nothing() {
        // Rien ne joue : le loopback n'envoie aucun paquet, le micro ne doit pas l'attendre.
        let mut m = Mixer::new(false);
        m.push(Source::Mic, &chunk(0, 0.2, 1600));
        let out = m.mix(1600);
        assert_eq!(out.len(), 1600);
        assert!(out.iter().all(|&s| (s - 0.2).abs() < 1e-6));
    }

    #[test]
    fn sources_are_aligned_on_positions_with_silence() {
        let mut m = Mixer::new(false);
        m.push(Source::Mic, &chunk(0, 0.1, 1600));
        // Le son de l'ordinateur ne commence qu'à la position 800 et dure 400 échantillons.
        m.push(Source::System, &chunk(800, 0.2, 400));
        let out = m.mix(1600);
        assert!((out[0] - 0.1).abs() < 1e-6);
        assert!((out[799] - 0.1).abs() < 1e-6);
        assert!((out[800] - 0.3).abs() < 1e-6);
        assert!((out[1199] - 0.3).abs() < 1e-6);
        assert!((out[1200] - 0.1).abs() < 1e-6);
        // Données en retard (déjà mixées) : ignorées ; données futures : gardées.
        m.push(Source::System, &chunk(1000, 0.5, 800));
        let out = m.mix(400);
        assert!((out[0] - 0.5).abs() < 1e-6 && (out[199] - 0.5).abs() < 1e-6);
        assert!(out[200].abs() < 1e-6);
        assert_eq!(m.pos(), 2000);
    }

    #[test]
    fn loud_sum_is_soft_clipped_not_wrapped() {
        let mut m = Mixer::new(false);
        m.push(Source::Mic, &chunk(0, 0.9, 100));
        m.push(Source::System, &chunk(0, 0.9, 100));
        let out = m.mix(100);
        assert!(out.iter().all(|&s| s > 0.9 && s < 1.0));
    }

    #[test]
    fn leveler_raises_quiet_voice_and_lowers_loud_one_within_bounds() {
        let mut quiet = Leveler::for_mic();
        let mut loud = Leveler::for_system();
        for _ in 0..200 {
            quiet.process(&mut [0.012, -0.012].repeat(800));
            loud.process(&mut [0.5, -0.5].repeat(800));
        }
        assert!((quiet.gain() - 3.0).abs() < 0.05, "gain {}", quiet.gain());
        assert!((loud.gain() - 0.5).abs() < 0.05, "gain {}", loud.gain());
        // Son de l'ordinateur faible (volume Windows bas, ≈ -40 dBFS) : remonté jusqu'à ×4.
        let mut low_volume = Leveler::for_system();
        for _ in 0..200 {
            low_volume.process(&mut [0.01, -0.01].repeat(800));
        }
        assert!(
            (low_volume.gain() - 4.0).abs() < 0.05,
            "gain {}",
            low_volume.gain()
        );
    }

    #[test]
    fn leveler_holds_gain_during_silence() {
        let mut lev = Leveler::for_mic();
        for _ in 0..100 {
            lev.process(&mut [0.005; 1600]);
        }
        assert_eq!(lev.gain(), 1.0, "le bruit de fond n'est pas remonté");
    }

    #[test]
    fn quiet_mic_is_not_crushed_by_loud_system_sound() {
        let mut m = Mixer::new(true);
        let mut pos = 0;
        for _ in 0..100 {
            m.push(Source::Mic, &chunk(pos, 0.02, 1600));
            m.push(Source::System, &chunk(pos, 0.4, 1600));
            m.mix(1600);
            pos += 1600;
        }
        let (mic_gain, system_gain) = m.gains();
        // Écart de niveau réduit : 0,02×3 contre 0,4×0,5 (≈ ×3,3 au lieu de ×20).
        assert!(mic_gain > 2.9 && system_gain < 0.55);
        let (mic, system) = m.totals();
        assert!((mic.rms() - 0.02).abs() < 1e-4 && (system.rms() - 0.4).abs() < 1e-4);
        assert_eq!(m.received_secs(), (10.0, 10.0));
    }
}
