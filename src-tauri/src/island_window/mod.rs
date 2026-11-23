//! L'île : la fenêtre `prompt`, transparente, collée au milieu d'un bord d'un écran, toujours présente.
//!
//! - Place = bord (`top`, `bottom`, `left`, `right`) + écran, mémorisée dans
//!   `app_config_dir()/island-placement.json` (voir `placement`) ; par défaut en haut de l'écran principal,
//!   écran introuvable = même bord sur l'écran principal. En haut : centrée sur la zone de travail ; Mac avec
//!   encoche (en haut de l'écran principal seulement) : centrée sur l'écran entier et collée à son bord haut,
//!   au-dessus de la barre des menus, pour que l'île sorte de chaque côté de la caméra (variante `mac` du
//!   front). En bas : centrée en bas de la zone de travail. À gauche / à droite : collée au bord de la zone
//!   de travail, centrée verticalement. Sur Mac la zone de travail évite le Dock et la barre des menus
//!   (`Monitor::work_area` = `visibleFrame`). L'URL de départ porte la place :
//!   `?platform=mac|win&edge=…` ; ensuite `desktop://island-placement`.
//! - Taille selon le bord (`geometry::HORIZONTAL_SIZE`, `VERTICAL_SIZE`), convertie avec l'échelle de
//!   l'écran. Replacée si l'écran, la résolution ou la mise à l'échelle changent : vérification toutes les
//!   2 s, et tout de suite après un changement d'échelle ou un déplacement de la fenêtre (jamais pendant un
//!   glisser ni pendant le ressort).
//! - Clics qui passent à travers : la fenêtre ignore la souris, sauf au-dessus des zones cliquables envoyées
//!   par le front (`island_set_hit_rects`). Un thread (~60 Hz, `motion`) suit le curseur et bascule ; il émet
//!   `desktop://island-pointer` quand le curseur entre dans les formes ou en sort.
//! - Glisser-déposer : un bouton principal enfoncé dans la marge `dragMargin` réactive aussi les clics, pour
//!   que le dépôt natif de Tauri (laissé actif sur cette fenêtre) atteigne l'île.
//! - Déplaçable : le front appelle `island_drag_start` ; le même thread fait suivre le curseur à la fenêtre,
//!   montre l'aperçu de la place visée (fenêtre `island-ghost`), puis au relâchement lance l'île vers le
//!   milieu de bord le plus proche du point projeté, avec un ressort (voir `motion`, calculs dans
//!   `geometry`). « Replacer l'île en haut » (menu du soleil) : `request_top`.
//!
//! - Masquable : case « Afficher l'île » du menu du soleil (`set_hidden`), mémorisée par le témoin
//!   `island-hidden` (`app_config_dir()`). Masquée, plus rien ne la remontre (placement, propositions
//!   automatiques d'appel) ; seuls la case, « Replacer l'île en haut » et un démarrage ou arrêt manuel de
//!   l'enregistrement la ramènent.
//!
//! Le rendu (forme, ressort de la forme) est fait par le front. Repère des positions (écrans, curseur,
//! fenêtres) : `platform::island_space` (px physiques sous Windows, points sous macOS). Fonctions système :
//! `platform::cursor_state`, `primary_notch`, `prepare_island_window`.

mod geometry;
mod motion;
mod placement;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};

use crate::events::{ISLAND_GHOST_ROUTE, PROMPT_ROUTE, WINDOW_ISLAND_GHOST, WINDOW_PROMPT};
use crate::platform::{self, CursorState, IslandSpace};
use crate::state::{IslandEdge, IslandHitRects, IslandPlacement};

pub use motion::spawn_pointer_loop;

use placement::SavedPlacement;

/// Levé par les événements de la fenêtre (échelle, déplacement) : vérifier le placement sans attendre 2 s.
static PLACE_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Écran principal avec encoche au démarrage : en haut de cet écran, l'île se colle au bord haut de
/// l'écran (pas de la zone de travail, qui commence sous la barre des menus) et le front dessine la
/// variante Mac.
static AROUND_NOTCH: AtomicBool = AtomicBool::new(false);

/// L'utilisateur a masqué l'île (case « Afficher l'île » décochée).
static HIDDEN: AtomicBool = AtomicBool::new(false);

/// Échelle de la fenêtre de l'île (bits d'un `f64`), tenue à jour par `ScaleFactorChanged` : sous
/// Windows, garde le point de prise juste quand la fenêtre change d'écran pendant un glisser.
static WINDOW_SCALE: AtomicU64 = AtomicU64::new(0x3FF0_0000_0000_0000); // 1.0

/// L'échelle de la fenêtre de l'île a changé : réappliquer la taille voulue (Windows la recalcule seul).
static PROMPT_RESCALED: AtomicBool = AtomicBool::new(false);
/// Idem pour la fenêtre d'aperçu.
static GHOST_RESCALED: AtomicBool = AtomicBool::new(false);

