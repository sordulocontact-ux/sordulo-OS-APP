//! L'île : la fenêtre `prompt`, transparente, collée au bord haut de l'écran principal, toujours présente.
//!
//! - Taille fixe (plus grand état + bulle secondaire), centrée sur la zone de travail de l'écran principal,
//!   sans marge. Replacée si l'écran principal, la résolution ou la mise à l'échelle changent : vérification
//!   toutes les 2 s, et tout de suite après un changement d'échelle ou un déplacement de la fenêtre.
//! - Clics qui passent à travers : la fenêtre ignore la souris, sauf au-dessus des zones cliquables envoyées
//!   par le front (`island_set_hit_rects`). Un thread (~60 Hz) suit le curseur et bascule ; il émet
//!   `desktop://island-pointer` quand le curseur entre dans les formes ou en sort.
//! - Glisser-déposer : un bouton principal enfoncé dans la marge `dragMargin` réactive aussi les clics, pour
//!   que le dépôt natif de Tauri (laissé actif sur cette fenêtre) atteigne l'île.
//!
//! Le rendu (forme, ressort) est fait par le front. Fonctions système (curseur) : `platform::cursor_state`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::events::{EVENT_ISLAND_POINTER, PROMPT_ROUTE, WINDOW_PROMPT};
use crate::platform::{self, CursorState};
use crate::state::{DesktopState, IslandHitRects, IslandPointer};

/// Largeur de la fenêtre (px logiques). Plus grand état : `dragOver` 440 + 2 × 10 de bord = 460 ;
/// bulle secondaire à droite : 4 d'écart + 44 + 2 × 10 = 68. Fenêtre symétrique pour rester centrée :
/// 2 × (460 / 2 + 68) = 596, arrondi à 640 pour laisser la place aux effets (ressort qui dépasse, ombres).
const ISLAND_WIDTH: f64 = 640.0;
/// Hauteur de la fenêtre (px logiques). Plus grand état : `multiOpen` 220 de haut, + marge pour le ressort.
const ISLAND_HEIGHT: f64 = 260.0;

/// Période de la surveillance du curseur (~60 Hz).
const POINTER_POLL: Duration = Duration::from_millis(16);
/// Vérification du placement : toutes les ~2 s (en tours de surveillance du curseur).
const PLACE_EVERY_TICKS: u32 = 125;
/// Après un replacement ou un changement d'échelle : nouvelle vérification après ~250 ms.
const PLACE_SOON_TICKS: u32 = 15;

/// Levé par les événements de la fenêtre (échelle, déplacement) : vérifier le placement sans attendre 2 s.
static PLACE_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Crée la fenêtre de l'île, la place et la montre sans prendre le focus. Appelé une fois dans `setup`.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window =
        WebviewWindowBuilder::new(app, WINDOW_PROMPT, WebviewUrl::App(PROMPT_ROUTE.into()))
            .title("Sordulo OS")
            .inner_size(ISLAND_WIDTH, ISLAND_HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            // Cachée le temps d'être placée, puis montrée par `place` sans activation.
            .visible(false)
            .focused(false)
            .build()?;

    // Par défaut la souris traverse : tant que le front n'a rien envoyé, rien n'est cliquable.
    window.set_ignore_cursor_events(true)?;
    window.on_window_event(|event| {
        if matches!(
            event,
            WindowEvent::ScaleFactorChanged { .. } | WindowEvent::Moved(_)
        ) {
            PLACE_REQUESTED.store(true, Ordering::Relaxed);
        }
    });
    if let Err(e) = place(&window) {
        log::warn!("placement initial de l'île impossible : {e}");
        show_without_focus(&window);
    }
    log::info!("fenêtre de l'île créée ({ISLAND_WIDTH} × {ISLAND_HEIGHT} px logiques)");
    Ok(window)
}

/// Montre la fenêtre si elle est cachée, sans voler le focus ni la déplacer.
pub fn ensure_visible(window: &WebviewWindow<Wry>) {
    match window.is_visible() {
        Ok(true) => {}
        Ok(false) => show_without_focus(window),
        Err(e) => log::debug!("visibilité de l'île inconnue : {e}"),
    }
}

