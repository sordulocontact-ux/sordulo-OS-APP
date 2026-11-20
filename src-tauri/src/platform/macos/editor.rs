//! macOS — rouvrir la fenêtre d'où vient une session Claude Code.
//!
//! Éditeur connu (VS Code, Cursor… : chemin de son exécutable transmis par le relais) : on lui fait
//! ouvrir le dossier de la session avec `open -a <app> <dossier>`. VS Code met alors au premier plan la
//! fenêtre déjà ouverte sur ce dossier (une fenêtre par projet), ou en ouvre une s'il n'y en a pas.
//! Autre app (Terminal, iTerm…) : elle est seulement activée (on n'ouvre pas de nouvelle fenêtre).
//! Rien de connu : VS Code par défaut.

use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

use super::audio::outer_app_bundle;
use crate::platform::EditorHost;

const DEFAULT_EDITOR: &str = "com.microsoft.VSCode";

/// Bundle id plausible (lettres, chiffres, points, tirets) : jamais passé tel quel s'il est bizarre.
fn valid_bundle_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 255
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

pub fn open_in_editor(editor: &EditorHost, folder: &Path) -> Result<()> {
    let mut command = Command::new("/usr/bin/open");
    match editor.exe.as_deref().and_then(outer_app_bundle) {
        Some(app) => {
            command.arg("-a").arg(app).arg(folder);
        }
        None => match editor.bundle_id.as_deref().filter(|id| valid_bundle_id(id)) {
            // Terminal, iTerm… : l'activer suffit.
            Some(id) => {
                command.arg("-b").arg(id);
            }
            None => {
                command.arg("-b").arg(DEFAULT_EDITOR).arg(folder);
            }
        },
    }
    let status = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("open introuvable")?;
    if !status.success() {
        bail!("Impossible d'ouvrir {} ({status})", folder.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_editor_bundle() {
        let helper = "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)";
        assert_eq!(outer_app_bundle(helper), Some("/Applications/Visual Studio Code.app"));
        assert_eq!(outer_app_bundle("/usr/local/bin/node"), None);
        assert!(valid_bundle_id("com.microsoft.VSCode"));
        assert!(!valid_bundle_id("com.x; rm -rf"));
    }
}
