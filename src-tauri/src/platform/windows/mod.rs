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
//! - `activity` : indices d'appel pour les navigateurs (son joué, titres de fenêtres).
//! - `url_scheme` : association du schéma `sordulo://` (retour du lien de connexion).
//! - `cursor`   : position du curseur et bouton principal (clics qui passent à travers l'île).
//! - `editor`   : rouvrir VS Code sur le dossier d'une session Claude Code.
//! - `clipboard` : copie de texte dans le presse-papiers (chemin d'un fichier déposé sur « Claude Code »).
//! - `media`    : musique en cours, pochette et commandes (contrôles multimédias du système, WinRT).
//! - `open_url` : ouverture d'une URL par l'app associée (`ShellExecuteW`, connecteur Spotify).
//! - `output_tap` : écoute (loopback) du son de l'ordinateur pour l'analyse de la musique de l'île.

mod activity;
mod capture;
mod clipboard;
mod cursor;
mod editor;
mod dsp;
mod encoder;
mod media;
mod mic;
mod mixer;
mod open_url;
mod output_tap;
mod pages;
mod recorder;
mod timeline;
mod url_scheme;

pub use activity::{processes_playing_audio, visible_window_titles};
pub use clipboard::copy_text;
pub use pages::browser_page_titles;
pub use cursor::cursor_state;
pub use editor::{editor_storage_file, open_in_editor};
pub use media::{media_command, now_playing, now_playing_artwork};
pub use mic::RegistryMicMonitor;
pub use open_url::open_url;
pub use output_tap::LoopbackTap;
pub use recorder::WasapiRecorder;
pub use url_scheme::register_url_scheme;
