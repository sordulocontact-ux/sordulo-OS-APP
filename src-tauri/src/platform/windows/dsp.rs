//! Traitements purs du signal : conversion en mono, rééchantillonnage vers 16 kHz, mesures de niveau.

use anyhow::{anyhow, Result};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Indexing, Resampler};

/// Fréquence d'échantillonnage du fichier produit (et de la ligne de temps commune).
pub const TARGET_RATE: u32 = 16_000;

/// Moyenne des canaux d'un signal entrelacé. Une trame incomplète en fin de tampon est ignorée.
pub fn interleaved_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    match channels {
        0 => Vec::new(),
        1 => samples.to_vec(),
        n => {
            let scale = 1.0 / n as f32;
            samples
                .chunks_exact(n)
                .map(|frame| frame.iter().sum::<f32>() * scale)
                .collect()
        }
    }
}

/// Moyenne quadratique (0 pour un tampon vide).
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// Niveau en dBFS (plancher à -120 dB pour le silence numérique).
pub fn to_dbfs(level: f32) -> f32 {
    if level <= 1e-6 {
        -120.0
    } else {
        20.0 * level.log10()
    }
}

/// Rééchantillonneur mono vers [`TARGET_RATE`], qui accepte des blocs de taille quelconque.
pub struct MonoResampler {
    input_rate: u32,
    /// `None` si l'entrée est déjà à 16 kHz.
    inner: Option<Fft<f32>>,
    pending: Vec<f32>,
    total_in: u64,
    total_out: u64,
}

impl MonoResampler {
    pub fn new(input_rate: u32) -> Result<Self> {
        if input_rate == 0 {
            return Err(anyhow!("Fréquence d'échantillonnage invalide (0 Hz)"));
        }
        Ok(Self {
            input_rate,
            inner: Self::build(input_rate)?,
            pending: Vec::new(),
            total_in: 0,
            total_out: 0,
        })
    }

    fn build(input_rate: u32) -> Result<Option<Fft<f32>>> {
        if input_rate == TARGET_RATE {
            return Ok(None);
        }
        // Blocs d'environ 10 ms en entrée : faible latence, qualité largement suffisante pour la voix.
        let chunk = (input_rate as usize / 100).max(64);
        Fft::<f32>::new(
            input_rate as usize,
            TARGET_RATE as usize,
            chunk,
            1,
            FixedSync::Input,
        )
        .map(Some)
        .map_err(|e| anyhow!("Rééchantillonneur {input_rate} Hz → 16 kHz : {e}"))
    }

    /// Repart de zéro (après une coupure du flux), sans rien émettre.
    pub fn reset(&mut self) -> Result<()> {
        self.inner = Self::build(self.input_rate)?;
        self.pending.clear();
        self.total_in = 0;
        self.total_out = 0;
        Ok(())
    }

    /// Ajoute des échantillons mono et renvoie ce qui est prêt à 16 kHz.
    pub fn process(&mut self, input: &[f32]) -> Result<Vec<f32>> {
        self.total_in += input.len() as u64;
        let Some(inner) = self.inner.as_mut() else {
            self.total_out += input.len() as u64;
            return Ok(input.to_vec());
        };
        self.pending.extend_from_slice(input);
        let mut out = Vec::new();
        loop {
            let needed = inner.input_frames_next();
            if self.pending.len() < needed {
                break;
            }
            run_chunk(inner, &self.pending[..needed], None, &mut out)?;
            self.pending.drain(..needed);
        }
        self.total_out += out.len() as u64;
        Ok(out)
    }

    /// Vide le rééchantillonneur (reste en attente + retard du filtre) et renvoie les derniers échantillons.
    pub fn flush(&mut self) -> Result<Vec<f32>> {
        let Some(inner) = self.inner.as_mut() else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        let delay = inner.output_delay() as u64;
        let pending = std::mem::take(&mut self.pending);
        if !pending.is_empty() {
            let indexing = Indexing::new().partial_len(pending.len());
            let mut padded = pending.clone();
            padded.resize(inner.input_frames_next(), 0.0);
            run_chunk(inner, &padded, Some(&indexing), &mut out)?;
        }
        // Un bloc de silence pour faire sortir le retard du filtre.
        let silence = vec![0.0; inner.input_frames_next()];
        run_chunk(
            inner,
            &silence,
            Some(&Indexing::new().partial_len(0)),
            &mut out,
        )?;

        let ratio = f64::from(TARGET_RATE) / f64::from(self.input_rate);
        let expected_total = (self.total_in as f64 * ratio).round() as u64 + delay;
        let keep = expected_total.saturating_sub(self.total_out) as usize;
        out.truncate(keep);
        self.total_out += out.len() as u64;
        Ok(out)
    }
}

