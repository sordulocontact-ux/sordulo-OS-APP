//! Encodage MP3 mono 16 kHz 32 kb/s (CBR), écrit en continu dans le fichier.
//!
//! 32 kb/s ≈ 14,4 Mo par heure : une heure d'appel tient sous la limite Supabase de 50 Mo.
//! Débit constant (CBR) : la durée se déduit exactement de la taille, sans trame d'en-tête
//! « Info »/« Xing » (qui ne tient d'ailleurs pas dans une trame de 144 octets à 32 kb/s / 16 kHz).

use super::dsp::TARGET_RATE;
use anyhow::{anyhow, Context, Result};
use mp3lame_encoder::{Bitrate, Builder, Encoder, FlushNoGap, Mode, MonoPcm, Quality};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::num::NonZeroU32;

#[cfg_attr(not(test), allow(dead_code))]
pub const BITRATE_KBPS: u32 = 32;

pub struct Mp3Writer {
    encoder: Encoder,
    out: BufWriter<File>,
    pcm: Vec<i16>,
    mp3: Vec<u8>,
    samples: u64,
}

impl Mp3Writer {
    /// Prépare l'encodeur. `file` est le fichier de sortie, vide, ouvert en écriture.
    pub fn new(file: File) -> Result<Self> {
        let lame_err = |e: mp3lame_encoder::BuildError| anyhow!("Encodeur MP3 : {e}");
        let encoder = Builder::new()
            .ok_or_else(|| anyhow!("Encodeur MP3 : initialisation impossible"))?
            .with_num_channels(1)
            .map_err(lame_err)?
            .with_sample_rate(TARGET_RATE)
            .map_err(lame_err)?
            .with_output_sample_rate(NonZeroU32::new(TARGET_RATE))
            .map_err(lame_err)?
            .with_mode(Mode::Mono)
            .map_err(lame_err)?
            .with_brate(Bitrate::Kbps32)
            .map_err(lame_err)?
            .with_quality(Quality::Good)
            .map_err(lame_err)?
            .with_to_write_vbr_tag(false)
            .map_err(lame_err)?
            .build()
            .map_err(lame_err)?;
        Ok(Self {
            encoder,
            out: BufWriter::with_capacity(64 * 1024, file),
            pcm: Vec::new(),
            mp3: Vec::new(),
            samples: 0,
        })
    }

    /// Encode des échantillons mono 16 kHz (flottants dans [-1, 1]) et écrit le résultat.
    pub fn write(&mut self, samples: &[f32]) -> Result<()> {
        if samples.is_empty() {
            return Ok(());
        }
        self.pcm.clear();
        self.pcm.extend(
            samples
                .iter()
                .map(|&s| (s.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16),
        );
        self.mp3.clear();
        self.mp3
            .reserve(mp3lame_encoder::max_required_buffer_size(self.pcm.len()));
        self.encoder
            .encode_to_vec(MonoPcm(self.pcm.as_slice()), &mut self.mp3)
            .map_err(|e| anyhow!("Encodage MP3 : {e}"))?;
        self.out
            .write_all(&self.mp3)
            .context("Écriture du fichier d'enregistrement impossible (disque plein ?)")?;
        self.samples += samples.len() as u64;
        Ok(())
    }

    /// Nombre d'échantillons encodés jusqu'ici.
    pub fn samples(&self) -> u64 {
        self.samples
    }

    /// Vide l'encodeur, écrit les dernières trames, ferme le fichier. Renvoie sa taille en octets.
    pub fn finish(mut self) -> Result<u64> {
        self.mp3.clear();
        self.mp3.reserve(7200 * 2);
        self.encoder
            .flush_to_vec::<FlushNoGap>(&mut self.mp3)
            .map_err(|e| anyhow!("Finalisation MP3 : {e}"))?;
        self.out
            .write_all(&self.mp3)
            .context("Écriture du fichier d'enregistrement impossible (disque plein ?)")?;

        let file = self
            .out
            .into_inner()
            .map_err(|e| anyhow!("Écriture du fichier d'enregistrement : {}", e.error()))?;
        file.sync_all()
            .context("Écriture du fichier d'enregistrement impossible")?;
        let size = file.metadata().map(|m| m.len())?;
        Ok(size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_valid_cbr_mp3_of_expected_size() {
        let path = std::env::temp_dir().join(format!("sordulo-l9-test-{}.mp3", std::process::id()));
        let file = File::create(&path).unwrap();
        let mut w = Mp3Writer::new(file).unwrap();
        // 10 s de sinusoïde 440 Hz, par blocs de 100 ms.
        let block: Vec<f32> = (0..1600)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16_000.0).sin() * 0.3)
            .collect();
        for _ in 0..100 {
            w.write(&block).unwrap();
        }
        assert_eq!(w.samples(), 160_000);
        let size = w.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(size, bytes.len() as u64);
        // 10 s à 32 kb/s ≈ 40 000 octets.
        assert!((38_000..43_000).contains(&size), "taille {size}");
        // Synchro de trame MPEG + MPEG-2 Layer III (16 kHz), mono.
        assert_eq!(bytes[0], 0xFF);
        assert_eq!(bytes[1] & 0xFE, 0xF2, "MPEG-2 Layer III");
        assert_eq!(bytes[2] >> 4, 0b0100, "32 kb/s");
        assert_eq!(bytes[3] >> 6, 0b11, "mono");
    }
}
