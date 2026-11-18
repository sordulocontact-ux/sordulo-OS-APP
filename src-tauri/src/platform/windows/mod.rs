//! TEMPORARY STUB — replaced by lot L9 (registry mic detection + WASAPI capture + MP3).
//! Exists only so the Tauri shell (lot L8) compiles while L9 works in parallel.

use super::{MicApp, MicMonitor, RecordingInfo, Recorder};
use std::path::Path;

pub struct RegistryMicMonitor;
impl RegistryMicMonitor {
    pub fn new() -> Self {
        Self
    }
}
impl MicMonitor for RegistryMicMonitor {
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>> {
        Ok(Vec::new())
    }
}

pub struct WasapiRecorder;
impl WasapiRecorder {
    pub fn new() -> Self {
        Self
    }
}
impl Recorder for WasapiRecorder {
    fn start(&mut self, _output: &Path) -> anyhow::Result<()> {
        anyhow::bail!("stub")
    }
    fn stop(&mut self) -> anyhow::Result<RecordingInfo> {
        anyhow::bail!("stub")
    }
    fn is_recording(&self) -> bool {
        false
    }
    fn elapsed_secs(&self) -> f64 {
        0.0
    }
}
