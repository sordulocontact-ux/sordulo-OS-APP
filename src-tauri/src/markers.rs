//! Moments marqués pendant un enregistrement (pur, même code pour Windows et macOS) : ajout avec un écart
//! minimal et un maximum, retrait du dernier, forme envoyée au front. La position vient de l'enregistreur
//! (`Recorder::elapsed_secs`, position dans le MP3), lue par `recording::add_marker`.

use crate::state::RecordingMarkers;

/// Un appui à moins d'une seconde d'un repère existant est ignoré (double appui, rebond du clavier).
pub const MIN_GAP_SECS: f64 = 1.0;
/// Repères au plus par enregistrement.
pub const MAX_MARKERS: usize = 100;

/// Résultat d'un appui.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Added,
    /// À moins de `MIN_GAP_SECS` d'un repère existant.
    TooClose,
    /// `MAX_MARKERS` déjà posés.
    Full,
}

/// Ajoute un repère à `at` secondes (liste gardée triée).
pub fn add(markers: &mut Vec<f64>, at: f64) -> Outcome {
    let at = if at.is_finite() { at.max(0.0) } else { 0.0 };
    if markers.len() >= MAX_MARKERS {
        return Outcome::Full;
    }
    if markers.iter().any(|m| (at - m).abs() < MIN_GAP_SECS) {
        return Outcome::TooClose;
    }
    let index = markers.partition_point(|m| *m <= at);
    markers.insert(index, at);
    Outcome::Added
}

/// Retire le repère le plus récent (le plus loin dans l'audio). Faux s'il n'y en avait pas.
pub fn remove_last(markers: &mut Vec<f64>) -> bool {
    markers.pop().is_some()
}

/// Secondes arrondies au dixième.
pub fn round_tenth(secs: f64) -> f64 {
    (secs * 10.0).round() / 10.0
}

/// Repères de `RecordingResult` : triés, au dixième.
pub fn for_result(markers: &[f64]) -> Vec<f64> {
    let mut out: Vec<f64> = markers.iter().copied().map(round_tenth).collect();
    out.sort_by(f64::total_cmp);
    out
}

/// `RecordingMarkers` après un changement (`added` : ce changement a ajouté un repère).
pub fn summary(markers: &[f64], added: bool) -> RecordingMarkers {
    RecordingMarkers {
        count: markers.len(),
        last_at_secs: markers.iter().copied().reduce(f64::max).map(round_tenth),
        added,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecart_d_une_seconde() {
        let mut markers = Vec::new();
        assert_eq!(add(&mut markers, 10.0), Outcome::Added);
        assert_eq!(add(&mut markers, 10.4), Outcome::TooClose);
        assert_eq!(add(&mut markers, 10.99), Outcome::TooClose);
        assert_eq!(add(&mut markers, 11.0), Outcome::Added);
        // Aussi avant un repère existant (liste gardée triée).
        assert_eq!(add(&mut markers, 9.5), Outcome::TooClose);
        assert_eq!(add(&mut markers, 3.0), Outcome::Added);
        assert_eq!(markers, vec![3.0, 10.0, 11.0]);
    }

    #[test]
    fn valeurs_impossibles_ramenees_au_debut() {
        let mut markers = Vec::new();
        assert_eq!(add(&mut markers, -2.0), Outcome::Added);
        assert_eq!(add(&mut markers, f64::NAN), Outcome::TooClose);
        assert_eq!(markers, vec![0.0]);
    }

    #[test]
    fn cent_reperes_au_plus() {
        let mut markers = Vec::new();
        for i in 0..MAX_MARKERS {
            assert_eq!(add(&mut markers, i as f64 * 2.0), Outcome::Added);
        }
        assert_eq!(add(&mut markers, 1_000.0), Outcome::Full);
        assert_eq!(markers.len(), MAX_MARKERS);
        assert!(remove_last(&mut markers));
        assert_eq!(add(&mut markers, 1_000.0), Outcome::Added);
    }

    #[test]
    fn retrait_du_dernier() {
        let mut markers = Vec::new();
        assert!(!remove_last(&mut markers));
        add(&mut markers, 5.0);
        add(&mut markers, 20.0);
        assert!(remove_last(&mut markers));
        assert_eq!(markers, vec![5.0]);
        // Un nouvel appui au même moment est de nouveau accepté.
        assert_eq!(add(&mut markers, 20.2), Outcome::Added);
    }

    #[test]
    fn arrondi_au_dixieme() {
        assert_eq!(round_tenth(12.34), 12.3);
        assert_eq!(round_tenth(12.36), 12.4);
        assert_eq!(round_tenth(0.04), 0.0);
        assert_eq!(for_result(&[61.26, 3.04]), vec![3.0, 61.3]);
        assert_eq!(for_result(&[]), Vec::<f64>::new());
    }

    #[test]
    fn resume_envoye_au_front() {
        assert_eq!(
            summary(&[3.04, 61.26], true),
            RecordingMarkers {
                count: 2,
                last_at_secs: Some(61.3),
                added: true
            }
        );
        assert_eq!(
            summary(&[], false),
            RecordingMarkers {
                count: 0,
                last_at_secs: None,
                added: false
            }
        );
    }
}
