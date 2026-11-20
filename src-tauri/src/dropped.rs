//! Fichier audio déposé sur l'île : lecture contrôlée pour `read_dropped_audio`.
//!
//! Le chemin vient de l'événement de dépôt natif de la webview (le front le renvoie tel quel). Rien ne
//! garantit qu'il est honnête : la commande est réservée à la fenêtre de l'île, et le fichier doit être
//! un fichier ordinaire, d'extension audio connue, d'une taille raisonnable.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::events::WINDOW_PROMPT;

/// Extensions acceptées, en minuscules (le même jeu que le front : `src/features/island/drop`).
/// `mp4` : conteneur utilisé aussi pour l'audio seul (enregistrements de réunions).
pub const AUDIO_EXTENSIONS: [&str; 8] = ["m4a", "mp3", "wav", "ogg", "webm", "aac", "flac", "mp4"];

/// Taille maximale lue : 500 Mo. Le serveur refuse au-delà de 50 Mo (Supabase Free) : le front le dira
/// après lecture ; cette limite protège seulement la mémoire de l'app contre un fichier énorme.
pub const MAX_DROPPED_AUDIO_BYTES: u64 = 500 * 1024 * 1024;

/// Seule la fenêtre de l'île reçoit des dépôts.
pub fn check_window(label: &str) -> Result<(), String> {
    if label == WINDOW_PROMPT {
        Ok(())
    } else {
        Err("Seule la fenêtre de l'île peut lire un fichier déposé.".into())
    }
}

/// Extension audio connue (insensible à la casse).
pub fn check_extension(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match extension {
        Some(e) if AUDIO_EXTENSIONS.contains(&e.as_str()) => Ok(()),
        _ => Err("Ce fichier n'est pas un fichier audio pris en charge (m4a, mp3, wav, ogg, webm, aac, flac, mp4).".into()),
    }
}

/// Taille non nulle et sous la limite.
pub fn check_size(len: u64) -> Result<(), String> {
    if len == 0 {
        return Err("Ce fichier est vide.".into());
    }
    if len > MAX_DROPPED_AUDIO_BYTES {
        return Err(format!(
            "Ce fichier est trop volumineux ({} Mo). Maximum : {} Mo.",
            len / (1024 * 1024),
            MAX_DROPPED_AUDIO_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

/// Chemin vérifié : non vide, extension audio, fichier ordinaire existant (liens résolus), taille correcte.
pub fn checked_dropped_audio(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Aucun fichier à lire.".into());
    }
    let given = Path::new(path);
    check_extension(given)?;
    let resolved =
        std::fs::canonicalize(given).map_err(|_| "Ce fichier est introuvable.".to_string())?;
    // Un lien vers un autre type de fichier ne doit pas contourner la liste d'extensions.
    check_extension(&resolved)?;
    let metadata =
        std::fs::metadata(&resolved).map_err(|e| format!("Impossible de lire ce fichier : {e}"))?;
    if !metadata.is_file() {
        return Err("Ce n'est pas un fichier.".into());
    }
    check_size(metadata.len())?;
    Ok(resolved)
}

/// Lit le fichier vérifié. La lecture est bornée : un fichier qui grossit pendant la lecture est refusé.
pub fn read_dropped_audio(path: &str) -> Result<Vec<u8>, String> {
    let file_path = checked_dropped_audio(path)?;
    let file =
        File::open(&file_path).map_err(|e| format!("Impossible d'ouvrir ce fichier : {e}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_DROPPED_AUDIO_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Impossible de lire ce fichier : {e}"))?;
    check_size(bytes.len() as u64)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dossier temporaire propre à un test.
    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("sordulo-dropped-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_the_island_window_may_read() {
        assert!(check_window("prompt").is_ok());
        assert!(check_window("main").is_err());
        assert!(check_window("").is_err());
    }

    #[test]
    fn audio_extensions_are_case_insensitive() {
        for name in [
            "a.mp3",
            "a.M4A",
            "dir/a.Wav",
            "a.ogg",
            "a.webm",
            "a.aac",
            "a.FLAC",
            "a.mp4",
        ] {
            assert!(check_extension(Path::new(name)).is_ok(), "{name}");
        }
    }

    #[test]
    fn other_extensions_are_refused() {
        for name in [
            "a.txt",
            "a.exe",
            "a",
            "a.mp3.exe",
            ".mp3",
            "a.mp3 ",
            "a.pdf",
        ] {
            assert!(check_extension(Path::new(name)).is_err(), "{name}");
        }
    }

    #[test]
    fn size_limits() {
        assert!(check_size(0).is_err());
        assert!(check_size(1).is_ok());
        assert!(check_size(MAX_DROPPED_AUDIO_BYTES).is_ok());
        let too_big = check_size(MAX_DROPPED_AUDIO_BYTES + 1).unwrap_err();
        assert!(too_big.contains("500 Mo"), "{too_big}");
    }

    #[test]
    fn empty_and_missing_paths_are_refused() {
        assert!(checked_dropped_audio("").is_err());
        assert!(checked_dropped_audio("   ").is_err());
        let dir = scratch("missing");
        let missing = dir.join("absent.mp3");
        assert_eq!(
            checked_dropped_audio(missing.to_str().unwrap()).unwrap_err(),
            "Ce fichier est introuvable."
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_directory_named_like_audio_is_refused() {
        let dir = scratch("dir");
        let folder = dir.join("dossier.mp3");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(checked_dropped_audio(folder.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_real_audio_file_is_read() {
        let dir = scratch("ok");
        let file = dir.join("appel.mp3");
        std::fs::write(&file, [1u8, 2, 3, 4]).unwrap();
        assert_eq!(
            read_dropped_audio(file.to_str().unwrap()).unwrap(),
            vec![1, 2, 3, 4]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_empty_or_non_audio_file_is_refused() {
        let dir = scratch("refused");
        let empty = dir.join("vide.wav");
        std::fs::write(&empty, []).unwrap();
        assert_eq!(
            read_dropped_audio(empty.to_str().unwrap()).unwrap_err(),
            "Ce fichier est vide."
        );
        let text = dir.join("notes.txt");
        std::fs::write(&text, b"salut").unwrap();
        assert!(read_dropped_audio(text.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
