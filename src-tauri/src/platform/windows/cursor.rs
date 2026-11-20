//! Position du curseur et état du bouton principal de la souris (surveillance de l'île, ~60 Hz).

use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetSystemMetrics, SM_SWAPBUTTON};

use crate::platform::CursorState;

/// Bit « touche enfoncée » de `GetAsyncKeyState`.
const KEY_DOWN: u16 = 0x8000;

/// Curseur en px physiques (coordonnées de l'écran virtuel ; l'app est « per-monitor DPI aware »).
/// `None` quand la position n'est pas lisible (session verrouillée, bureau sécurisé de l'UAC).
pub fn cursor_state() -> Option<CursorState> {
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY : `point` est un POINT valide qui vit pendant tout l'appel.
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return None;
    }
    // `GetAsyncKeyState` lit les boutons physiques : boutons inversés (gaucher) = bouton principal à droite.
    // SAFETY : fonctions sans pointeur, appelables depuis n'importe quel thread.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let button = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    // SAFETY : idem.
    let state = unsafe { GetAsyncKeyState(i32::from(button)) };
    Some(CursorState {
        x: point.x,
        y: point.y,
        primary_down: (state as u16) & KEY_DOWN != 0,
    })
}
