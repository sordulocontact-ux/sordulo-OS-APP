//! Interface commune des fonctions « système » de l'app bureau.
//!
//! Une implémentation par système d'exploitation :
//! - `windows/` : ce soir (registre CapabilityAccessManager + WASAPI + MP3).
//! - `macos/`   : île (curseur, encoche, niveau de fenêtre), détection du micro et des appels (processus
//!   Core Audio, onglets par AppleScript), enregistrement (micro + process tap), presse-papiers.
//! - Musique en cours (`now_playing`, `media_command`) : `windows/media.rs` (contrôles multimédias du
//!   système) et `macos/media.rs` (Spotify et Musique par AppleScript).
//! - Ouverture d'une URL (`open_url`, connecteur Spotify) : `windows/open_url.rs` et `macos/open_url.rs`.
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
    /// Niveau sonore actuel (RMS linéaire 0..1, le plus fort du micro et du son de l'ordinateur sur
    /// ~100 ms), `None` hors enregistrement ou si non disponible. Ne bloque jamais.
    /// Le ticker de l'île passe par [`recording_level`] (pas de verrou de l'enregistreur) ; cette
    /// méthode sert à qui tient déjà l'enregistreur.
    #[allow(dead_code)]
    fn audio_level(&self) -> Option<f32> {
        None
    }
}

/// Curseur de la souris, pour la surveillance de l'île (clics qui passent à travers).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CursorState {
    /// Position en px physiques, coordonnées de l'écran virtuel (origine : coin haut-gauche de l'écran principal).
    pub x: i32,
    pub y: i32,
    /// Bouton principal enfoncé (le gauche, ou le droit si les boutons sont inversés).
    pub primary_down: bool,
}

/// Encoche de la caméra en haut de l'écran principal (Mac), en points (px logiques).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Notch {
    pub width: f64,
    pub height: f64,
}

/// Extension du fichier produit par `Recorder` (sans point).
pub const RECORDING_EXTENSION: &str = "mp3";

/// Morceau en cours dans un lecteur du système (Windows : contrôles multimédias du système, tous les
/// lecteurs ; macOS : Spotify et Musique par AppleScript). Les apps d'appel sont écartées (`music::is_excluded`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NowPlaying {
    /// Identifiant du lecteur : AppUserModelId sous Windows, bundle id sous macOS.
    pub app_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// `false` : en pause.
    pub playing: bool,
    /// Position dans le morceau à l'instant `position_at`, en ms (`None` si le lecteur ne la donne pas).
    pub position_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    /// Epoch Unix en ms de la lecture de `position_ms`.
    pub position_at: u64,
    /// Change quand la pochette change (même morceau = même clé) ; `None` : pas de pochette.
    /// La pochette elle-même se lit par [`now_playing_artwork`], seulement quand cette clé change.
    pub artwork_key: Option<String>,
}

/// Commande envoyée au lecteur depuis l'île (`MusicCommand` du contrat : `previous`, `playPause`, `next`,
/// `open`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaCommand {
    Previous,
    PlayPause,
    Next,
    /// Met la fenêtre du lecteur au premier plan.
    Open,
}

/// Morceau en cours (en lecture de préférence, sinon en pause), `None` si rien. Appelé ~toutes les secondes
/// par la boucle de la musique ; ne bloque pas longtemps (macOS : lecture en arrière-plan mise en cache).
pub fn now_playing() -> anyhow::Result<Option<NowPlaying>> {
    #[cfg(windows)]
    {
        windows::now_playing()
    }
    #[cfg(target_os = "macos")]
    {
        macos::now_playing()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(None)
    }
}

/// Octets bruts (PNG ou JPEG) de la pochette du morceau rendu en dernier par [`now_playing`], `None` sans
/// pochette. Bloquant (lecture du flux, téléchargement) : appelé seulement quand `artwork_key` change.
pub fn now_playing_artwork() -> anyhow::Result<Option<Vec<u8>>> {
    #[cfg(windows)]
    {
        windows::now_playing_artwork()
    }
    #[cfg(target_os = "macos")]
    {
        macos::now_playing_artwork()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Ok(None)
    }
}

