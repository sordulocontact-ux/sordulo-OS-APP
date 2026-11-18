//! Associe un schéma d'URL (ex. `sordulo://`) à l'exécutable courant, pour l'utilisateur seulement
//! (HKCU\Software\Classes, sans droits administrateur). Windows lance alors `"<exe>" "<url>"`.

use std::path::Path;

use anyhow::Context;
use winreg::enums::KEY_WRITE;
use winreg::HKCU;

pub fn register_url_scheme(scheme: &str, exe: &Path) -> anyhow::Result<()> {
    let classes = HKCU
        .open_subkey_with_flags(r"Software\Classes", KEY_WRITE)
        .context(r"ouverture de HKCU\Software\Classes")?;
    let (root, _) = classes
        .create_subkey(scheme)
        .with_context(|| format!("création de la clé {scheme}"))?;
    root.set_value("", &format!("URL:{scheme}"))?;
    root.set_value("URL Protocol", &"")?;
    let (command, _) = root.create_subkey(r"shell\open\command")?;
    command.set_value("", &format!("\"{}\" \"%1\"", exe.display()))?;
    Ok(())
}

/// Lecture seule, pour le test : commande enregistrée pour `scheme`.
#[cfg(test)]
pub fn registered_command(scheme: &str) -> Option<String> {
    HKCU.open_subkey(format!(r"Software\Classes\{scheme}\shell\open\command"))
        .ok()?
        .get_value("")
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_and_reads_back() {
        let scheme = "sordulo-os-test";
        let exe = Path::new(r"C:\x\app.exe");
        register_url_scheme(scheme, exe).unwrap();
        assert_eq!(
            registered_command(scheme).as_deref(),
            Some(r#""C:\x\app.exe" "%1""#)
        );
        HKCU.delete_subkey_all(format!(r"Software\Classes\{scheme}"))
            .unwrap();
    }
}
