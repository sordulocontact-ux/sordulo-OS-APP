//! Analyse pure du son de l'ordinateur pour l'île : 8 bandes basses → aigus avec gain automatique, silence,
//! temps forts et tempo. Aucune dépendance système : testée avec des signaux synthétiques.
//!
//! Chaque trame (~30 par seconde, au rythme de l'appelant) :
//! 1. Fenêtre de Hann sur les derniers échantillons (~40 ms : 2048 points à 44,1 ou 48 kHz, pour que les
//!    basses aient quelques cases), FFT maison ([`super::fft`]).
//! 2. Énergie de 8 bandes logarithmiques de 40 Hz à 16 kHz, en dB.
//! 3. Gain automatique en dB : chaque bande est rapportée à son propre maximum glissant (montée immédiate,
//!    descente de 4 dB/s ; 18 dB sous le maximum → 0), et jamais à moins que le maximum de toutes les bandes moins 24 dB (une bande
//!    bien plus faible que les autres reste basse) ni qu'un plancher (le bruit n'est pas amplifié). Volume
//!    ×0,1 = tout décalé de -20 dB : même mouvement une fois les maxima redescendus (quelques secondes).
//! 4. Silence : niveau efficace sous -60 dBFS pendant 300 ms → bandes à 0 (même si le lecteur dit « lecture »).
//! 5. Lissage : montée rapide (~25 ms), descente plus lente (~180 ms, ~50 ms pendant un silence).
//! 6. Temps forts : saut d'énergie des basses (30-160 Hz, en dB, donc indépendant du volume) au-dessus d'un
//!    seuil adaptatif (moyenne + 1,5 écart type des sauts de la dernière 1,5 s), au plus un temps par 250 ms.
//!    Tempo et phase : [`super::tempo`].

use super::fft::Fft;
use super::tempo::TempoTracker;

/// Nombre de bandes (contrat : `MusicLevels.bands`).
pub const BAND_COUNT: usize = 8;
/// Trames par seconde visées par l'appelant.
pub const FRAMES_PER_SEC: u32 = 30;

/// Bornes des bandes : 40 Hz → 16 kHz, en progression géométrique.
const LOW_HZ: f32 = 40.0;
const HIGH_HZ: f32 = 16_000.0;
/// Durée de fenêtre visée (s) : la taille de FFT est la puissance de deux au-dessus.
const WINDOW_SECS: f32 = 0.04;
/// Basses pour la détection des temps.
const BASS_LOW_HZ: f32 = 30.0;
const BASS_HIGH_HZ: f32 = 160.0;

/// Plage affichée sous le maximum de la bande (dB) : `maximum - RANGE_DB` → 0, maximum → 1.
const RANGE_DB: f32 = 18.0;
/// Une bande n'est jamais rapportée à moins que le maximum de toutes les bandes moins cet écart.
const TILT_DB: f32 = 24.0;
/// Référence minimale (dB, ~dBFS d'une bande) : en dessous, le son n'est plus amplifié.
const FLOOR_DB: f32 = -55.0;
/// Descente des maxima glissants.
const PEAK_RELEASE_DB_PER_SEC: f32 = 4.0;

/// Silence : niveau efficace sous ce seuil (-60 dBFS) pendant `SILENCE_HOLD_MS`.
const SILENCE_RMS: f32 = 0.001;
const SILENCE_HOLD_MS: f64 = 300.0;
/// Silence assez long pour oublier le tempo (pause, changement de morceau).
const TEMPO_RESET_SILENCE_MS: f64 = 2_000.0;

/// Lissage des bandes : constantes de temps de montée et de descente.
const ATTACK_MS: f64 = 25.0;
const RELEASE_MS: f64 = 180.0;
/// Descente pendant un silence : les barres finissent vite à plat.
const SILENT_RELEASE_MS: f64 = 50.0;

/// Sauts d'énergie des basses gardés pour le seuil adaptatif (~1,5 s).
const ONSET_HISTORY: usize = 45;
/// Seuil minimal d'un temps fort (dB de hausse d'une trame à l'autre).
const MIN_ONSET_DB: f32 = 3.0;
/// Écarts types au-dessus de la moyenne des sauts récents.
const ONSET_SIGMAS: f32 = 1.5;
/// Les basses doivent être à moins de cet écart de leur maximum glissant (pas de temps dans le bruit).
const BASS_GATE_DB: f32 = 20.0;
/// Écart minimal entre deux temps (240 bpm).
const MIN_BEAT_GAP_MS: f64 = 250.0;

