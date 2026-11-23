//! Place de l'île (bord + écran) : mémorisée dans `app_config_dir()/island-placement.json`, écrans lus
//! depuis Tauri et convertis dans le repère de l'île, lecture et écriture du rectangle d'une fenêtre.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

use super::geometry::{Rect, Screen, WindowRect};
use crate::platform::IslandSpace;
use crate::state::IslandEdge;

/// Fichier de la place mémorisée, dans `app_config_dir()`.
const PLACEMENT_FILE: &str = "island-placement.json";

/// Identité d'un écran : nom donné par le système et position de son coin (px physiques de Tauri).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenId {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
}

/// Place mémorisée : bord + écran (`None` = écran principal).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedPlacement {
    pub edge: IslandEdge,
    #[serde(default)]
    pub screen: Option<ScreenId>,
}

impl SavedPlacement {
    /// Place par défaut : en haut de l'écran principal.
    pub const TOP_OF_PRIMARY: SavedPlacement = SavedPlacement {
        edge: IslandEdge::Top,
        screen: None,
    };
}

/// Un écran lu depuis Tauri : identité + géométrie dans le repère de l'île.
#[derive(Debug, Clone, PartialEq)]
pub struct Monitor {
    pub id: ScreenId,
    pub screen: Screen,
}

fn placement_file(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_config_dir() {
        Ok(dir) => Some(dir.join(PLACEMENT_FILE)),
        Err(e) => {
            log::warn!("île : dossier de configuration introuvable : {e}");
            None
        }
    }
}

/// Place mémorisée ; absente ou illisible = en haut de l'écran principal.
pub fn load(app: &AppHandle) -> SavedPlacement {
    let Some(path) = placement_file(app) else {
        return SavedPlacement::TOP_OF_PRIMARY;
    };
    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<SavedPlacement>(&text) {
            Ok(saved) => saved,
            Err(e) => {
                log::warn!("île : place mémorisée illisible ({}) : {e}", path.display());
                SavedPlacement::TOP_OF_PRIMARY
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => SavedPlacement::TOP_OF_PRIMARY,
        Err(e) => {
            log::warn!("île : place mémorisée illisible ({}) : {e}", path.display());
            SavedPlacement::TOP_OF_PRIMARY
        }
    }
}

/// Mémorise la place (erreurs seulement journalisées).
pub fn save(app: &AppHandle, saved: &SavedPlacement) {
    let Some(path) = placement_file(app) else {
        return;
    };
    let written = serde_json::to_string(saved)
        .map_err(std::io::Error::other)
        .and_then(|json| {
            path.parent()
                .map_or(Ok(()), fs::create_dir_all)
                .and_then(|_| fs::write(&path, json))
        });
    if let Err(e) = written {
        log::warn!("île : place non mémorisée ({}) : {e}", path.display());
    }
}

/// Indice de l'écran mémorisé : même nom et même position, sinon même nom (s'il est unique), sinon même
/// position. `None` = écran introuvable.
pub fn find_screen(monitors: &[Monitor], id: &ScreenId) -> Option<usize> {
    if let Some(i) = monitors.iter().position(|m| m.id == *id) {
        return Some(i);
    }
    if id.name.is_some() {
        let mut same_name = monitors
            .iter()
            .enumerate()
            .filter(|(_, m)| m.id.name == id.name);
        if let (Some((i, _)), None) = (same_name.next(), same_name.next()) {
            return Some(i);
        }
    }
    monitors
        .iter()
        .position(|m| (m.id.x, m.id.y) == (id.x, id.y))
}

/// Écran principal (le premier si aucun n'est marqué principal). `None` sans écran.
pub fn primary_index(monitors: &[Monitor]) -> Option<usize> {
    monitors
        .iter()
        .position(|m| m.screen.primary)
        .or((!monitors.is_empty()).then_some(0))
}

/// Écran de la place mémorisée ; introuvable = écran principal.
pub fn resolve(monitors: &[Monitor], saved: &SavedPlacement) -> Option<usize> {
    saved
        .screen
        .as_ref()
        .and_then(|id| find_screen(monitors, id))
        .or_else(|| primary_index(monitors))
}

/// Convertit une valeur en px physiques de Tauri dans le repère de l'île.
fn to_space(space: IslandSpace, value: f64, scale: f64) -> f64 {
    match space {
        IslandSpace::Physical => value,
        IslandSpace::Points => (value / scale).round(),
    }
}

/// Écrans connectés, dans le repère de l'île. `notch_on_primary` : l'écran principal a une encoche
/// (détectée au démarrage, voir `platform::primary_notch`).
pub fn monitors(
    app: &AppHandle,
    space: IslandSpace,
    notch_on_primary: bool,
) -> tauri::Result<Vec<Monitor>> {
    let primary = app.primary_monitor()?;
    let is_primary = |m: &tauri::Monitor| {
        primary
            .as_ref()
            .is_some_and(|p| p.name() == m.name() && p.position() == m.position())
    };
    let list = app.available_monitors()?;
    Ok(list
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            let scale = if scale.is_finite() && scale > 0.0 {
                scale
            } else {
                1.0
            };
            let rect = |x: i32, y: i32, width: u32, height: u32| Rect {
                x: to_space(space, f64::from(x), scale),
                y: to_space(space, f64::from(y), scale),
                width: to_space(space, f64::from(width), scale),
                height: to_space(space, f64::from(height), scale),
            };
            let (position, size, work) = (m.position(), m.size(), m.work_area());
            let primary = is_primary(m);
            Monitor {
                id: ScreenId {
                    name: m.name().cloned(),
                    x: position.x,
                    y: position.y,
                },
                screen: Screen {
                    full: rect(position.x, position.y, size.width, size.height),
                    work: rect(
                        work.position.x,
                        work.position.y,
                        work.size.width,
                        work.size.height,
                    ),
                    unit_scale: match space {
                        IslandSpace::Physical => scale,
                        IslandSpace::Points => 1.0,
                    },
                    primary,
                    notch: primary && notch_on_primary,
                },
            }
        })
        .collect())
}

