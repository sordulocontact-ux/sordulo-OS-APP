//! macOS — fonctions système de l'île : curseur (CoreGraphics), encoche de l'écran principal et niveau
//! de la fenêtre (AppKit).
//!
//! Coordonnées : repère de l'île sur macOS (`IslandSpace::Points`), en points, origine en haut à gauche de
//! l'écran principal, comme `CGEventGetLocation` et les positions logiques de tao. Les px physiques de tao
//! sont multipliés par l'échelle de chaque écran ou fenêtre : avec des écrans d'échelles différentes, ils ne
//! forment pas un repère commun, les points si.

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::sel;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSMainMenuWindowLevel, NSScreen, NSWindow};

use crate::platform::{CursorState, Notch};

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

/// `kCGEventSourceStateCombinedSessionState`.
const COMBINED_SESSION_STATE: i32 = 0;
/// `kCGMouseButtonLeft` : sur Mac, l'inversion des boutons est faite en amont, le gauche est le principal.
const MOUSE_BUTTON_LEFT: u32 = 0;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *const c_void) -> CGPoint;
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Position du curseur (points, repère de l'île) et bouton principal. Ne demande aucune autorisation.
pub fn cursor_state() -> Option<CursorState> {
    // SAFETY : CGEventCreate(NULL) crée un événement qui porte la position actuelle du curseur
    // (origine en haut à gauche de l'écran principal, en points) ; il est relâché aussitôt après lecture.
    let location = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let location = CGEventGetLocation(event);
        CFRelease(event);
        location
    };
    // SAFETY : lecture de l'état du bouton, sans effet de bord.
    let primary_down =
        unsafe { CGEventSourceButtonState(COMBINED_SESSION_STATE, MOUSE_BUTTON_LEFT) };
    Some(CursorState {
        x: location.x.round() as i32,
        y: location.y.round() as i32,
        primary_down,
    })
}

/// Écran principal (celui de la barre des menus), `None` hors du thread principal.
fn primary_screen() -> Option<Retained<NSScreen>> {
    let mtm = MainThreadMarker::new()?;
    NSScreen::screens(mtm).firstObject()
}

/// Encoche de l'écran principal (macOS 12+), `None` sans encoche. À appeler sur le thread principal.
pub fn primary_notch() -> Option<Notch> {
    let screen = primary_screen()?;
    if !screen.respondsToSelector(sel!(auxiliaryTopLeftArea)) {
        return None;
    }
    let top = screen.safeAreaInsets().top;
    if top <= 0.0 {
        return None;
    }
    let width = screen.frame().size.width
        - screen.auxiliaryTopLeftArea().size.width
        - screen.auxiliaryTopRightArea().size.width;
    (width > 0.0).then_some(Notch { width, height: top })
}

/// Monte la fenêtre au-dessus de la barre des menus (sinon une fenêtre « toujours au-dessus » passe
/// dessous et l'île collée à l'encoche serait cachée). Les menus déroulants restent au-dessus de l'île.
/// À appeler sur le thread principal.
pub fn raise_island_window(ns_window: *mut c_void) {
    if ns_window.is_null() || MainThreadMarker::new().is_none() {
        log::warn!("niveau de l'île : fenêtre absente ou hors du thread principal");
        return;
    }
    // SAFETY : pointeur NSWindow vivant fourni par Tauri (`WebviewWindow::ns_window`), utilisé sur le
    // thread principal, sans en prendre possession.
    let window = unsafe { &*ns_window.cast::<NSWindow>() };
    window.setLevel(NSMainMenuWindowLevel + 1);
}