fn run_chunk(
    inner: &mut Fft<f32>,
    input: &[f32],
    indexing: Option<&Indexing>,
    out: &mut Vec<f32>,
) -> Result<()> {
    let frames_out = inner.output_frames_next();
    let start = out.len();
    out.resize(start + frames_out, 0.0);
    let adapter_in = InterleavedSlice::new(input, 1, input.len())
        .map_err(|e| anyhow!("Tampon d'entrée invalide : {e}"))?;
    let mut adapter_out = InterleavedSlice::new_mut(&mut out[start..], 1, frames_out)
        .map_err(|e| anyhow!("Tampon de sortie invalide : {e}"))?;
    let (_, written) = inner
        .process_into_buffer(&adapter_in, &mut adapter_out, indexing)
        .map_err(|e| anyhow!("Rééchantillonnage : {e}"))?;
    out.truncate(start + written);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_averages_channels() {
        let stereo = [1.0, 0.0, 0.5, 0.5, -1.0, 1.0];
        assert_eq!(interleaved_to_mono(&stereo, 2), vec![0.5, 0.5, 0.0]);
        let quad = [1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.4];
        let mono = interleaved_to_mono(&quad, 4);
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 1.0).abs() < 1e-6 && (mono[1] - 0.1).abs() < 1e-6);
        assert_eq!(interleaved_to_mono(&[0.3, 0.2], 1), vec![0.3, 0.2]);
        // Trame incomplète ignorée, 0 canal → vide.
        assert_eq!(interleaved_to_mono(&[1.0, 1.0, 1.0], 2), vec![1.0]);
        assert!(interleaved_to_mono(&[1.0], 0).is_empty());
    }

    #[test]
    fn levels() {
        assert_eq!(rms(&[]), 0.0);
        assert!((rms(&[0.5, -0.5, 0.5, -0.5]) - 0.5).abs() < 1e-6);
        assert!((to_dbfs(1.0)).abs() < 1e-6);
        assert!((to_dbfs(0.1) + 20.0).abs() < 1e-4);
        assert_eq!(to_dbfs(0.0), -120.0);
    }

    fn sine(rate: u32, freq: f32, secs: f32) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5)
            .collect()
    }

    fn resample_all(rate: u32, input: &[f32], block: usize) -> Vec<f32> {
        let mut r = MonoResampler::new(rate).unwrap();
        let mut out = Vec::new();
        for chunk in input.chunks(block) {
            out.extend(r.process(chunk).unwrap());
        }
        out.extend(r.flush().unwrap());
        out
    }

    #[test]
    fn resamples_48k_to_16k_keeping_duration_and_level() {
        let input = sine(48_000, 440.0, 1.0);
        // Blocs irréguliers, comme les paquets WASAPI.
        let out = resample_all(48_000, &input, 337);
        let mut r = MonoResampler::new(48_000).unwrap();
        r.process(&[0.0; 10]).unwrap();
        let delay = r.inner.as_ref().unwrap().output_delay();
        assert_eq!(
            out.len(),
            16_000 + delay,
            "1 s → 16 000 échantillons + retard"
        );
        // Le niveau d'une sinusoïde de 440 Hz est conservé (≈ 0,354 RMS).
        let level = rms(&out[delay + 1000..delay + 15_000]);
        assert!((level - 0.3535).abs() < 0.01, "RMS {level}");
    }

    #[test]
    fn resamples_44k1_to_16k() {
        let input = sine(44_100, 300.0, 2.0);
        let out = resample_all(44_100, &input, 441);
        let mut r = MonoResampler::new(44_100).unwrap();
        r.process(&[0.0; 10]).unwrap();
        let delay = r.inner.as_ref().unwrap().output_delay();
        assert_eq!(out.len(), 32_000 + delay);
    }

    #[test]
    fn passthrough_at_16k() {
        let input = sine(16_000, 300.0, 0.5);
        let out = resample_all(16_000, &input, 100);
        assert_eq!(out, input);
    }

    #[test]
    fn rejects_zero_rate() {
        assert!(MonoResampler::new(0).is_err());
    }
}