/// Le temps de l'affichage, la fenêtre n'est pas activable (WS_EX_NOACTIVATE sous Windows) : elle apparaît
/// au-dessus sans voler le focus, puis redevient activable (un clic dans l'île lui donne le clavier).
fn show_without_focus(window: &WebviewWindow<Wry>) {
    let _ = window.set_focusable(false);
    let shown = window.show();
    let _ = window.set_focusable(true);
    if let Err(e) = shown {
        log::warn!("impossible d'afficher l'île : {e}");
    }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/// Rectangle visé, en px physiques écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Centrée horizontalement sur la zone de travail (`area_*`, px physiques), collée à son bord haut.
fn placement_in(area_x: i32, area_y: i32, area_width: u32, scale: f64) -> Placement {
    let width = (ISLAND_WIDTH * scale).round() as u32;
    let height = (ISLAND_HEIGHT * scale).round() as u32;
    let x = area_x + (i64::from(area_width) - i64::from(width)).div_euclid(2) as i32;
    Placement {
        x,
        y: area_y,
        width,
        height,
    }
}

/// Place (et redimensionne si l'échelle a changé) la fenêtre sur l'écran principal, la remontre si elle
/// a été cachée. Renvoie le cadre utilisé pour convertir les zones cliquables, et si quelque chose a bougé.
fn place(window: &WebviewWindow<Wry>) -> tauri::Result<(WindowFrame, bool)> {
    let monitor = window
        .primary_monitor()?
        .or(window.current_monitor()?)
        .ok_or_else(|| tauri::Error::Io(std::io::Error::other("aucun écran détecté")))?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let target = placement_in(area.position.x, area.position.y, area.size.width, scale);

    let mut changed = false;
    let size = window.outer_size()?;
    if (size.width, size.height) != (target.width, target.height) {
        window.set_size(PhysicalSize::new(target.width, target.height))?;
        changed = true;
    }
    let position = window.outer_position()?;
    if (position.x, position.y) != (target.x, target.y) {
        window.set_position(PhysicalPosition::new(target.x, target.y))?;
        changed = true;
    }
    if changed {
        log::info!(
            "île placée en ({}, {}), {} × {} px (échelle {scale})",
            target.x,
            target.y,
            target.width,
            target.height
        );
    }
    ensure_visible(window);
    Ok((
        WindowFrame {
            x: target.x,
            y: target.y,
            scale,
        },
        changed,
    ))
}

// ---------------------------------------------------------------------------
// Clics qui passent à travers
// ---------------------------------------------------------------------------

/// Coin haut-gauche de la fenêtre (px physiques écran) et facteur d'échelle (px physiques par px CSS).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowFrame {
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}

/// Décision de la surveillance du curseur.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PointerDecision {
    /// Curseur au-dessus d'une forme (marge exclue) : émis au front dans `desktop://island-pointer`.
    pub inside: bool,
    /// La fenêtre doit recevoir la souris (sinon `set_ignore_cursor_events(true)`).
    pub capture: bool,
}

/// Le pixel physique `(px, py)` est-il dans le rectangle CSS `(x, y, w, h)` agrandi de `grow` px CSS ?
fn contains(frame: WindowFrame, rect: (f64, f64, f64, f64), grow: f64, px: f64, py: f64) -> bool {
    let (x, y, w, h) = rect;
    let left = f64::from(frame.x) + (x - grow) * frame.scale;
    let top = f64::from(frame.y) + (y - grow) * frame.scale;
    let right = f64::from(frame.x) + (x + w + grow) * frame.scale;
    let bottom = f64::from(frame.y) + (y + h + grow) * frame.scale;
    px >= left && px < right && py >= top && py < bottom
}

