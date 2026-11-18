//! macOS — LOT À VENIR (L13, voir .tickets/…/TICKET.md). Rien n'est implémenté ce soir.
//!
//! Plan : porter depuis le projet open source Coucou (https://github.com/Louis-CFM/coucou, licence MIT)
//! - `NotchBuddy/Sources/App/SystemMute.swift` → détection du micro actif (Core Audio,
//!   kAudioDevicePropertyDeviceIsRunningSomewhere) → `CoreAudioMicMonitor`.
//! - `NotchBuddy/Sources/App/NoteAudio.swift` → capture du son système via un process tap Core Audio
//!   (macOS 14.4+) + micro → `CoreAudioRecorder`.
//! Obligations : conserver la mention de copyright MIT d'origine dans les fichiers portés ;
//! ne pas reprendre les noms « Coucou », « Mochi » ni leurs sons.

use super::{MicApp, MicMonitor, Recorder, RecordingInfo};
use std::path::Path;

pub struct CoreAudioMicMonitor;
impl CoreAudioMicMonitor {
    pub fn new() -> Self {
        Self
    }
}
impl MicMonitor for CoreAudioMicMonitor {
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>> {
        Ok(Vec::new())
    }
}

pub struct CoreAudioRecorder;
impl CoreAudioRecorder {
    pub fn new() -> Self {
        Self
    }
}
impl Recorder for CoreAudioRecorder {
    fn start(&mut self, _output: &Path) -> anyhow::Result<()> {
        anyhow::bail!("Enregistrement macOS pas encore disponible (lot L13)")
    }
    fn stop(&mut self) -> anyhow::Result<RecordingInfo> {
        anyhow::bail!("Aucun enregistrement en cours")
    }
    fn is_recording(&self) -> bool {
        false
    }
    fn elapsed_secs(&self) -> f64 {
        0.0
    }
}
