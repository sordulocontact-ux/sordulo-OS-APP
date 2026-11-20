//! Windows — rouvrir la fenêtre d'où vient une session Claude Code.
//!
//! Éditeur connu (VS Code, Cursor… : chemin de `Code.exe` transmis par le relais) : on le lance avec le
//! dossier de la session. L'instance déjà ouverte reçoit la demande et met au premier plan la fenêtre
//! de ce dossier (une fenêtre par projet), ou en ouvre une. Sinon : VS Code à son emplacement habituel.
//! `ELECTRON_RUN_AS_NODE` est retiré de l'environnement (sinon Code.exe se comporte comme Node).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{anyhow, Context, Result};

use crate::platform::EditorHost;

/// `DETACHED_PROCESS` : pas de console attachée.
const DETACHED_PROCESS: u32 = 0x0000_0008;

/// Emplacements habituels de VS Code (installation utilisateur, puis machine).
fn default_vscode() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("LOCALAPPDATA")
            .map(|d| PathBuf::from(d).join("Programs").join("Microsoft VS Code").join("Code.exe")),
        std::env::var_os("ProgramFiles")
            .map(|d| PathBuf::from(d).join("Microsoft VS Code").join("Code.exe")),
    ];
    candidates.into_iter().flatten().find(|p| p.is_file())
}

/// Nom court de l'éditeur (`nameShort` de `resources\app\product.json`), « Code » par défaut.
fn name_short(exe: Option<&str>) -> String {
    exe.and_then(|exe| Path::new(exe).parent().map(|dir| dir.join("resources").join("app").join("product.json")))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|product| product["nameShort"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "Code".to_owned())
}

/// `storage.json` de l'éditeur (liste de ses fenêtres ouvertes, voir `editor_windows`).
pub fn editor_storage_file(editor: &EditorHost) -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        PathBuf::from(appdata)
            .join(name_short(editor.exe.as_deref()))
            .join("User")
            .join("globalStorage")
            .join("storage.json"),
    )
}

/// Chemin à la Git Bash (`/c/Users/…`) → chemin Windows (`C:\Users\…`).
fn windows_path(folder: &Path) -> PathBuf {
    let text = folder.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b'/' {
        let drive = (bytes[1] as char).to_ascii_uppercase();
        return PathBuf::from(format!("{drive}:\\{}", text[3..].replace('/', "\\")));
    }
    folder.to_path_buf()
}

pub fn open_in_editor(editor: &EditorHost, folder: &Path) -> Result<()> {
    let exe = editor
        .exe
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
        .or_else(default_vscode)
        .ok_or_else(|| anyhow!("VS Code introuvable"))?;
    Command::new(&exe)
        .arg(windows_path(folder))
        .env_remove("ELECTRON_RUN_AS_NODE")
        .creation_flags(DETACHED_PROCESS)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .with_context(|| format!("Lancement de {} impossible", exe.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_bash_paths() {
        assert_eq!(windows_path(Path::new("/c/Users/mael/x")), PathBuf::from("C:\\Users\\mael\\x"));
        assert_eq!(windows_path(Path::new("C:\\a")), PathBuf::from("C:\\a"));
    }
}
