//! Fichier déposé sur l'île : copie contrôlée pour `save_dropped_file`.
//!
//! Le dépôt HTML5 (géré par WebView2) donne au front le contenu du fichier, pas son chemin d'origine. La zone
//! « Claude Code » a pourtant besoin d'un chemin : le front envoie les octets, on en garde une copie dans
//! `app_local_data_dir()/drops/<horodatage>-<nom>` et on renvoie ce chemin absolu. Rien ne garantit que le
//! nom est honnête : il est assaini (pas de séparateur, pas de `..`, longueur bornée). Les copies de plus de
//! 7 jours sont supprimées au passage.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::events::WINDOW_PROMPT;

/// Taille maximale d'une copie : 50 Mo, comme l'envoi d'un audio (limite Supabase Free).
pub const MAX_DROPPED_FILE_BYTES: usize = 50 * 1024 * 1024;

/// Durée de conservation d'une copie.
pub const DROPPED_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Longueur maximale du nom assaini (extension comprise), en caractères.
const MAX_NAME_CHARS: usize = 100;

/// Nom utilisé quand l'original ne laisse rien d'utilisable.
const FALLBACK_NAME: &str = "fichier";

/// Seule la fenêtre de l'île reçoit des dépôts.
pub fn check_window(label: &str) -> Result<(), String> {
    if label == WINDOW_PROMPT {
        Ok(())
    } else {
        Err("Seule la fenêtre de l'île peut enregistrer un fichier déposé.".into())
    }
}