/// « Replacer l'île en haut » demandé (menu du soleil), traité par le thread de l'île.
static TOP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Glisser demandé par le front (`island_drag_start`), traité par le thread de l'île.
static DRAG_REQUEST: Mutex<Option<DragRequest>> = Mutex::new(None);

/// Place mémorisée et place affichée.
static PLACE: Mutex<PlaceState> = Mutex::new(PlaceState {
    saved: SavedPlacement::TOP_OF_PRIMARY,
    current: IslandPlacement {
        edge: IslandEdge::Top,
        notch: false,
    },
});

/// Témoin dans `app_config_dir()` : présent = île masquée au prochain lancement.
const HIDDEN_FILE: &str = "island-hidden";

/// Taille de la forme noire au début d'un glisser (px CSS, repère du bord), voir `IslandDragStart`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct DragRequest {
    along: f64,
    depth: f64,
}

#[derive(Debug, Clone)]
struct PlaceState {
    /// Bord + écran mémorisés (l'écran peut manquer : l'île est alors sur l'écran principal).
    saved: SavedPlacement,
    /// Ce que le front affiche (`desktop://island-placement`).
    current: IslandPlacement,
}

fn place_state() -> std::sync::MutexGuard<'static, PlaceState> {
    PLACE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Place affichée (commande `get_island_placement`).
pub fn placement() -> IslandPlacement {
    place_state().current
}

/// Le front a commencé un glisser (bouton gauche enfoncé au-delà du seuil). Ignoré si l'île est masquée
/// ou si le bouton est déjà relâché ; sinon le thread de l'île prend la main au prochain tour.
pub fn request_drag(along: f64, depth: f64) {
    if is_hidden() {
        log::debug!("île masquée : glisser ignoré");
        return;
    }
    if !platform::cursor_state().is_some_and(|c| c.primary_down) {
        log::debug!("île : bouton déjà relâché, glisser ignoré");
        return;
    }
    let sane = |v: f64, default: f64| if v.is_finite() && v > 0.0 { v } else { default };
    *DRAG_REQUEST.lock().unwrap_or_else(|e| e.into_inner()) = Some(DragRequest {
        along: sane(along, motion::DEFAULT_ALONG),
        depth: sane(depth, motion::DEFAULT_DEPTH),
    });
}

/// « Replacer l'île en haut » : en haut de l'écran principal, avec le ressort. Pour la réafficher si elle
/// est masquée, voir `tray::set_island_visible`.
pub fn request_top() {
    TOP_REQUESTED.store(true, Ordering::Relaxed);
}

fn hidden_file(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(HIDDEN_FILE)),
        Err(e) => {
            log::warn!("île : dossier de configuration introuvable : {e}");
            None
        }
    }
}

/// L'île est masquée par l'utilisateur.
pub fn is_hidden() -> bool {
    HIDDEN.load(Ordering::Relaxed)
}

/// Masque ou réaffiche l'île et mémorise le choix. Appelé par le menu du soleil (voir `tray`).
pub fn set_hidden(app: &AppHandle, hidden: bool) {
    HIDDEN.store(hidden, Ordering::Relaxed);
    if let Some(path) = hidden_file(app) {
        let saved = if hidden {
            path.parent()
                .map_or(Ok(()), fs::create_dir_all)
                .and_then(|_| fs::write(&path, ""))
        } else {
            match fs::remove_file(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                other => other,
            }
        };
        if let Err(e) = saved {
            log::warn!(
                "île : choix d'affichage non mémorisé ({}) : {e}",
                path.display()
            );
        }
    }
    let Some(window) = app.get_webview_window(WINDOW_PROMPT) else {
        log::warn!("fenêtre {WINDOW_PROMPT} introuvable");
        return;
    };
    if hidden {
        if let Err(e) = window.hide() {
            log::warn!("impossible de masquer l'île : {e}");
        }
    } else {
        // Replacée tout de suite (l'écran a pu changer pendant qu'elle était masquée), puis montrée.
        PLACE_REQUESTED.store(true, Ordering::Relaxed);
        ensure_visible(&window);
    }
    log::info!("île {}", if hidden { "masquée" } else { "affichée" });
}

