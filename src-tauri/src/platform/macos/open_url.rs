//! Ouverture d'une URL par l'app associée (navigateur par défaut, app Spotify) avec `/usr/bin/open`.
//! L'URL est déjà vérifiée par `platform::open_url` (`https://` ou `spotify:` seulement). Sans app pour le
//! schéma (`spotify:` sans l'app), `open` sort en erreur : l'appelant se rabat sur le lecteur web.

use std::process::{Command, Stdio};

use anyhow::{ensure, Context, Result};

pub fn open_url(url: &str) -> Result<()> {
    // L'URL commence par `https://` ou `spotify:` : jamais lue comme une option.
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .context("open introuvable")?;
    ensure!(
        status.success(),
        "aucune app n'a ouvert l'adresse ({status})"
    );
    Ok(())
}
