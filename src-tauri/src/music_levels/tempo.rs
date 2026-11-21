//! Tempo à partir des temps détectés : période (70-180 bpm) et grille calée sur leur phase. Pur, testé.
//!
//! Sur les ~8 dernières secondes de temps, chaque période candidate reçoit un score : pour chaque paire de
//! temps, l'écart doit tomber près d'un multiple entier (1 à 4) de la période, les petits multiples comptant
//! plus (sinon la moitié du tempo gagnerait autant). La meilleure période est affinée par la moyenne des
//! écarts qui la confirment, puis acceptée seulement si la plupart des intervalles successifs en sont des
//! multiples (sinon `None` : le front garde son tempo fixe). La phase est la moyenne circulaire des temps
//! (les plus récents comptent plus) : `last_beat_at` est le dernier point de la grille avant `now`.

use std::collections::VecDeque;

/// Temps gardés pour l'estimation.
const WINDOW_MS: f64 = 8_000.0;
/// Au plus ce nombre de temps gardés (180 bpm sur 8 s = 24 ; marge pour les doubles détections).
const MAX_BEATS: usize = 64;
/// Plage de tempo : 180 bpm à 70 bpm.
const MIN_PERIOD_MS: f64 = 60_000.0 / 180.0;
const MAX_PERIOD_MS: f64 = 60_000.0 / 70.0;
/// Pas de la recherche de période.
const PERIOD_STEP_MS: f64 = 2.0;
/// Tolérance sur un écart entre deux temps (détection à ~33 ms près).
const PAIR_TOLERANCE_MS: f64 = 25.0;
/// Multiples de la période considérés pour une paire de temps.
const MAX_MULTIPLE: f64 = 4.0;
/// Minimum de temps pour estimer un tempo.
const MIN_BEATS: usize = 4;
/// Part minimale des intervalles successifs qui sont des multiples de la période.
const MIN_CONFIDENCE: f64 = 0.6;
/// Tolérance relative d'un intervalle successif autour d'un multiple de la période.
const INTERVAL_TOLERANCE: f64 = 0.1;

#[derive(Debug, Default)]
pub struct TempoTracker {
    /// Instants des temps détectés (ms), croissants.
    beats: VecDeque<f64>,
    period_ms: Option<f64>,
    /// Un instant de la grille (ms, entre 0 et la période) : les temps tombent sur `anchor + k × période`.
    anchor_ms: Option<f64>,
}

impl TempoTracker {
    pub fn new() -> Self {
        Self {
            beats: VecDeque::with_capacity(MAX_BEATS + 1),
            ..Self::default()
        }
    }

    /// Ajoute un temps détecté à l'instant `at` (ms) et réestime le tempo.
    pub fn on_beat(&mut self, at: f64) {
        if self.beats.back().is_some_and(|&last| at <= last) {
            return;
        }
        self.beats.push_back(at);
        while self.beats.len() > MAX_BEATS {
            self.beats.pop_front();
        }
        self.prune(at);
        self.estimate();
    }

    /// Oublie les temps de plus de 8 s (à appeler à chaque trame) ; réestime s'il en est parti.
    pub fn prune(&mut self, now: f64) {
        let before = self.beats.len();
        while self.beats.front().is_some_and(|&t| t < now - WINDOW_MS) {
            self.beats.pop_front();
        }
        if self.beats.len() != before {
            self.estimate();
        }
    }

    /// Repart de zéro (long silence : morceau changé ou arrêté).
    pub fn reset(&mut self) {
        self.beats.clear();
        self.period_ms = None;
        self.anchor_ms = None;
    }

    /// Période estimée (ms), `None` sans tempo stable.
    pub fn period_ms(&self) -> Option<f64> {
        self.period_ms
    }