/// Résultat d'une trame.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    /// 0..1, basses → aigus.
    pub bands: [f32; BAND_COUNT],
    pub beat_period_ms: Option<f64>,
    /// Instant (ms, même horloge que `analyze`) du dernier temps, calé sur la grille du tempo.
    pub last_beat_at: Option<f64>,
    /// Silence en cours (bandes à 0).
    pub silent: bool,
    /// Un temps fort a été détecté à cette trame.
    pub beat: bool,
}

/// Analyseur d'un flux mono à fréquence fixe. Tampons alloués une fois, à la création.
pub struct Analyzer {
    fft: Fft,
    window: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    /// Derniers échantillons (tampon circulaire de la taille de la FFT).
    ring: Vec<f32>,
    ring_pos: usize,
    /// Échantillons d'une trame (pour avancer quand rien n'arrive).
    hop: usize,
    /// Puissance par case → puissance « pleine échelle » (sinus d'amplitude 1 ≈ 0 dB).
    power_scale: f32,
    /// Durée de la demi-fenêtre (ms) : un temps est daté au milieu de la fenêtre.
    half_window_ms: f64,
    band_bins: [(usize, usize); BAND_COUNT],
    bass_bins: (usize, usize),
    // Depuis la dernière trame.
    pushed: usize,
    pushed_square_sum: f64,
    // Gain automatique et lissage.
    peaks: [f32; BAND_COUNT],
    smoothed: [f32; BAND_COUNT],
    // Silence.
    quiet_ms: f64,
    last_at: Option<f64>,
    // Temps forts.
    bass_peak: f32,
    previous_bass_db: Option<f32>,
    onsets: [f32; ONSET_HISTORY],
    onset_pos: usize,
    onset_count: usize,
    last_beat: Option<f64>,
    tempo: TempoTracker,
}

/// Taille de FFT pour une fréquence d'échantillonnage : ~40 ms, entre 512 et 8192 points.
pub fn fft_size_for(sample_rate: u32) -> usize {
    let wanted = (sample_rate as f32 * WINDOW_SECS) as usize;
    wanted.next_power_of_two().clamp(512, 8192)
}

impl Analyzer {
    pub fn new(sample_rate: u32) -> Self {
        let rate = sample_rate.max(8_000) as f32;
        let n = fft_size_for(sample_rate.max(8_000));
        let bin_hz = rate / n as f32;
        let nyquist_bin = n / 2;
        // Cases [début, fin) d'une plage de fréquences ; au moins une case (la plus proche du centre).
        let bins = |low: f32, high: f32| -> (usize, usize) {
            let start = ((low / bin_hz).ceil() as usize).max(1);
            let end = ((high / bin_hz).ceil() as usize).min(nyquist_bin);
            if start < end {
                (start, end)
            } else {
                let center = ((low * high).sqrt() / bin_hz).round() as usize;
                let center = center.clamp(1, nyquist_bin - 1);
                (center, center + 1)
            }
        };
        let ratio = HIGH_HZ / LOW_HZ;
        let edge = |i: usize| LOW_HZ * ratio.powf(i as f32 / BAND_COUNT as f32);
        let mut band_bins = [(0, 0); BAND_COUNT];
        for (i, slot) in band_bins.iter_mut().enumerate() {
            *slot = bins(edge(i), edge(i + 1));
        }
        let window = (0..n)
            .map(|i| {
                let x = std::f32::consts::TAU * i as f32 / n as f32;
                0.5 - 0.5 * x.cos()
            })
            .collect();
        // Hann : un sinus d'amplitude A donne |X| ≈ A·n/4 sur sa case.
        let power_scale = (4.0 / n as f32).powi(2);
        Self {
            fft: Fft::new(n),
            window,
            re: vec![0.0; n],
            im: vec![0.0; n],
            ring: vec![0.0; n],
            ring_pos: 0,
            hop: (rate as usize / FRAMES_PER_SEC as usize).max(1),
            power_scale,
            half_window_ms: n as f64 / f64::from(rate) * 500.0,
            band_bins,
            bass_bins: bins(BASS_LOW_HZ, BASS_HIGH_HZ),
            pushed: 0,
            pushed_square_sum: 0.0,
            peaks: [FLOOR_DB; BAND_COUNT],
            smoothed: [0.0; BAND_COUNT],
            quiet_ms: 0.0,
            last_at: None,
            bass_peak: FLOOR_DB,
            previous_bass_db: None,
            onsets: [0.0; ONSET_HISTORY],
            onset_pos: 0,
            onset_count: 0,
            last_beat: None,
            tempo: TempoTracker::new(),
        }
    }

