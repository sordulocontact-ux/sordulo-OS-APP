//! Quelle fenêtre de l'éditeur (VS Code, Cursor…) contient une session Claude Code ?
//!
//! La session tourne dans un dossier (`cwd`), mais la fenêtre peut être ouverte sur un dossier parent
//! (fenêtre « SORDULO », session dans « SORDULO/sordulo-OS-APP »). Ouvrir le `cwd` créerait alors une
//! nouvelle fenêtre : il faut rouvrir le dossier de la fenêtre existante, que VS Code met au premier plan.
//!
//! L'éditeur tient la liste de ses fenêtres ouvertes dans `User/globalStorage/storage.json`
//! (`windowsState.openedWindows[].folder` et `lastActiveWindow`, des URI `file://`), à jour à chaque
//! ouverture ou fermeture de fenêtre. Emplacement du fichier : `platform::editor_storage_file`.
//! Code pur, commun à Windows et macOS.

use serde_json::Value;

/// Dossiers (chemins locaux) des fenêtres ouvertes, d'après le contenu de `storage.json`.
pub fn open_folders(storage_json: &str) -> Vec<String> {
    let Ok(storage) = serde_json::from_str::<Value>(storage_json) else {
        return Vec::new();
    };
    let state = &storage["windowsState"];
    let mut folders: Vec<String> = state["openedWindows"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(std::iter::once(&state["lastActiveWindow"]))
        .filter_map(|window| window["folder"].as_str())
        .filter_map(file_uri_to_path)
        .collect();
    folders.dedup();
    folders
}

/// `file:///Users/a/b%20c` → `/Users/a/b c` ; `file:///c%3A/Users/a` → `c:/Users/a`. Autres schémas
/// (fenêtres distantes `vscode-remote://`) : `None`.
fn file_uri_to_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let decoded = percent_decode(rest)?;
    // Lecteur Windows : `/c:/Users/…` → `c:/Users/…`.
    let bytes = decoded.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
        return Some(decoded[1..].to_owned());
    }
    Some(decoded)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Chemin comparable : séparateurs `/`, sans `/` final, minuscules pour un chemin Windows (lecteur).
fn normalize(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    while p.len() > 1 && p.ends_with('/') {
        p.pop();
    }
    let bytes = p.as_bytes();
    let windows = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    if windows {
        p.to_lowercase()
    } else {
        p
    }
}

/// Dossier de la fenêtre qui contient `cwd` : celui de `folders` égal à `cwd` ou son ancêtre le plus
/// proche. `None` si aucune fenêtre ne le contient.
pub fn window_folder_for<'a>(cwd: &str, folders: &'a [String]) -> Option<&'a String> {
    let target = normalize(cwd);
    folders
        .iter()
        .filter(|folder| {
            let folder = normalize(folder);
            target == folder
                || target
                    .strip_prefix(&folder)
                    .is_some_and(|rest| rest.starts_with('/') || folder.ends_with('/'))
        })
        .max_by_key(|folder| normalize(folder).len())
}

#[cfg(test)]
mod tests {
    use super::*;

    const STORAGE: &str = r#"{
      "windowsState": {
        "lastActiveWindow": { "folder": "file:///Users/sacha/Documents/PERSO/Tiktok" },
        "openedWindows": [
          { "folder": "file:///Users/sacha/Documents/GitHub/SORDULO" },
          { "folder": "file:///Users/sacha/Documents/GitHub/SORDULO/PDS%20OS" },
          { "folder": "vscode-remote://ssh-remote%2Bserveur/home/x" },
          { "workspaceIdentifier": { "configURIPath": "file:///x.code-workspace" } }
        ]
      }
    }"#;

    #[test]
    fn reads_the_open_windows() {
        assert_eq!(
            open_folders(STORAGE),
            [
                "/Users/sacha/Documents/GitHub/SORDULO",
                "/Users/sacha/Documents/GitHub/SORDULO/PDS OS",
                "/Users/sacha/Documents/PERSO/Tiktok",
            ]
        );
        assert!(open_folders("pas du json").is_empty());
        assert_eq!(
            file_uri_to_path("file:///c%3A/Users/mael/sordulo-OS").as_deref(),
            Some("c:/Users/mael/sordulo-OS")
        );
    }

    #[test]
    fn picks_the_window_containing_the_session() {
        let folders = open_folders(STORAGE);
        // Fenêtre ouverte sur le dossier parent : c'est elle qu'on rouvre.
        assert_eq!(
            window_folder_for("/Users/sacha/Documents/GitHub/SORDULO/sordulo-OS-APP", &folders)
                .map(String::as_str),
            Some("/Users/sacha/Documents/GitHub/SORDULO")
        );
        // Le plus proche gagne.
        assert_eq!(
            window_folder_for("/Users/sacha/Documents/GitHub/SORDULO/PDS OS/api", &folders)
                .map(String::as_str),
            Some("/Users/sacha/Documents/GitHub/SORDULO/PDS OS")
        );
        // Préfixe de nom sans être un dossier parent : non.
        assert_eq!(
            window_folder_for("/Users/sacha/Documents/GitHub/SORDULO-old", &folders),
            None
        );
        // Windows : casse et séparateurs indifférents.
        let windows = vec!["c:/Users/mael/SORDULO".to_owned()];
        assert_eq!(
            window_folder_for("C:\\Users\\mael\\SORDULO\\sordulo-OS-APP", &windows)
                .map(String::as_str),
            Some("c:/Users/mael/SORDULO")
        );
    }
}