/// Rectangle actuel de la fenêtre, dans le repère de l'île.
pub fn read_rect(window: &WebviewWindow, space: IslandSpace) -> tauri::Result<WindowRect> {
    let (position, size) = (window.outer_position()?, window.outer_size()?);
    Ok(match space {
        IslandSpace::Physical => WindowRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        IslandSpace::Points => {
            let scale = window.scale_factor()?;
            let position = position.to_logical::<f64>(scale);
            let size = size.to_logical::<f64>(scale);
            WindowRect {
                x: position.x.round() as i32,
                y: position.y.round() as i32,
                width: size.width.round() as u32,
                height: size.height.round() as u32,
            }
        }
    })
}

/// Déplace la fenêtre (coin haut-gauche, repère de l'île).
pub fn set_position(
    window: &WebviewWindow,
    space: IslandSpace,
    x: i32,
    y: i32,
) -> tauri::Result<()> {
    match space {
        IslandSpace::Physical => window.set_position(PhysicalPosition::new(x, y)),
        IslandSpace::Points => {
            window.set_position(LogicalPosition::new(f64::from(x), f64::from(y)))
        }
    }
}

/// Redimensionne la fenêtre (repère de l'île).
pub fn set_size(
    window: &WebviewWindow,
    space: IslandSpace,
    width: u32,
    height: u32,
) -> tauri::Result<()> {
    match space {
        IslandSpace::Physical => window.set_size(PhysicalSize::new(width, height)),
        IslandSpace::Points => {
            window.set_size(LogicalSize::new(f64::from(width), f64::from(height)))
        }
    }
}

/// Place la fenêtre exactement sur `rect` (taille puis position).
pub fn apply_rect(
    window: &WebviewWindow,
    space: IslandSpace,
    rect: WindowRect,
) -> tauri::Result<()> {
    set_size(window, space, rect.width, rect.height)?;
    set_position(window, space, rect.x, rect.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(name: Option<&str>, x: i32, y: i32, primary: bool) -> Monitor {
        let r = Rect {
            x: f64::from(x),
            y: f64::from(y),
            width: 1920.0,
            height: 1080.0,
        };
        Monitor {
            id: ScreenId {
                name: name.map(str::to_owned),
                x,
                y,
            },
            screen: Screen {
                full: r,
                work: r,
                unit_scale: 1.0,
                primary,
                notch: false,
            },
        }
    }

    fn id(name: Option<&str>, x: i32, y: i32) -> ScreenId {
        ScreenId {
            name: name.map(str::to_owned),
            x,
            y,
        }
    }

    #[test]
    fn saved_placement_json() {
        let saved = SavedPlacement {
            edge: IslandEdge::Left,
            screen: Some(id(Some(r"\\.\DISPLAY2"), 1920, 0)),
        };
        let json = serde_json::to_value(&saved).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "edge": "left",
                "screen": { "name": r"\\.\DISPLAY2", "x": 1920, "y": 0 }
            })
        );
        assert_eq!(
            serde_json::from_value::<SavedPlacement>(json).unwrap(),
            saved
        );
        // Écran absent du fichier : écran principal.
        let bare: SavedPlacement = serde_json::from_str(r#"{ "edge": "bottom" }"#).unwrap();
        assert_eq!(bare.screen, None);
        assert!(serde_json::from_str::<SavedPlacement>(r#"{ "edge": "middle" }"#).is_err());
    }

    #[test]
    fn finds_the_saved_screen() {
        let monitors = [
            monitor(Some("A"), 0, 0, true),
            monitor(Some("B"), 1920, 0, false),
            monitor(Some("B"), -1920, 0, false),
        ];
        assert_eq!(find_screen(&monitors, &id(Some("B"), 1920, 0)), Some(1));
        // Même nom unique, position changée (écrans réorganisés).
        assert_eq!(find_screen(&monitors, &id(Some("A"), 500, 0)), Some(0));
        // Nom en double et position inconnue : introuvable.
        assert_eq!(find_screen(&monitors, &id(Some("B"), 9999, 0)), None);
        // Nom inconnu, même position.
        assert_eq!(find_screen(&monitors, &id(Some("C"), -1920, 0)), Some(2));
        assert_eq!(find_screen(&monitors, &id(None, 7, 7)), None);
    }

    #[test]
    fn missing_screen_falls_back_to_the_primary() {
        let monitors = [
            monitor(Some("B"), 1920, 0, false),
            monitor(Some("A"), 0, 0, true),
        ];
        let saved = SavedPlacement {
            edge: IslandEdge::Right,
            screen: Some(id(Some("Z"), 5000, 0)),
        };
        assert_eq!(resolve(&monitors, &saved), Some(1));
        assert_eq!(resolve(&monitors, &SavedPlacement::TOP_OF_PRIMARY), Some(1));
        // Aucun écran marqué principal : le premier.
        let none_primary = [monitor(Some("B"), 1920, 0, false)];
        assert_eq!(resolve(&none_primary, &saved), Some(0));
        assert_eq!(resolve(&[], &saved), None);
    }

    #[test]
    fn converts_to_points_on_mac() {
        assert_eq!(to_space(IslandSpace::Points, 3024.0, 2.0), 1512.0);
        assert_eq!(to_space(IslandSpace::Points, -2560.0, 1.0), -2560.0);
        assert_eq!(to_space(IslandSpace::Physical, 3024.0, 2.0), 3024.0);
    }
}
