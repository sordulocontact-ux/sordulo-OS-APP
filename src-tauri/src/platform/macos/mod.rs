//! macOS.
//! - `island.rs` : curseur, encoche, niveau de la fenêtre de l'île.
//! - `audio.rs` : apps qui utilisent le micro ou jouent du son (processus Core Audio, macOS 14+).
//! - `pages.rs` : titres des onglets des navigateurs (AppleScript), pour reconnaître Meet, Discord…
//! - Presse-papiers par `pbcopy`.
//!
//! Enregistrement : LOT À VENIR (L13, voir .tickets/…/TICKET.md). Plan : porter depuis le projet open
//! source Coucou (https://github.com/Louis-CFM/coucou, licence MIT)
//! `NotchBuddy/Sources/App/NoteAudio.swift` → capture du son système via un process tap Core Audio
//! (macOS 14.4+) + micro → `CoreAudioRecorder`.
//! Obligations : conserver la mention de copyright MIT d'origine dans les fichiers portés ;
//! ne pas reprendre les noms « Coucou », « Mochi » ni leurs sons.

mod audio;
mod island;
mod pages;

pub use island::{cursor_state, primary_notch, raise_island_window};
pub use pages::browser_page_titles;

/// Noms courts (voir `call_apps::short_name`) des apps qui jouent du son en ce moment.
pub fn processes_playing_audio() -> Vec<String> {
    audio::apps_with_running(audio::Direction::Output)
        .iter()
        .map(|app| crate::call_apps::short_name(&app.id))
        .collect()
}

use super::{MicApp, MicMonitor, Recorder, RecordingInfo};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub struct CoreAudioMicMonitor;
impl CoreAudioMicMonitor {
    pub fn new() -> Self {
        Self
    }
}
impl MicMonitor for CoreAudioMicMonitor {
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>> {
        Ok(audio::apps_with_running(audio::Direction::Input))
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

/// Presse-papiers par `pbcopy` (texte passé sur stdin, jamais en argument).
pub fn copy_text(text: &str) -> anyhow::Result<()> {
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("pbcopy : stdin indisponible"))?
        .write_all(text.as_bytes())?;
    let status = child.wait()?;
    anyhow::ensure!(status.success(), "pbcopy a échoué ({status})");
    Ok(())
}
