//! Interface commune des fonctions « système » de l'app bureau.
//!
//! Une implémentation par système d'exploitation :
//! - `windows/` : ce soir (registre CapabilityAccessManager + WASAPI + MP3).
//! - `macos/`   : lot à venir (Core Audio : détection du micro + process tap), voir TICKET.md (L13).
//!
//! Le reste de l'app (tray, commandes Tauri, boucle de détection) ne dépend QUE de ce module :
//! jamais de `cfg(windows)` en dehors de `platform/`.

use std::path::{Path, PathBuf};

/// Une application qui utilise le micro en ce moment.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicApp {
    /// Identifiant stable (nom de la sous-clé du registre sous Windows, bundle id sous macOS).
    pub id: String,
    /// Nom lisible (ex. « chrome.exe », « Microsoft Teams »).
    pub display_name: String,
}

/// Détecte les applications qui utilisent le micro. Appelé toutes les 2 s par la boucle de détection.
pub trait MicMonitor: Send {
    /// Applications qui utilisent le micro maintenant, Sordulo OS elle-même exclue.
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>>;
}

/// Résultat d'un enregistrement terminé.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub path: PathBuf,
    pub duration_secs: f64,
    pub size_bytes: u64,
    /// Type MIME du fichier produit (ex. "audio/mpeg").
    pub mime_type: String,
}

/// Enregistre le micro ET le son de l'ordinateur (loopback de la sortie par défaut), mixés dans un seul fichier.
/// Format visé : MP3 mono 16 kHz ~32 kb/s (≈ 15 Mo/heure), car Supabase Free limite un fichier à 50 Mo.
pub trait Recorder: Send {
    /// Démarre l'enregistrement vers `output` (le fichier est créé ; les dossiers parents existent).
    fn start(&mut self, output: &Path) -> anyhow::Result<()>;
    /// Arrête, finalise le fichier et renvoie ses informations.
    fn stop(&mut self) -> anyhow::Result<RecordingInfo>;
    fn is_recording(&self) -> bool;
    /// Durée enregistrée jusqu'ici, en secondes (0 si rien en cours).
    fn elapsed_secs(&self) -> f64;
}

/// Extension du fichier produit par `Recorder` (sans point).
pub const RECORDING_EXTENSION: &str = "mp3";

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

/// Détecteur de micro du système courant.
pub fn mic_monitor() -> Box<dyn MicMonitor> {
    #[cfg(windows)]
    {
        Box::new(windows::RegistryMicMonitor::new())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::CoreAudioMicMonitor::new())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Box::new(Unsupported)
    }
}

/// Enregistreur du système courant.
pub fn recorder() -> Box<dyn Recorder> {
    #[cfg(windows)]
    {
        Box::new(windows::WasapiRecorder::new())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::CoreAudioRecorder::new())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Box::new(Unsupported)
    }
}

/// Associe le schéma d'URL `scheme://` à l'exécutable courant (retour du lien de connexion par email).
/// macOS : se déclare dans l'Info.plist du bundle (lot L13), rien à faire à l'exécution.
pub fn register_url_scheme(scheme: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe()?;
        windows::register_url_scheme(scheme, &exe)
    }
    #[cfg(not(windows))]
    {
        let _ = scheme;
        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
struct Unsupported;

#[cfg(not(any(windows, target_os = "macos")))]
impl MicMonitor for Unsupported {
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>> {
        Ok(Vec::new())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
impl Recorder for Unsupported {
    fn start(&mut self, _output: &Path) -> anyhow::Result<()> {
        anyhow::bail!("Enregistrement non disponible sur ce système")
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
