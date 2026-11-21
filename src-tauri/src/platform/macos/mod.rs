//! macOS.
//! - `island.rs` : curseur, encoche, niveau de la fenêtre de l'île.
//! - `audio.rs` : apps qui utilisent le micro ou jouent du son (processus Core Audio, macOS 14+).
//! - `pages.rs` : titres des onglets des navigateurs (AppleScript), pour reconnaître Meet, Discord…
//! - `editor.rs` : rouvrir la fenêtre VS Code (ou l'app) d'une session Claude Code.
//! - `media.rs` : musique en cours dans Spotify et Musique (AppleScript), pochette, commandes.
//! - Presse-papiers par `pbcopy`.
//!
//! - `capture.rs` : capture du micro et du son de l'ordinateur (process tap, macOS 14.2+).
//!
//! Enregistrement : seule la capture est propre au Mac. Ligne de temps, mix, rééchantillonnage, MP3 et
//! orchestration sont les modules purs de `windows/` (aucun appel Windows dedans), inclus ici tels quels
//! par `#[path]` : une correction faite d'un côté vaut pour les deux.
//! Obligations : conserver la mention de copyright MIT d'origine dans les fichiers portés ;
//! ne pas reprendre les noms « Coucou », « Mochi » ni leurs sons.

mod audio;
mod capture;
mod editor;
mod island;
mod media;
mod pages;

// Chaîne d'enregistrement partagée avec Windows (voir l'en-tête).
#[path = "../windows/dsp.rs"]
mod dsp;
#[path = "../windows/encoder.rs"]
mod encoder;
#[path = "../windows/mixer.rs"]
mod mixer;
#[path = "../windows/recorder.rs"]
mod recorder;
#[path = "../windows/timeline.rs"]
mod timeline;

/// Enregistreur Mac : capture Core Audio + chaîne partagée (MP3 mono 16 kHz 32 kb/s).
pub use recorder::WasapiRecorder as CoreAudioRecorder;

pub use editor::{editor_storage_file, open_in_editor};
pub use island::{cursor_state, primary_notch, raise_island_window};
pub use media::{media_command, now_playing, now_playing_artwork};
pub use pages::browser_page_titles;

/// Noms courts (voir `call_apps::short_name`) des apps qui jouent du son en ce moment.
pub fn processes_playing_audio() -> Vec<String> {
    audio::apps_with_running(audio::Direction::Output)
        .iter()
        .map(|app| crate::call_apps::short_name(&app.id))
        .collect()
}

use super::{MicApp, MicMonitor};
use std::io::Write;
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

#[cfg(test)]
mod tests {
    use super::CoreAudioRecorder;
    use crate::platform::Recorder;

    /// Manuel : `SORDULO_TEST_RECORDING=/chemin/test.mp3 cargo test record_a_few_seconds -- --ignored
    /// --nocapture` (demande les autorisations micro et son du système au terminal).
    #[test]
    #[ignore]
    fn record_a_few_seconds() {
        let path = std::env::var("SORDULO_TEST_RECORDING").expect("SORDULO_TEST_RECORDING");
        crate::logging::init();
        let mut recorder = CoreAudioRecorder::new();
        let started = std::time::Instant::now();
        recorder.start(std::path::Path::new(&path)).expect("démarrage");
        println!("démarré en {:?}", started.elapsed());
        // Son de l'ordinateur à t ≈ 2 s (le micro capte la pièce).
        let player = std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let _ = std::process::Command::new("/usr/bin/afplay")
                .arg("/System/Library/Sounds/Submarine.aiff")
                .status();
        });
        for _ in 0..12 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            println!("niveau : {:?}", CoreAudioRecorder::live_level());
        }
        let _ = player.join();
        let info = recorder.stop().expect("arrêt");
        println!("{info:?}");
    }
}
