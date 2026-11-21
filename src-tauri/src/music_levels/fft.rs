//! FFT complexe radix-2 en place (Cooley-Tukey itérative), tables précalculées : aucune allocation par appel.
//! Assez pour 1024 à 4096 points ~30 fois par seconde (quelques dizaines de µs par transformée).

/// Transformée de taille fixe (puissance de deux).
pub struct Fft {
    n: usize,
    /// Facteurs `e^(-2iπk/n)` pour k dans `0..n/2`.
    twiddle_re: Vec<f32>,
    twiddle_im: Vec<f32>,
    /// Permutation en ordre de bits inversés.
    bitrev: Vec<usize>,
}

impl Fft {
    /// `n` : puissance de deux, au moins 2.
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 2 && n.is_power_of_two(),
            "taille de FFT invalide : {n}"
        );
        let bits = n.trailing_zeros();
        let (twiddle_re, twiddle_im) = (0..n / 2)
            .map(|k| {
                let angle = -2.0 * std::f64::consts::PI * k as f64 / n as f64;
                (angle.cos() as f32, angle.sin() as f32)
            })
            .unzip();
        let bitrev = (0..n)
            .map(|i| i.reverse_bits() >> (usize::BITS - bits))
            .collect();
        Self {
            n,
            twiddle_re,
            twiddle_im,
            bitrev,
        }
    }

    /// Transformée directe en place ; `re` et `im` ont exactement `n` éléments (taille donnée à `new`).
    pub fn forward(&self, re: &mut [f32], im: &mut [f32]) {
        let n = self.n;
        assert!(
            re.len() == n && im.len() == n,
            "tampons de FFT de mauvaise taille"
        );
        for (i, &j) in self.bitrev.iter().enumerate() {
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let step = n / size;
            for start in (0..n).step_by(size) {
                for k in 0..half {
                    let wr = self.twiddle_re[k * step];
                    let wi = self.twiddle_im[k * step];
                    let a = start + k;
                    let b = a + half;
                    let tr = wr * re[b] - wi * im[b];
                    let ti = wr * im[b] + wi * re[b];
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
            size *= 2;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DFT naïve de référence.
    fn dft(input: &[f32]) -> Vec<(f64, f64)> {
        let n = input.len();
        (0..n)
            .map(|k| {
                input
                    .iter()
                    .enumerate()
                    .fold((0.0, 0.0), |(r, i), (t, &x)| {
                        let angle = -2.0 * std::f64::consts::PI * (k * t) as f64 / n as f64;
                        (
                            r + f64::from(x) * angle.cos(),
                            i + f64::from(x) * angle.sin(),
                        )
                    })
            })
            .collect()
    }

    #[test]
    fn identique_a_la_dft_naive() {
        let n = 64;
        // Signal pseudo-aléatoire déterministe.
        let mut seed: u32 = 12345;
        let input: Vec<f32> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
            })
            .collect();
        let fft = Fft::new(n);
        let mut re = input.clone();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        for (k, (r, i)) in dft(&input).into_iter().enumerate() {
            assert!((f64::from(re[k]) - r).abs() < 1e-4, "réel {k}");
            assert!((f64::from(im[k]) - i).abs() < 1e-4, "imaginaire {k}");
        }
    }

    #[test]
    fn sinus_sur_sa_case() {
        let n = 1024;
        let fft = Fft::new(n);
        let mut re: Vec<f32> = (0..n)
            .map(|t| (2.0 * std::f32::consts::PI * 10.0 * t as f32 / n as f32).sin())
            .collect();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        let power: Vec<f32> = re.iter().zip(&im).map(|(r, i)| r * r + i * i).collect();
        let peak = (0..n / 2)
            .max_by(|&a, &b| power[a].total_cmp(&power[b]))
            .unwrap();
        assert_eq!(peak, 10);
        // Amplitude n/2 pour un sinus d'amplitude 1.
        assert!((power[10].sqrt() - n as f32 / 2.0).abs() < 0.5);
    }
}