    /// Ajoute des échantillons mono (−1..1). Valeurs non finies comptées comme 0.
    pub fn push(&mut self, samples: &[f32]) {
        let n = self.ring.len();
        for &s in samples {
            let s = if s.is_finite() { s } else { 0.0 };
            self.pushed_square_sum += f64::from(s) * f64::from(s);
            self.ring[self.ring_pos] = s;
            self.ring_pos = (self.ring_pos + 1) % n;
        }
        self.pushed += samples.len();
    }

    /// Analyse les derniers échantillons à l'instant `now_ms` (horloge de l'appelant, en ms). Rien reçu
    /// depuis la trame précédente (loopback muet) : une trame de silence.
    pub fn analyze(&mut self, now_ms: f64) -> Frame {
        if self.pushed == 0 {
            let n = self.ring.len();
            for _ in 0..self.hop {
                self.ring[self.ring_pos] = 0.0;
                self.ring_pos = (self.ring_pos + 1) % n;
            }
        }
        let rms = if self.pushed == 0 {
            0.0
        } else {
            (self.pushed_square_sum / self.pushed as f64).sqrt() as f32
        };
        self.pushed = 0;
        self.pushed_square_sum = 0.0;

        let dt_ms = self
            .last_at
            .map_or(1_000.0 / f64::from(FRAMES_PER_SEC), |t| {
                (now_ms - t).clamp(1.0, 250.0)
            });
        self.last_at = Some(now_ms);

        // Silence.
        if rms < SILENCE_RMS {
            self.quiet_ms += dt_ms;
        } else {
            self.quiet_ms = 0.0;
        }
        let silent = self.quiet_ms >= SILENCE_HOLD_MS;
        if self.quiet_ms >= TEMPO_RESET_SILENCE_MS {
            self.tempo.reset();
            self.previous_bass_db = None;
        }

        self.transform();

        // Bandes et gain automatique.
        let release = PEAK_RELEASE_DB_PER_SEC * (dt_ms / 1_000.0) as f32;
        let mut levels = [0.0f32; BAND_COUNT];
        for (b, level) in levels.iter_mut().enumerate() {
            let (start, end) = self.band_bins[b];
            *level = self.power_db(start, end);
            if !silent {
                // Maxima figés pendant un silence : même niveau à la reprise.
                self.peaks[b] = level.max(self.peaks[b] - release);
            }
        }
        let loudest = self.peaks.iter().copied().fold(f32::MIN, f32::max);
        let attack = 1.0 - (-dt_ms / ATTACK_MS).exp() as f32;
        let release_ms = if silent {
            SILENT_RELEASE_MS
        } else {
            RELEASE_MS
        };
        let decay = 1.0 - (-dt_ms / release_ms).exp() as f32;
        for b in 0..BAND_COUNT {
            let reference = self.peaks[b].max(loudest - TILT_DB).max(FLOOR_DB);
            let target = if silent {
                0.0
            } else {
                ((levels[b] - (reference - RANGE_DB)) / RANGE_DB).clamp(0.0, 1.0)
            };
            let current = self.smoothed[b];
            let alpha = if target > current { attack } else { decay };
            let mut next = current + (target - current) * alpha;
            if next < 0.01 {
                next = 0.0;
            }
            self.smoothed[b] = next;
        }

        // Temps forts.
        let (start, end) = self.bass_bins;
        let bass_db = self.power_db(start, end);
        if !silent {
            self.bass_peak = bass_db.max(self.bass_peak - release);
        }
        let onset = self
            .previous_bass_db
            .map_or(0.0, |previous| (bass_db - previous).max(0.0));
        self.previous_bass_db = Some(bass_db);
        let threshold = self.onset_threshold();
        let loud = bass_db > FLOOR_DB - 10.0 && bass_db > self.bass_peak - BASS_GATE_DB;
        let spaced = self.last_beat.map_or(true, |last| {
            now_ms - self.half_window_ms - last >= MIN_BEAT_GAP_MS
        });
        let beat = !silent && loud && spaced && onset >= threshold;
        self.onsets[self.onset_pos] = onset;
        self.onset_pos = (self.onset_pos + 1) % ONSET_HISTORY;
        self.onset_count = (self.onset_count + 1).min(ONSET_HISTORY);
        if beat {
            // Daté au milieu de la fenêtre analysée.
            let at = now_ms - self.half_window_ms;
            self.last_beat = Some(at);
            self.tempo.on_beat(at);
        } else {
            self.tempo.prune(now_ms);
        }

        Frame {
            bands: self.smoothed,
            beat_period_ms: self.tempo.period_ms(),
            last_beat_at: self.tempo.last_beat_at(now_ms),
            silent,
            beat,
        }
    }

