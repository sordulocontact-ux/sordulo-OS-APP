//! Presse-papiers Windows : texte Unicode (`CF_UNICODETEXT`).
//!
//! Utilisé par le dépôt d'un fichier sur « Claude Code » (le chemin est copié). `navigator.clipboard` exige
//! une page focalisée et un geste de l'utilisateur, ce qui n'est pas garanti pour une fenêtre transparente
//! qui reçoit un dépôt : on passe par l'API système.

use std::ptr::{copy_nonoverlapping, null_mut};
use std::thread::sleep;
use std::time::Duration;

use anyhow::{anyhow, bail};
use windows_sys::Win32::Foundation::GlobalFree;
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

/// Format « texte Unicode » (CF_UNICODETEXT).
const CF_UNICODETEXT: u32 = 13;
/// Le presse-papiers est parfois tenu une fraction de seconde par une autre app : quelques essais.
const OPEN_ATTEMPTS: u32 = 10;
const OPEN_RETRY: Duration = Duration::from_millis(15);

/// UTF-16 terminé par un zéro (ce que le presse-papiers attend).
fn utf16_nul_terminated(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Ferme le presse-papiers à la sortie, quoi qu'il arrive.
struct ClipboardGuard;

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        // SAFETY : le presse-papiers a été ouvert par ce thread (la garde n'existe qu'ensuite).
        unsafe { CloseClipboard() };
    }
}

fn open_clipboard() -> anyhow::Result<ClipboardGuard> {
    for attempt in 0..OPEN_ATTEMPTS {
        // SAFETY : fenêtre nulle = presse-papiers associé à la tâche courante.
        if unsafe { OpenClipboard(null_mut()) } != 0 {
            return Ok(ClipboardGuard);
        }
        if attempt + 1 < OPEN_ATTEMPTS {
            sleep(OPEN_RETRY);
        }
    }
    bail!("le presse-papiers est occupé")
}

/// Remplace le contenu du presse-papiers par `text`.
pub fn copy_text(text: &str) -> anyhow::Result<()> {
    let units = utf16_nul_terminated(text);
    let byte_len = units.len() * std::mem::size_of::<u16>();
    let _guard = open_clipboard()?;

    // SAFETY : on ne touche à la mémoire globale qu'après avoir vérifié les poignées ; `units` vit pendant
    // la copie et `byte_len` est exactement la taille allouée. Après `SetClipboardData` réussi, le système
    // possède la mémoire (on ne la libère pas) ; en cas d'échec, on la libère.
    unsafe {
        if EmptyClipboard() == 0 {
            bail!("impossible de vider le presse-papiers");
        }
        let handle = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if handle.is_null() {
            bail!("mémoire insuffisante pour le presse-papiers");
        }
        let target = GlobalLock(handle).cast::<u16>();
        if target.is_null() {
            GlobalFree(handle);
            return Err(anyhow!(
                "impossible de verrouiller la mémoire du presse-papiers"
            ));
        }
        copy_nonoverlapping(units.as_ptr(), target, units.len());
        GlobalUnlock(handle);
        if SetClipboardData(CF_UNICODETEXT, handle).is_null() {
            GlobalFree(handle);
            bail!("impossible d'écrire dans le presse-papiers");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::utf16_nul_terminated;

    #[test]
    fn text_is_utf16_with_a_final_zero() {
        assert_eq!(utf16_nul_terminated(""), vec![0]);
        assert_eq!(utf16_nul_terminated("a\\é"), vec![0x61, 0x5c, 0xe9, 0]);
        // Hors plan multilingue de base : paire de substitution.
        assert_eq!(utf16_nul_terminated("😀"), vec![0xd83d, 0xde00, 0]);
    }
}