/// Taille non nulle et sous la limite.
pub fn check_size(len: usize) -> Result<(), String> {
    if len == 0 {
        return Err("Ce fichier est vide.".into());
    }
    if len > MAX_DROPPED_FILE_BYTES {
        return Err(format!(
            "Ce fichier est trop volumineux ({} Mo). Maximum : {} Mo.",
            len / (1024 * 1024),
            MAX_DROPPED_FILE_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

/// Nom du fichier décodé de l'en-tête `x-file-name` (encodé en URI par le front).
pub fn decode_file_name(header: &str) -> String {
    let bytes = header.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Nom sûr pour le disque : dernier élément d'un chemin éventuel, sans caractère interdit sous Windows,
/// sans point ni espace en bout, sans `..`, borné en longueur (l'extension est conservée).
pub fn sanitize_file_name(raw: &str) -> String {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut cleaned: String = last
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    while cleaned.contains("..") {
        cleaned = cleaned.replace("..", ".");
    }
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if cleaned.is_empty() {
        return FALLBACK_NAME.into();
    }
    if cleaned.chars().count() <= MAX_NAME_CHARS {
        return cleaned.into();
    }
    // Trop long : on coupe le début du nom et on garde l'extension (si elle est courte).
    let extension = Path::new(cleaned)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.chars().count() <= 10)
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let keep = MAX_NAME_CHARS - extension.chars().count();
    let stem: String = cleaned.chars().take(keep).collect();
    format!("{}{extension}", stem.trim_end_matches(['.', ' ']))
}

/// Nom du fichier enregistré : `<horodatage en ms>-<nom assaini>`.
pub fn stored_file_name(now_ms: u128, raw_name: &str) -> String {
    format!("{now_ms}-{}", sanitize_file_name(raw_name))
}

/// Supprime les copies plus vieilles que `max_age` (échecs ignorés : le nettoyage est de confort).
pub fn remove_expired(dir: &Path, now: SystemTime, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let expired = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > max_age);
        if expired {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Enregistre `bytes` dans `dir` (créé si besoin) et renvoie le chemin absolu de la copie.
pub fn save_dropped_file(
    dir: &Path,
    raw_name: &str,
    bytes: &[u8],
    now: SystemTime,
) -> Result<PathBuf, String> {
    check_size(bytes.len())?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Impossible de créer le dossier des fichiers déposés : {e}"))?;
    remove_expired(dir, now, DROPPED_MAX_AGE);
    let now_ms = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(stored_file_name(now_ms, raw_name));
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Impossible d'enregistrer ce fichier : {e}"))?;
    Ok(path)
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
    fn only_the_island_window_may_save() {
        assert!(check_window("prompt").is_ok());
        assert!(check_window("main").is_err());
        assert!(check_window("").is_err());
    }

    #[test]
    fn size_limits() {
        assert!(check_size(0).is_err());
        assert!(check_size(1).is_ok());
        assert!(check_size(MAX_DROPPED_FILE_BYTES).is_ok());
        let too_big = check_size(MAX_DROPPED_FILE_BYTES + 1).unwrap_err();
        assert!(too_big.contains("50 Mo"), "{too_big}");
    }

    #[test]
    fn header_names_are_decoded() {
        assert_eq!(decode_file_name("cahier.pdf"), "cahier.pdf");
        assert_eq!(
            decode_file_name("R%C3%A9union%20Ib%C3%A9.m4a"),
            "Réunion Ibé.m4a"
        );
        // Séquences incomplètes ou invalides : laissées telles quelles.
        assert_eq!(decode_file_name("100%"), "100%");
        assert_eq!(decode_file_name("a%2"), "a%2");
        assert_eq!(decode_file_name("a%zzb"), "a%zzb");
        assert_eq!(decode_file_name("%2e%2e%2fa"), "../a");
    }

    #[test]
    fn names_lose_separators_and_dots() {
        assert_eq!(sanitize_file_name("cahier.pdf"), "cahier.pdf");
        assert_eq!(sanitize_file_name("C:\\Users\\moi\\a.txt"), "a.txt");
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_file_name("a..b.txt"), "a.b.txt");
        assert_eq!(sanitize_file_name(".."), FALLBACK_NAME);
        assert_eq!(sanitize_file_name("  . "), FALLBACK_NAME);
        assert_eq!(sanitize_file_name(""), FALLBACK_NAME);
        assert_eq!(sanitize_file_name("dossier/"), FALLBACK_NAME);
    }

    #[test]
    fn names_lose_forbidden_characters() {
        assert_eq!(
            sanitize_file_name("a<b>c:d\"e|f?g*h.txt"),
            "a_b_c_d_e_f_g_h.txt"
        );
        assert_eq!(sanitize_file_name("a\u{0}b\n.txt"), "a_b_.txt");
        assert_eq!(sanitize_file_name("Réunion Ibé.m4a"), "Réunion Ibé.m4a");
    }

    #[test]
    fn long_names_are_cut_but_keep_their_extension() {
        let long = format!("{}.mp3", "a".repeat(300));
        let name = sanitize_file_name(&long);
        assert_eq!(name.chars().count(), MAX_NAME_CHARS);
        assert!(name.ends_with(".mp3"));
        let no_extension = sanitize_file_name(&"b".repeat(300));
        assert_eq!(no_extension.chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn stored_name_is_prefixed_by_the_timestamp() {
        assert_eq!(stored_file_name(1234, "../a b.pdf"), "1234-a b.pdf");
        assert_eq!(stored_file_name(1234, ""), "1234-fichier");
    }

    #[test]
    fn a_file_is_saved_and_its_path_returned() {
        let root = scratch("save");
        let dir = root.join("drops");
        let path = save_dropped_file(&dir, "cahier.pdf", b"contenu", SystemTime::now()).unwrap();
        assert!(path.starts_with(&dir));
        assert!(path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with("-cahier.pdf"));
        assert_eq!(std::fs::read(&path).unwrap(), b"contenu");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_empty_or_huge_file_is_refused() {
        let dir = scratch("refused");
        assert_eq!(
            save_dropped_file(&dir, "a.txt", b"", SystemTime::now()).unwrap_err(),
            "Ce fichier est vide."
        );
        let huge = vec![0u8; MAX_DROPPED_FILE_BYTES + 1];
        assert!(save_dropped_file(&dir, "a.bin", &huge, SystemTime::now()).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn old_copies_are_removed_and_recent_ones_kept() {
        let dir = scratch("expire");
        let old = dir.join("1-vieux.txt");
        let recent = dir.join("2-recent.txt");
        std::fs::write(&old, b"x").unwrap();
        std::fs::write(&recent, b"x").unwrap();
        // « Maintenant » simulé : 8 jours plus tard ; seule la copie récente a été modifiée juste avant.
        let later = SystemTime::now() + Duration::from_secs(8 * 24 * 60 * 60);
        let file = std::fs::File::options().write(true).open(&recent).unwrap();
        file.set_modified(later - Duration::from_secs(60)).unwrap();
        drop(file);
        remove_expired(&dir, later, DROPPED_MAX_AGE);
        assert!(!old.exists());
        assert!(recent.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