/// Crée la fenêtre de l'île à sa place mémorisée et la montre sans prendre le focus (sauf si
/// l'utilisateur l'a masquée), puis la fenêtre d'aperçu, cachée. Appelé une fois dans `setup`.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let hidden = hidden_file(app).is_some_and(|path| path.exists());
    HIDDEN.store(hidden, Ordering::Relaxed);
    if hidden {
        log::info!("île masquée (choix mémorisé)");
    }
    let notch = platform::primary_notch();
    AROUND_NOTCH.store(notch.is_some(), Ordering::Relaxed);
    if let Some(n) = notch {
        log::info!(
            "encoche détectée ({} × {} points) : en haut de l'écran principal, île autour de la caméra",
            n.width,
            n.height
        );
    }

    let space = platform::island_space();
    let saved = placement::load(app);
    let current = match placement::monitors(app, space, notch.is_some()) {
        Ok(monitors) => match placement::resolve(&monitors, &saved) {
            Some(index) => IslandPlacement {
                edge: saved.edge,
                notch: geometry::uses_notch(&monitors[index].screen, saved.edge),
            },
            None => IslandPlacement {
                edge: saved.edge,
                notch: false,
            },
        },
        Err(e) => {
            log::warn!("île : écrans illisibles au démarrage : {e}");
            IslandPlacement {
                edge: saved.edge,
                notch: false,
            }
        }
    };
    log::info!(
        "île : place mémorisée {} ({})",
        saved.edge.as_str(),
        saved
            .screen
            .as_ref()
            .and_then(|s| s.name.clone())
            .unwrap_or_else(|| "écran principal".into())
    );
    *place_state() = PlaceState { saved, current };

    let variant = if current.notch { "mac" } else { "win" };
    let url = format!(
        "{PROMPT_ROUTE}?platform={variant}&edge={}",
        current.edge.as_str()
    );
    let (width, height) = window_logical_size(current.edge);
    let window = WebviewWindowBuilder::new(app, WINDOW_PROMPT, WebviewUrl::App(url.into()))
        .title("Sordulo OS")
        .inner_size(width, height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Mac : présente sur tous les bureaux (Spaces) ; sans effet sous Windows.
        .visible_on_all_workspaces(true)
        // Cachée le temps d'être placée, puis montrée par `place` sans activation.
        .visible(false)
        .focused(false)
        // Dépôt de fichiers géré par WebView2 (événements HTML5) : le gestionnaire natif de Tauri ne
        // reçoit jamais le dépôt sur cette fenêtre transparente aux clics.
        .disable_drag_drop_handler()
        .build()?;

    platform::prepare_island_window(&window);
    // Par défaut la souris traverse : tant que le front n'a rien envoyé, rien n'est cliquable.
    window.set_ignore_cursor_events(true)?;
    window.on_window_event(|event| match event {
        WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
            WINDOW_SCALE.store(scale_factor.to_bits(), Ordering::Relaxed);
            PROMPT_RESCALED.store(true, Ordering::Relaxed);
            PLACE_REQUESTED.store(true, Ordering::Relaxed);
        }
        WindowEvent::Moved(_) => PLACE_REQUESTED.store(true, Ordering::Relaxed),
        _ => {}
    });
    if let Err(e) = motion::place(app, &window, space) {
        log::warn!("placement initial de l'île impossible : {e}");
        ensure_visible(&window);
    }
    log::info!(
        "fenêtre de l'île créée ({width} × {height} px logiques, bord {})",
        current.edge.as_str()
    );

    if let Err(e) = create_ghost(app) {
        log::warn!("fenêtre d'aperçu de l'île impossible à créer : {e}");
    }
    Ok(window)
}

/// Taille logique de la fenêtre pour ce bord (px CSS).
fn window_logical_size(edge: IslandEdge) -> (f64, f64) {
    if edge.is_vertical() {
        geometry::VERTICAL_SIZE
    } else {
        geometry::HORIZONTAL_SIZE
    }
}

/// Fenêtre d'aperçu de la place visée pendant un glisser : transparente, sans ombre, toujours devant, hors
/// barre des tâches, jamais activable, ignore toujours la souris. Cachée jusqu'au premier glisser.
fn create_ghost(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let (width, height) = geometry::HORIZONTAL_SIZE;
    let ghost = WebviewWindowBuilder::new(
        app,
        WINDOW_ISLAND_GHOST,
        WebviewUrl::App(ISLAND_GHOST_ROUTE.into()),
    )
    .title("Sordulo OS")
    .inner_size(width, height)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .visible(false)
    .focused(false)
    .focusable(false)
    .disable_drag_drop_handler()
    .build()?;
    platform::prepare_island_window(&ghost);
    ghost.set_ignore_cursor_events(true)?;
    ghost.on_window_event(|event| {
        if let WindowEvent::ScaleFactorChanged { .. } = event {
            GHOST_RESCALED.store(true, Ordering::Relaxed);
        }
    });
    log::info!("fenêtre d'aperçu de l'île créée (cachée)");
    Ok(ghost)
}

/// Montre la fenêtre si elle est cachée, sans voler le focus ni la déplacer. Rien si l'utilisateur a
/// masqué l'île.
pub fn ensure_visible(window: &WebviewWindow<Wry>) {
    if is_hidden() {
        return;
    }
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

/// Unités du repère par px CSS pour la fenêtre de l'île, maintenant (1 en points sur Mac).
fn window_unit_scale(space: IslandSpace) -> f64 {
    match space {
        IslandSpace::Points => 1.0,
        IslandSpace::Physical => {
            let scale = f64::from_bits(WINDOW_SCALE.load(Ordering::Relaxed));
            if scale.is_finite() && scale > 0.0 {
                scale
            } else {
                1.0
            }
        }
    }
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
}