/// Écoute continue du son joué par l'ordinateur (analyse de la musique de l'île, `music_levels`).
/// S'utilise sur le thread qui l'a ouverte (objets COM sous Windows) ; la fermer = la lâcher (`drop`).
pub trait OutputTap {
    /// Fréquence d'échantillonnage du signal rendu par [`OutputTap::read`].
    fn sample_rate(&self) -> u32;
    /// Ajoute à la fin de `out` les échantillons mono reçus depuis l'appel précédent ; n'attend jamais
    /// (rien de neuf : `out` inchangé, ex. loopback quand rien ne joue). Erreur : périphérique perdu,
    /// l'écoute est à rouvrir plus tard.
    fn read(&mut self, out: &mut Vec<f32>) -> anyhow::Result<()>;
}

/// Écoute du son de l'ordinateur non disponible sur ce système (réponse définitive : inutile de réessayer).
#[cfg_attr(windows, allow(dead_code))]
#[derive(Debug, thiserror::Error)]
#[error(
    "analyse du son de l'ordinateur non disponible sur ce système : l'île garde son égaliseur simulé"
)]
pub struct OutputTapUnavailable;

/// Ouvre l'écoute du son joué par l'ordinateur.
///
/// - Windows : loopback WASAPI du périphérique de sortie par défaut, mode partagé (`windows/output_tap.rs`),
///   sans autorisation ni voyant, en parallèle de l'enregistrement d'un appel s'il y en a un.
/// - macOS : non disponible, par décision de Maël (21/11) : capturer le son du système passe par un « process
///   tap » Core Audio qui allume le voyant violet d'enregistrement dans la barre des menus pendant toute
///   l'écoute de musique. L'île garde donc l'égaliseur et le tempo simulés. Exception assumée à la règle
///   « Windows ET macOS » (ticket `2026-11-21-ile-vrai-son`), à signaler à Sacha.
/// - Autres systèmes : non disponible.
///
/// Erreur [`OutputTapUnavailable`] : définitive ; autre erreur (aucune sortie audio…) : réessayer plus tard.
pub fn output_tap() -> anyhow::Result<Box<dyn OutputTap>> {
    #[cfg(windows)]
    {
        Ok(Box::new(windows::LoopbackTap::open()?))
    }
    #[cfg(target_os = "macos")]
    {
        // Volontaire (voir plus haut) : pas de process tap pour la musique, pas de voyant violet.
        anyhow::bail!(OutputTapUnavailable)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        anyhow::bail!(OutputTapUnavailable)
    }
}

/// Envoie une commande au lecteur rendu en dernier par [`now_playing`]. Bloquant (quelques centaines de ms).
pub fn media_command(command: MediaCommand) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        windows::media_command(command)
    }
    #[cfg(target_os = "macos")]
    {
        macos::media_command(command)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = command;
        anyhow::bail!("Commandes du lecteur non disponibles sur ce système")
    }
}

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

