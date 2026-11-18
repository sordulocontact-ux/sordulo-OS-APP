//! Implémentation Windows de l'interface `platform` (lot L9).
//!
//! - [`RegistryMicMonitor`] : détection des applications qui utilisent le micro, par le registre
//!   `CapabilityAccessManager\ConsentStore\microphone` (apps empaquetées + `NonPackaged`).
//! - [`WasapiRecorder`] : capture WASAPI en mode partagé du micro par défaut ET du son de l'ordinateur
//!   (loopback de la sortie par défaut), alignement sur l'horloge, mix, puis MP3 mono 16 kHz 32 kb/s.
//!
//! Organisation :
//! - `mic`      : lecture du registre (pur + accès registre).
//! - `capture`  : threads WASAPI (un par source), reconnexion si le périphérique disparaît.
//! - `dsp`      : conversion en mono, rééchantillonnage `rubato`, mesures RMS.
//! - `timeline` : placement des échantillons sur l'horloge commune, pistes avec silence.
//! - `mixer`    : mix des deux pistes (niveau automatique borné + saturation douce).
//! - `encoder`  : écriture MP3 en continu (`mp3lame-encoder`).
//! - `recorder` : orchestration (threads, arrêt, `RecordingInfo`).

mod capture;
mod dsp;
mod encoder;
mod mic;
mod mixer;
mod recorder;
mod timeline;

pub use mic::RegistryMicMonitor;
pub use recorder::WasapiRecorder;
