//! Titres des pages ouvertes dans un navigateur, pour reconnaître le service d'un appel fait dans le
//! navigateur (Discord, Meet…). Le titre de fenêtre suffit pour Chrome ou Edge (« Meet – abc - Google
//! Chrome »), mais pas pour Arc, dont la fenêtre s'appelle toujours « Arc » : on lit alors, par UI
//! Automation, le nom de l'élément `Document` de chaque fenêtre (le titre de la page affichée).
//!
//! Chromium n'active son arbre d'accessibilité qu'à la première demande : le premier appel peut ne rien
//! trouver, les suivants (2 s plus tard, au tour suivant du moniteur) trouvent la page. Appelé seulement
//! quand un navigateur tient le micro.

use windows::Win32::Foundation::HWND as UiaHwnd;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_I4};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_DocumentControlTypeId,
};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

use super::activity::exe_stem;

/// Titres des fenêtres visibles du navigateur `browser` (nom d'exécutable en minuscules, sans `.exe`,
/// comme `call_apps::short_name`), suivis du titre de la page affichée dans chacune (UI Automation).
pub fn browser_page_titles(browser: &str) -> Vec<String> {
    let windows = browser_windows(browser);
    let mut titles: Vec<String> = windows.iter().map(|(_, title)| title.clone()).collect();
    if let Some(uia) = automation() {
        for (hwnd, _) in &windows {
            if let Some(name) = document_name(&uia, *hwnd) {
                titles.push(name);
            }
        }
    }
    titles.retain(|t| !t.trim().is_empty());
    titles.dedup();
    titles
}

fn automation() -> Option<IUIAutomation> {
    // SAFETY : COM initialisé sur ce thread (MTA, comme wasapi) ; un second appel rend S_FALSE, sans effet.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| log::debug!("UI Automation indisponible : {e}"))
            .ok()
    }
}

/// Nom du premier élément `Document` de la fenêtre : le titre de la page affichée.
fn document_name(uia: &IUIAutomation, hwnd: HWND) -> Option<String> {
    // SAFETY : appels COM sur des interfaces valides ; `hwnd` vient d'EnumWindows (au pire fermée depuis :
    // UI Automation renvoie alors une erreur).
    unsafe {
        let root = uia.ElementFromHandle(UiaHwnd(hwnd)).ok()?;
        let condition = uia
            .CreatePropertyCondition(UIA_ControlTypePropertyId, &int_variant(UIA_DocumentControlTypeId.0))
            .ok()?;
        let document = root.FindFirst(TreeScope_Descendants, &condition).ok()?;
        let name = document.CurrentName().ok()?.to_string();
        (!name.trim().is_empty()).then_some(name)
    }
}

/// VARIANT entier (VT_I4) : rien à libérer.
fn int_variant(value: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: value },
            }),
        },
    }
}

struct Collect<'a> {
    browser: &'a str,
    found: Vec<(HWND, String)>,
}

fn browser_windows(browser: &str) -> Vec<(HWND, String)> {
    let mut collect = Collect { browser, found: Vec::new() };
    // SAFETY : `collect` ne vit que pendant EnumWindows, qui est synchrone.
    unsafe {
        EnumWindows(Some(on_window), &mut collect as *mut Collect as LPARAM);
    }
    collect.found
}

unsafe extern "system" fn on_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let collect = &mut *(lparam as *mut Collect);
    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if exe_stem(pid).as_deref() != Some(collect.browser) {
        return 1;
    }
    let len = GetWindowTextLengthW(hwnd);
    let mut title = String::new();
    if len > 0 {
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if n > 0 {
            title = String::from_utf16_lossy(&buf[..n as usize]);
        }
    }
    collect.found.push((hwnd, title));
    1
}

#[cfg(test)]
mod tests {
    /// Diagnostic manuel, navigateur ouvert : `cargo test print_browser_pages -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_browser_pages() {
        for browser in ["arc", "chrome", "msedge"] {
            // Deux passages : Chromium active son arbre d'accessibilité à la première demande.
            let _ = super::browser_page_titles(browser);
            std::thread::sleep(std::time::Duration::from_millis(500));
            println!("{browser} : {:?}", super::browser_page_titles(browser));
        }
    }
}