    /// Dernier temps avant `now` : sur la grille si le tempo est stable, sinon le dernier temps détecté.
    pub fn last_beat_at(&self, now: f64) -> Option<f64> {
        match (self.period_ms, self.anchor_ms) {
            (Some(period), Some(anchor)) => {
                let k = ((now - anchor) / period).floor();
                Some(anchor + k * period)
            }
            _ => self.beats.back().copied(),
        }
    }

    fn estimate(&mut self) {
        self.period_ms = None;
        self.anchor_ms = None;
        if self.beats.len() < MIN_BEATS {
            return;
        }
        let Some(rough) = self.best_period() else {
            return;
        };
        let Some(period) = self.refine(rough) else {
            return;
        };
        if !(MIN_PERIOD_MS - PAIR_TOLERANCE_MS..=MAX_PERIOD_MS + PAIR_TOLERANCE_MS)
            .contains(&period)
            || self.confidence(period) < MIN_CONFIDENCE
        {
            return;
        }
        self.period_ms = Some(period);
        self.anchor_ms = Some(self.phase(period));
    }

    /// Paires de temps (écart en ms), sans allocation.
    fn pairs(&self) -> impl Iterator<Item = f64> + '_ {
        let beats = &self.beats;
        (0..beats.len()).flat_map(move |i| (i + 1..beats.len()).map(move |j| beats[j] - beats[i]))
    }

    /// Multiple entier de `period` le plus proche de `gap`, s'il est dans `1..=MAX_MULTIPLE`.
    fn multiple(gap: f64, period: f64) -> Option<f64> {
        let n = (gap / period).round();
        (1.0..=MAX_MULTIPLE).contains(&n).then_some(n)
    }

    fn best_period(&self) -> Option<f64> {
        let mut best: Option<(f64, f64)> = None;
        let mut period = MIN_PERIOD_MS;
        while period <= MAX_PERIOD_MS {
            let score: f64 = self
                .pairs()
                .filter_map(|gap| {
                    let n = Self::multiple(gap, period)?;
                    let miss = (gap - n * period).abs();
                    (miss < PAIR_TOLERANCE_MS).then(|| (1.0 - miss / PAIR_TOLERANCE_MS) / n)
                })
                .sum();
            if score > 0.0 && best.map_or(true, |(_, s)| score > s) {
                best = Some((period, score));
            }
            period += PERIOD_STEP_MS;
        }
        best.map(|(period, _)| period)
    }

    /// Moyenne (pondérée par 1/n) des écarts qui confirment `rough`, ramenés à une période.
    fn refine(&self, rough: f64) -> Option<f64> {
        let (sum, weight) = self
            .pairs()
            .filter_map(|gap| {
                let n = Self::multiple(gap, rough)?;
                ((gap - n * rough).abs() < PAIR_TOLERANCE_MS).then_some((gap / n, 1.0 / n))
            })
            .fold((0.0, 0.0), |(s, w), (p, wi)| (s + p * wi, w + wi));
        (weight > 0.0).then(|| sum / weight)
    }

    /// Part des intervalles successifs qui sont un multiple (1 à 4) de `period`.
    fn confidence(&self, period: f64) -> f64 {
        let intervals = self.beats.len() - 1;
        let matching = self
            .beats
            .iter()
            .zip(self.beats.iter().skip(1))
            .filter(|(a, b)| {
                let gap = *b - *a;
                Self::multiple(gap, period)
                    .is_some_and(|n| (gap - n * period).abs() <= INTERVAL_TOLERANCE * period)
            })
            .count();
        matching as f64 / intervals as f64
    }

    /// Phase de la grille : moyenne circulaire des temps, les plus récents pesant plus.
    fn phase(&self, period: f64) -> f64 {
        let tau = std::f64::consts::TAU;
        let (sin, cos) = self
            .beats
            .iter()
            .enumerate()
            .fold((0.0, 0.0), |(s, c), (i, &t)| {
                let angle = tau * t.rem_euclid(period) / period;
                let weight = (i + 1) as f64;
                (s + weight * angle.sin(), c + weight * angle.cos())
            });
        sin.atan2(cos).rem_euclid(tau) / tau * period
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Origine réaliste (epoch en ms) : vérifie la précision avec de grands nombres.
    const T0: f64 = 1_790_000_000_000.0;

    fn feed(tracker: &mut TempoTracker, times: impl IntoIterator<Item = f64>) {
        for t in times {
            tracker.on_beat(T0 + t);
        }
    }

    #[test]
    fn tempo_regulier_avec_petites_erreurs() {
        let mut tracker = TempoTracker::new();
        // 120 bpm, détections à ±15 ms près.
        let jitter = [0.0, 12.0, -9.0, 15.0, -14.0, 4.0, -6.0, 10.0];
        feed(
            &mut tracker,
            (0..16).map(|i| i as f64 * 500.0 + jitter[i % jitter.len()]),
        );
        let period = tracker.period_ms().expect("tempo trouvé");
        assert!((period - 500.0).abs() < 5.0, "période {period}");
        // Grille alignée sur les temps : un temps tombe à T0 + k × 500 (à ~20 ms près, erreurs comprises).
        let now = T0 + 7_730.0;
        let last = tracker.last_beat_at(now).expect("dernier temps");
        assert!(last <= now && now - last < period + 1.0);
        let offset = (last - T0).rem_euclid(500.0);
        assert!(!(20.0..=480.0).contains(&offset), "décalage {offset}");
    }

    #[test]
    fn tempo_lent_et_rapide_dans_la_plage() {
        for bpm in [72.0, 90.0, 128.0, 174.0] {
            let period = 60_000.0 / bpm;
            let mut tracker = TempoTracker::new();
            feed(&mut tracker, (0..20).map(|i| i as f64 * period));
            let found = tracker.period_ms().expect("tempo trouvé");
            assert!((found - period).abs() < 4.0, "{bpm} bpm : {found}");
        }
    }

    #[test]
    fn temps_manquants_toleres() {
        // 100 bpm, un temps sur trois manqué (détection des basses imparfaite).
        let period = 600.0;
        let mut tracker = TempoTracker::new();
        feed(
            &mut tracker,
            (0..14).filter(|i| i % 3 != 2).map(|i| i as f64 * period),
        );
        let found = tracker.period_ms().expect("tempo trouvé");
        assert!((found - period).abs() < 4.0, "{found}");
    }

    #[test]
    fn temps_au_hasard_sans_tempo() {
        let mut seed: u32 = 7;
        let mut t = 0.0;
        let mut times = Vec::new();
        for _ in 0..16 {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            t += 250.0 + f64::from(seed >> 8) / f64::from(1u32 << 24) * 650.0;
            times.push(t);
        }
        let mut tracker = TempoTracker::new();
        feed(&mut tracker, times);
        assert_eq!(tracker.period_ms(), None);
    }

    #[test]
    fn trop_peu_de_temps_puis_oubli() {
        let mut tracker = TempoTracker::new();
        assert_eq!(tracker.last_beat_at(T0), None);
        feed(&mut tracker, [0.0, 500.0, 1_000.0]);
        assert_eq!(tracker.period_ms(), None);
        // Sans tempo : le dernier temps détecté.
        assert_eq!(tracker.last_beat_at(T0 + 1_200.0), Some(T0 + 1_000.0));
        feed(&mut tracker, [1_500.0, 2_000.0]);
        assert!(tracker.period_ms().is_some());
        // 8 s plus tard, plus rien : tempo oublié.
        tracker.prune(T0 + 2_000.0 + WINDOW_MS + 1.0);
        assert_eq!(tracker.period_ms(), None);
        assert_eq!(tracker.last_beat_at(T0 + 11_000.0), None);
        feed(&mut tracker, [20_000.0]);
        tracker.reset();
        assert_eq!(tracker.last_beat_at(T0 + 20_100.0), None);
    }
}