/// Niveau sonore de l'enregistrement en cours (voir `Recorder::audio_level`), lu sans prendre le
/// verrou de l'enregistreur : appelable à haute fréquence. `None` hors enregistrement.
pub fn recording_level() -> Option<f32> {
    #[cfg(windows)]
    {
        windows::WasapiRecorder::live_level()
    }
    #[cfg(target_os = "macos")]
    {
        macos::CoreAudioRecorder::live_level()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

/// Apps qui jouent du son en ce moment, en noms courts (`call_apps::short_name` : exécutable en minuscules
/// sans `.exe` sous Windows, `arc`, `chrome`… sur Mac). Vide si non disponible.
pub fn processes_playing_audio() -> Vec<String> {
    #[cfg(windows)]
    {
        windows::processes_playing_audio().unwrap_or_else(|e| {
            log::debug!("sessions audio : {e:#}");
            Vec::new()
        })
    }
    #[cfg(target_os = "macos")]
    {
        macos::processes_playing_audio()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Vec::new()
    }
}

/// Titres des fenêtres visibles. Vide si non disponible (Mac : il faudrait l'autorisation
/// d'enregistrement de l'écran ; on lit plutôt les onglets des navigateurs, voir `browser_page_titles`).
pub fn visible_window_titles() -> Vec<String> {
    #[cfg(windows)]
    {
        windows::visible_window_titles()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Titres des fenêtres visibles d'un navigateur (nom court, voir `call_apps::short_name`) et des pages
/// qu'elles affichent (Arc ne met pas le titre de la page dans celui de sa fenêtre). Vide si non disponible.
pub fn browser_page_titles(browser: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        windows::browser_page_titles(browser)
    }
    #[cfg(target_os = "macos")]
    {
        macos::browser_page_titles(browser)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = browser;
        Vec::new()
    }
}

/// Position du curseur et état du bouton principal. `None` si non disponible.
pub fn cursor_state() -> Option<CursorState> {
    #[cfg(windows)]
    {
        windows::cursor_state()
    }
    #[cfg(target_os = "macos")]
    {
        macos::cursor_state()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

/// Encoche de l'écran principal, `None` sans encoche (Windows, Mac sans encoche, écran externe en
/// principal). À appeler sur le thread principal.
pub fn primary_notch() -> Option<Notch> {
    #[cfg(target_os = "macos")]
    {
        macos::primary_notch()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// Réglages système de la fenêtre de l'île après sa création (Mac : au-dessus de la barre des menus).
/// À appeler sur le thread principal.
pub fn prepare_island_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        match window.ns_window() {
            Ok(ns_window) => macos::raise_island_window(ns_window),
            Err(e) => log::warn!("fenêtre native de l'île introuvable : {e}"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

/// Rend `path` exécutable (relais Claude Code copié par l'app). Sans effet sous Windows.
pub fn make_executable(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)?.permissions();
        if permissions.mode() & 0o111 != 0o111 {
            permissions.set_mode(permissions.mode() | 0o755);
            std::fs::set_permissions(path, permissions)?;
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// App d'où vient une session Claude Code (transmise par le relais `sordulo-hook`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EditorHost {
    /// Exécutable de l'éditeur (VS Code, Cursor…) quand la session tourne dans son terminal.
    pub exe: Option<String>,
    /// Bundle id de l'app (macOS).
    pub bundle_id: Option<String>,
}

/// `storage.json` de l'éditeur de la session (VS Code, Cursor…), qui liste ses fenêtres ouvertes.
pub fn editor_storage_file(editor: &EditorHost) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        windows::editor_storage_file(editor)
    }
    #[cfg(target_os = "macos")]
    {
        macos::editor_storage_file(editor)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = editor;
        None
    }
}

/// Met au premier plan la fenêtre de l'éditeur ouverte sur `folder` (ou l'ouvre). Bloquant (~100 ms).
pub fn open_in_editor(editor: &EditorHost, folder: &Path) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        windows::open_in_editor(editor, folder)
    }
    #[cfg(target_os = "macos")]
    {
        macos::open_in_editor(editor, folder)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (editor, folder);
        anyhow::bail!("Ouverture de l'éditeur non disponible sur ce système")
    }
}

/// Copie `text` dans le presse-papiers du système (chemin d'un fichier déposé sur « Claude Code »).
pub fn copy_text(text: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        windows::copy_text(text)
    }
    #[cfg(target_os = "macos")]
    {
        macos::copy_text(text)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = text;
        anyhow::bail!("Copie dans le presse-papiers pas encore disponible sur ce système")
    }
}

/// URL que l'app accepte d'ouvrir : `https://…` ou `spotify:…` seulement (jamais un chemin ni un
/// programme), sans espace ni caractère de contrôle, longueur bornée.
pub fn is_openable_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("spotify:"))
        && url.len() <= 4096
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Ouvre une URL avec l'app associée du système : navigateur par défaut pour `https://` (page
/// d'autorisation de Spotify), app Spotify pour `spotify:`. Erreur si aucune app ne la prend en charge.
/// Windows : `ShellExecuteW` (`windows/open_url.rs`) ; macOS : `/usr/bin/open` (`macos/open_url.rs`).
pub fn open_url(url: &str) -> anyhow::Result<()> {
    anyhow::ensure!(is_openable_url(url), "adresse refusée");
    #[cfg(windows)]
    {
        windows::open_url(url)
    }
    #[cfg(target_os = "macos")]
    {
        macos::open_url(url)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        anyhow::bail!("Ouverture d'adresse non disponible sur ce système")
    }
}

/// Associe le schéma d'URL `scheme://` à l'exécutable courant (retour du lien de connexion par email).
/// macOS : déclaré dans `Info.plist` (CFBundleURLTypes) et reçu par `RunEvent::Opened`, rien à faire ici.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adresses_ouvrables() {
        assert!(is_openable_url("https://accounts.spotify.com/authorize?client_id=a&scope=b%20c"));
        assert!(is_openable_url("spotify:"));
        assert!(!is_openable_url("http://open.spotify.com"));
        assert!(!is_openable_url("C:\\Windows\\System32\\calc.exe"));
        assert!(!is_openable_url("file:///etc/passwd"));
        assert!(!is_openable_url("https://a b"));
        assert!(!is_openable_url("spotify:\n--args"));
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