/// Fonction pure : zones cliquables (px CSS relatifs à la fenêtre) + cadre de la fenêtre + curseur
/// → curseur dans une forme ? fenêtre à rendre cliquable ?
///
/// Cliquable si le curseur est dans une forme, ou s'il est dans la marge `drag_margin` avec le bouton
/// principal enfoncé (un fichier glissé vers l'île doit pouvoir y être déposé).
pub fn decide(
    hits: &IslandHitRects,
    frame: WindowFrame,
    cursor: Option<CursorState>,
) -> PointerDecision {
    let Some(cursor) = cursor else {
        return PointerDecision::default();
    };
    if !(frame.scale.is_finite() && frame.scale > 0.0) {
        return PointerDecision::default();
    }
    let (px, py) = (f64::from(cursor.x), f64::from(cursor.y));
    let rects = || hits.rects.iter().map(|r| (r.x, r.y, r.width, r.height));

    let inside = rects().any(|r| contains(frame, r, 0.0, px, py));
    let in_margin = cursor.primary_down
        && hits.drag_margin > 0.0
        && rects().any(|r| contains(frame, r, hits.drag_margin, px, py));
    PointerDecision {
        inside,
        capture: inside || in_margin,
    }
}

/// Lance la surveillance du curseur et du placement (thread dédié). Appelé une fois dans `setup`,
/// après `create`.
pub fn spawn_pointer_loop(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("island-pointer".into())
        .spawn(move || {
            let Some(window) = app.get_webview_window(WINDOW_PROMPT) else {
                log::error!(
                    "fenêtre {WINDOW_PROMPT} introuvable : surveillance du curseur arrêtée"
                );
                return;
            };
            log::info!("surveillance du curseur de l'île démarrée (toutes les {POINTER_POLL:?})");
            let mut frame: Option<WindowFrame> = None;
            // La fenêtre est créée en ignorant la souris.
            let mut last = PointerDecision::default();
            let mut until_place: u32 = 0;
            loop {
                if PLACE_REQUESTED.swap(false, Ordering::Relaxed) {
                    until_place = until_place.min(PLACE_SOON_TICKS);
                }
                if until_place == 0 {
                    until_place = PLACE_EVERY_TICKS;
                    match place(&window) {
                        Ok((placed, changed)) => {
                            frame = Some(placed);
                            if changed {
                                // Laisser Windows appliquer, puis revérifier (échelle de l'écran d'arrivée).
                                until_place = PLACE_SOON_TICKS;
                            }
                        }
                        Err(e) => log::debug!("placement de l'île : {e}"),
                    }
                }
                until_place -= 1;

                let decision = match frame {
                    Some(frame) => {
                        let cursor = platform::cursor_state();
                        let hits = app.state::<DesktopState>();
                        let hits = hits.island_hits();
                        decide(&hits, frame, cursor)
                    }
                    None => PointerDecision::default(),
                };
                if decision.capture != last.capture {
                    if let Err(e) = window.set_ignore_cursor_events(!decision.capture) {
                        log::warn!("clics de l'île : {e}");
                    }
                }
                if decision.inside != last.inside {
                    let payload = IslandPointer {
                        inside: decision.inside,
                    };
                    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_ISLAND_POINTER, payload) {
                        log::warn!("émission de {EVENT_ISLAND_POINTER} impossible : {e}");
                    }
                }
                last = decision;
                thread::sleep(POINTER_POLL);
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer la surveillance du curseur de l'île : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::IslandRect;

    fn hits(margin: f64) -> IslandHitRects {
        IslandHitRects {
            // Repos : ligne 120 × 8 centrée dans la fenêtre de 640.
            rects: vec![IslandRect {
                x: 260.0,
                y: 0.0,
                width: 120.0,
                height: 8.0,
            }],
            drag_margin: margin,
        }
    }

    fn cursor(x: i32, y: i32, primary_down: bool) -> Option<CursorState> {
        Some(CursorState { x, y, primary_down })
    }

    const FRAME_100: WindowFrame = WindowFrame {
        x: 1000,
        y: 0,
        scale: 1.0,
    };
    const FRAME_150: WindowFrame = WindowFrame {
        x: 1000,
        y: 40,
        scale: 1.5,
    };

    #[test]
    fn inside_the_shape_captures() {
        let d = decide(&hits(24.0), FRAME_100, cursor(1260, 0, false));
        assert_eq!(
            d,
            PointerDecision {
                inside: true,
                capture: true
            }
        );
        // Bord droit et bas exclus.
        assert!(!decide(&hits(24.0), FRAME_100, cursor(1380, 4, false)).inside);
        assert!(!decide(&hits(24.0), FRAME_100, cursor(1300, 8, false)).inside);
    }

    #[test]
    fn outside_passes_through() {
        assert_eq!(
            decide(&hits(24.0), FRAME_100, cursor(1100, 100, false)),
            PointerDecision::default()
        );
        // Sans curseur lisible (session verrouillée) : rien.
        assert_eq!(
            decide(&hits(24.0), FRAME_100, None),
            PointerDecision::default()
        );
        // Aucune zone envoyée : tout traverse.
        assert_eq!(
            decide(&IslandHitRects::default(), FRAME_100, cursor(1300, 2, true)),
            PointerDecision::default()
        );
    }

    #[test]
    fn drag_margin_needs_the_button() {
        // 20 px sous la ligne : dans la marge de 24.
        let free = decide(&hits(24.0), FRAME_100, cursor(1300, 28, false));
        assert_eq!(free, PointerDecision::default());
        let dragging = decide(&hits(24.0), FRAME_100, cursor(1300, 28, true));
        assert_eq!(
            dragging,
            PointerDecision {
                inside: false,
                capture: true
            }
        );
        // Hors de la marge, même bouton enfoncé.
        assert!(!decide(&hits(24.0), FRAME_100, cursor(1300, 40, true)).capture);
        // Marge désactivée.
        assert!(!decide(&hits(0.0), FRAME_100, cursor(1300, 28, true)).capture);
    }

    #[test]
    fn converts_css_px_with_the_scale() {
        // À 150 % : la ligne occupe x ∈ [1000 + 390, 1000 + 570), y ∈ [40, 52).
        assert!(decide(&hits(0.0), FRAME_150, cursor(1390, 40, false)).inside);
        assert!(decide(&hits(0.0), FRAME_150, cursor(1569, 51, false)).inside);
        assert!(!decide(&hits(0.0), FRAME_150, cursor(1389, 45, false)).inside);
        assert!(!decide(&hits(0.0), FRAME_150, cursor(1570, 45, false)).inside);
        assert!(!decide(&hits(0.0), FRAME_150, cursor(1400, 52, false)).inside);
        // Marge de 24 px CSS = 36 px physiques.
        assert!(decide(&hits(24.0), FRAME_150, cursor(1400, 87, true)).capture);
        assert!(!decide(&hits(24.0), FRAME_150, cursor(1400, 88, true)).capture);
        // Échelle invalide : rien.
        let broken = WindowFrame {
            scale: 0.0,
            ..FRAME_150
        };
        assert_eq!(
            decide(&hits(24.0), broken, cursor(1400, 45, true)),
            PointerDecision::default()
        );
    }

    #[test]
    fn several_rects_island_and_bubble() {
        let mut h = hits(0.0);
        h.rects.push(IslandRect {
            x: 400.0,
            y: 0.0,
            width: 44.0,
            height: 40.0,
        });
        assert!(decide(&h, FRAME_100, cursor(1420, 30, false)).inside);
        assert!(!decide(&h, FRAME_100, cursor(1390, 30, false)).inside);
    }

    #[test]
    fn placement_centered_on_the_work_area() {
        // Écran principal 1920 de large à 100 %, barre des tâches en bas.
        assert_eq!(
            placement_in(0, 0, 1920, 1.0),
            Placement {
                x: 640,
                y: 0,
                width: 640,
                height: 260
            }
        );
        // 2560 à 150 %, barre des tâches en haut (zone de travail décalée de 72 px).
        assert_eq!(
            placement_in(0, 72, 2560, 1.5),
            Placement {
                x: 800,
                y: 72,
                width: 960,
                height: 390
            }
        );
        // Écran principal à droite d'un autre (origine négative possible pour les autres écrans).
        assert_eq!(placement_in(-1280, 0, 1280, 1.25).x, -1280 + 240);
    }
}
