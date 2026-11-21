//! Ouverture d'une URL par l'app associée (navigateur par défaut, app Spotify), par `ShellExecuteW` :
//! aucune console, aucun processus intermédiaire. L'URL est déjà vérifiée par `platform::open_url`
//! (`https://` ou `spotify:` seulement).
//!
//! Un schéma non enregistré (`spotify:` sans l'app) ferait proposer par Windows une app du Store : on vérifie
//! d'abord qu'il est déclaré (`HKCR\<schéma>` avec la valeur « URL Protocol »), pour que l'appelant puisse se
//! rabattre sur le lecteur web.

use std::thread;

use anyhow::{anyhow, bail, Result};
use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use winreg::enums::HKEY_CLASSES_ROOT;
use winreg::RegKey;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Schéma d'URL déclaré dans le registre (utilisateur ou machine, vus ensemble par HKCR).
fn scheme_registered(scheme: &str) -> bool {
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(scheme)
        .is_ok_and(|key| key.get_raw_value("URL Protocol").is_ok())
}

pub fn open_url(url: &str) -> Result<()> {
    let scheme = url.split(':').next().unwrap_or_default();
    if !scheme.eq_ignore_ascii_case("https") && !scheme_registered(scheme) {
        bail!("aucune app n'ouvre les adresses « {scheme}: »");
    }
    let file = wide(url);
    // Thread dédié : ShellExecute veut COM en appartement (STA), que les threads de Tauri n'ont pas.
    let code = thread::Builder::new()
        .name("open-url".into())
        .spawn(move || {
            let operation = wide("open");
            // SAFETY : COM initialisé pour ce thread seulement, libéré avant sa fin s'il a réussi ; chaînes
            // UTF-16 terminées par un zéro, vivantes pendant l'appel ; pas de fenêtre parente.
            unsafe {
                let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
                let result = ShellExecuteW(
                    std::ptr::null_mut(),
                    operation.as_ptr(),
                    file.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                );
                if com.is_ok() {
                    CoUninitialize();
                }
                result as isize
            }
        })
        .map_err(|e| anyhow!("ouverture impossible : {e}"))?
        .join()
        .map_err(|_| anyhow!("ouverture interrompue"))?;
    // Succès : valeur supérieure à 32 (documentation de ShellExecute).
    if code <= 32 {
        bail!("Windows n'a pas pu ouvrir l'adresse (code {code})");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_du_registre() {
        // `https` est toujours déclaré ; un schéma inventé ne l'est pas.
        assert!(scheme_registered("https"));
        assert!(!scheme_registered("sordulo-schema-inexistant"));
    }
}