    /// Fenêtre de Hann sur le contenu du tampon circulaire (du plus ancien au plus récent), puis FFT.
    fn transform(&mut self) {
        // `ring_pos` : prochain emplacement écrit, donc le plus ancien échantillon.
        let (newest, oldest) = self.ring.split_at(self.ring_pos);
        for ((out, &sample), &w) in self
            .re
            .iter_mut()
            .zip(oldest.iter().chain(newest))
            .zip(&self.window)
        {
            *out = sample * w;
        }
        self.im.fill(0.0);
        self.fft.forward(&mut self.re, &mut self.im);
    }

    /// Puissance des cases `[start, end)` en dB pleine échelle.
    fn power_db(&self, start: usize, end: usize) -> f32 {
        let power: f32 = (start..end)
            .map(|k| self.re[k] * self.re[k] + self.im[k] * self.im[k])
            .sum();
        10.0 * (power * self.power_scale + 1e-12).log10()
    }

    /// Moyenne + 1,5 écart type des sauts récents, au moins `MIN_ONSET_DB`.
    fn onset_threshold(&self) -> f32 {
        if self.onset_count == 0 {
            return MIN_ONSET_DB;
        }
        let values = &self.onsets[..self.onset_count];
        let count = self.onset_count as f32;
        let mean = values.iter().sum::<f32>() / count;
        let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / count;
        (mean + ONSET_SIGMAS * variance.sqrt()).max(MIN_ONSET_DB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;
    const TAU: f32 = std::f32::consts::TAU;

    /// Bruit blanc déterministe dans −1..1.
    struct Noise(u32);
    impl Noise {
        fn next(&mut self) -> f32 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (self.0 >> 8) as f32 / (1u32 << 23) as f32 - 1.0
        }
    }

    /// Fait tourner l'analyseur sur `secs` secondes d'un signal `f(t)` (t en s), à 30 trames par seconde,
    /// à partir de l'instant `start` (s). Renvoie les trames.
    fn run(
        analyzer: &mut Analyzer,
        start: f64,
        secs: f64,
        mut f: impl FnMut(f64) -> f32,
    ) -> Vec<Frame> {
        let hop = RATE as usize / FRAMES_PER_SEC as usize;
        let frames = (secs * f64::from(FRAMES_PER_SEC)).round() as usize;
        let first = (start * f64::from(RATE)).round() as usize;
        let mut chunk = vec![0.0f32; hop];
        (0..frames)
            .map(|frame| {
                let base = first + frame * hop;
                for (i, slot) in chunk.iter_mut().enumerate() {
                    *slot = f((base + i) as f64 / f64::from(RATE));
                }
                analyzer.push(&chunk);
                let now = (base + hop) as f64 / f64::from(RATE) * 1_000.0;
                analyzer.analyze(T0 + now)
            })
            .collect()
    }

    /// Origine des horloges : un epoch en ms réaliste.
    const T0: f64 = 1_790_000_000_000.0;

    fn sine(freq: f32, amplitude: f32) -> impl FnMut(f64) -> f32 {
        move |t| amplitude * (TAU * freq * t as f32).sin()
    }

    fn mean_bands(frames: &[Frame]) -> [f32; BAND_COUNT] {
        let mut sum = [0.0; BAND_COUNT];
        for frame in frames {
            for (s, b) in sum.iter_mut().zip(frame.bands) {
                *s += b;
            }
        }
        sum.map(|s| s / frames.len() as f32)
    }

    #[test]
    fn taille_de_fenetre() {
        assert_eq!(fft_size_for(48_000), 2048);
        assert_eq!(fft_size_for(44_100), 2048);
        assert_eq!(fft_size_for(16_000), 1024);
        assert_eq!(fft_size_for(96_000), 4096);
    }

    #[test]
    fn sinus_grave_dans_les_bandes_de_gauche() {
        let mut analyzer = Analyzer::new(RATE);
        let frames = run(&mut analyzer, 0.0, 2.0, sine(60.0, 0.5));
        let bands = mean_bands(&frames[30..]);
        assert!(bands[0] > 0.8, "{bands:?}");
        assert!(bands[3..].iter().all(|&b| b < 0.1), "{bands:?}");
        assert!(!frames.last().unwrap().silent);
    }

    #[test]
    fn sinus_aigu_dans_les_bandes_de_droite() {
        let mut analyzer = Analyzer::new(RATE);
        let frames = run(&mut analyzer, 0.0, 2.0, sine(10_000.0, 0.3));
        let bands = mean_bands(&frames[30..]);
        assert!(bands[7] > 0.8, "{bands:?}");
        assert!(bands[..5].iter().all(|&b| b < 0.1), "{bands:?}");
        // Médium (1 kHz) : au milieu.
        let mut analyzer = Analyzer::new(RATE);
        let frames = run(&mut analyzer, 0.0, 2.0, sine(1_000.0, 0.3));
        let bands = mean_bands(&frames[30..]);
        let loudest = (0..BAND_COUNT)
            .max_by(|&a, &b| bands[a].total_cmp(&bands[b]))
            .unwrap();
        assert!((3..=5).contains(&loudest), "{bands:?}");
        assert!(bands[0] < 0.1 && bands[7] < 0.1, "{bands:?}");
    }

    /// « Musique » : basse et médium modulés (2 Hz et 3 Hz), aigus en bruit pulsé, volume `gain`.
    fn music(gain: f32) -> impl FnMut(f64) -> f32 {
        let mut noise = Noise(99);
        move |t| {
            let tf = t as f32;
            let bass = (0.6 + 0.4 * (TAU * 2.0 * tf).sin()) * (TAU * 70.0 * tf).sin();
            let mid = (0.5 + 0.5 * (TAU * 3.0 * tf).sin()) * (TAU * 800.0 * tf).sin();
            let hats = if (t * 4.0).fract() < 0.1 {
                noise.next() * 0.2
            } else {
                0.0
            };
            gain * (0.4 * bass + 0.25 * mid + hats)
        }
    }

    #[test]
    fn meme_mouvement_a_bas_volume_apres_adaptation() {
        // Référence : toujours fort.
        let mut loud = Analyzer::new(RATE);
        run(&mut loud, 0.0, 14.0, music(1.0));
        let reference = run(&mut loud, 14.0, 2.0, music(1.0));
        // Fort 4 s, puis volume ×0,1 : les maxima redescendent en quelques secondes.
        let mut quiet = Analyzer::new(RATE);
        run(&mut quiet, 0.0, 4.0, music(1.0));
        let just_after = run(&mut quiet, 4.0, 1.0, music(0.1));
        run(&mut quiet, 5.0, 9.0, music(0.1));
        let adapted = run(&mut quiet, 14.0, 2.0, music(0.1));
        let diff = reference
            .iter()
            .zip(&adapted)
            .flat_map(|(a, b)| a.bands.iter().zip(b.bands).map(|(x, y)| (x - y).abs()))
            .fold(0.0f32, f32::max);
        assert!(diff < 0.05, "écart {diff}");
        // Juste après la baisse, le mouvement est d'abord plus faible (adaptation en cours).
        let before = mean_bands(&reference)[0];
        let after = mean_bands(&just_after)[0];
        assert!(after < before - 0.2, "{after} / {before}");
        // Et le mouvement est réel : la basse modulée varie nettement.
        let (low, high) = adapted.iter().fold((1.0f32, 0.0f32), |(lo, hi), f| {
            (lo.min(f.bands[0]), hi.max(f.bands[0]))
        });
        assert!(high - low > 0.25, "{low}..{high}");
    }

    #[test]
    fn silence_bandes_a_zero() {
        let mut analyzer = Analyzer::new(RATE);
        run(&mut analyzer, 0.0, 2.0, music(1.0));
        // Silence numérique : 300 ms plus tard tout est à plat.
        let frames = run(&mut analyzer, 2.0, 1.0, |_| 0.0);
        assert!(!frames[2].silent);
        let last = frames.last().unwrap();
        assert!(last.silent);
        assert_eq!(last.bands, [0.0; BAND_COUNT]);
        // Bruit très faible (-70 dBFS) : silence aussi, pas amplifié.
        let mut noise = Noise(3);
        let frames = run(&mut analyzer, 3.0, 1.0, move |_| noise.next() * 0.0003);
        assert_eq!(frames.last().unwrap().bands, [0.0; BAND_COUNT]);
        // Rien reçu du tout (loopback muet) : trames de silence.
        let mut empty = Analyzer::new(RATE);
        let mut last = None;
        for i in 0..15 {
            last = Some(empty.analyze(T0 + f64::from(i) * 33.0));
        }
        let last = last.unwrap();
        assert!(last.silent);
        assert_eq!(last.bands, [0.0; BAND_COUNT]);
        assert_eq!(last.last_beat_at, None);
        // La musique revient : les bandes repartent tout de suite.
        let frames = run(&mut analyzer, 4.0, 0.5, music(1.0));
        assert!(!frames.last().unwrap().silent);
        assert!(frames.last().unwrap().bands.iter().any(|&b| b > 0.3));
    }

    /// Coups de grosse caisse (60 Hz, décroissance ~50 ms) toutes les `period` s sur un fond léger.
    fn kicks(period: f64, offset: f64) -> impl FnMut(f64) -> f32 {
        let mut noise = Noise(42);
        move |t| {
            let since = (t - offset).rem_euclid(period) as f32;
            let kick = (-since / 0.05).exp() * (TAU * 60.0 * since).sin() * 0.8;
            let pad = 0.03 * (TAU * 440.0 * t as f32).sin() + noise.next() * 0.01;
            kick + pad
        }
    }

    #[test]
    fn impulsions_graves_a_120_bpm() {
        let mut analyzer = Analyzer::new(RATE);
        let offset = 0.137;
        let frames = run(&mut analyzer, 0.0, 10.0, kicks(0.5, offset));
        let beats = frames.iter().filter(|f| f.beat).count();
        assert!((17..=21).contains(&beats), "{beats} temps détectés");
        let last = frames.last().unwrap();
        let period = last.beat_period_ms.expect("tempo trouvé");
        assert!((period - 500.0).abs() < 10.0, "période {period}");
        // Grille alignée sur les vrais coups (à ~40 ms près : trames de 33 ms).
        let at = last.last_beat_at.expect("dernier temps") - T0;
        let phase = (at - offset * 1_000.0).rem_euclid(500.0);
        assert!(!(40.0..=460.0).contains(&phase), "décalage {phase} ms");
    }

    #[test]
    fn impulsions_a_90_bpm() {
        let mut analyzer = Analyzer::new(RATE);
        let frames = run(&mut analyzer, 0.0, 10.0, kicks(60.0 / 90.0, 0.0));
        let period = frames.last().unwrap().beat_period_ms.expect("tempo trouvé");
        assert!((period - 666.7).abs() < 12.0, "période {period}");
    }

    #[test]
    fn son_continu_sans_tempo() {
        let mut analyzer = Analyzer::new(RATE);
        let mut noise = Noise(5);
        let frames = run(&mut analyzer, 0.0, 6.0, move |_| noise.next() * 0.3);
        assert_eq!(frames.last().unwrap().beat_period_ms, None);
        let mut analyzer = Analyzer::new(RATE);
        let frames = run(&mut analyzer, 0.0, 6.0, sine(80.0, 0.5));
        assert!(frames.iter().all(|f| !f.beat));
    }

    #[test]
    fn long_silence_oublie_le_tempo() {
        let mut analyzer = Analyzer::new(RATE);
        run(&mut analyzer, 0.0, 6.0, kicks(0.5, 0.0));
        let frames = run(&mut analyzer, 6.0, 3.0, |_| 0.0);
        let last = frames.last().unwrap();
        assert_eq!(last.beat_period_ms, None);
        assert_eq!(last.last_beat_at, None);
    }
}
