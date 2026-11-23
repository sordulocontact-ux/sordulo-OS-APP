//! Calculs purs de l'île : rectangle de la fenêtre pour chaque bord, choix de la place au relâchement
//! (projection du lancer), vitesse lissée, ressort de la fenêtre.
//!
//! Unités : celles du repère de l'île (`platform::IslandSpace` : px physiques sous Windows, points sous
//! macOS). `unit_scale` = unités du repère par px CSS (échelle de l'écran sous Windows, 1 sous macOS).

use crate::state::IslandEdge;

/// Taille de la fenêtre de l'île en px CSS, île horizontale (haut, bas) : `ISLAND_WINDOW_SIZE.horizontal`.
/// Plus grand état : `dragOver` 440 + 2 × 10 de bord = 460 ; bulle secondaire 68 de chaque côté ; arrondi à
/// 640 pour laisser la place aux effets (ressort qui dépasse, ombres). Hauteur : `multiOpen` 220 (250 sur
/// Mac) + marge pour le ressort.
pub const HORIZONTAL_SIZE: (f64, f64) = (640.0, 300.0);
/// Taille de la fenêtre de l'île en px CSS, île verticale (gauche, droite) : `ISLAND_WINDOW_SIZE.vertical`.
pub const VERTICAL_SIZE: (f64, f64) = (520.0, 480.0);

/// Temps de projection du lancer (s) : point visé = curseur + vitesse × ce temps.
pub const PROJECTION_SECS: f64 = 0.3;
/// Vitesse de lancer prise en compte au plus (px CSS / s) : projection bornée à 1 500 px CSS.
pub const MAX_THROW_SPEED: f64 = 5000.0;
/// Fenêtre de lissage de la vitesse (s).
pub const VELOCITY_WINDOW: f64 = 0.1;

/// Raideur du ressort de la fenêtre (1/s²) : pulsation propre ≈ 17,9 rad/s.
pub const SPRING_STIFFNESS: f64 = 320.0;
/// Amortissement du ressort (1/s) : rapport ≈ 0,7, léger dépassement (≈ 5 % depuis l'arrêt).
pub const SPRING_DAMPING: f64 = 25.0;
/// Pas d'intégration du ressort au plus (s).
const SPRING_SUBSTEP: f64 = 1.0 / 240.0;
/// Pas de temps pris en compte au plus (s) : un thread en retard ne fait pas sauter la fenêtre.
const SPRING_MAX_DT: f64 = 0.05;

/// Rectangle en unités du repère (nombres réels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }

    pub fn center_x(&self) -> f64 {
        self.x + self.width / 2.0
    }

    pub fn center_y(&self) -> f64 {
        self.y + self.height / 2.0
    }
}

/// Un écran, dans le repère de l'île.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    /// Écran entier.
    pub full: Rect,
    /// Zone de travail (sans la barre des tâches ; sur Mac sans le Dock ni la barre des menus).
    pub work: Rect,
    /// Unités du repère par px CSS.
    pub unit_scale: f64,
    /// Écran principal.
    pub primary: bool,
    /// Encoche de la caméra en haut de cet écran : en haut, l'île l'entoure (variante `mac`).
    pub notch: bool,
}

/// Rectangle de la fenêtre, en unités entières du repère.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// L'île entoure l'encoche : seulement en haut de l'écran à encoche.
pub fn uses_notch(screen: &Screen, edge: IslandEdge) -> bool {
    edge == IslandEdge::Top && screen.notch
}

/// Taille de la fenêtre de l'île pour ce bord, en unités entières du repère.
pub fn window_size(edge: IslandEdge, unit_scale: f64) -> (u32, u32) {
    let (width, height) = if edge.is_vertical() {
        VERTICAL_SIZE
    } else {
        HORIZONTAL_SIZE
    };
    (
        (width * unit_scale).round() as u32,
        (height * unit_scale).round() as u32,
    )
}

/// Zone où l'île se colle : l'écran entier en haut d'un écran à encoche (au-dessus de la barre des menus,
/// autour de la caméra), sinon la zone de travail.
fn area(screen: &Screen, edge: IslandEdge) -> Rect {
    if uses_notch(screen, edge) {
        screen.full
    } else {
        screen.work
    }
}

/// Décalage qui centre `inner` dans `outer` (arrondi vers le bas, comme le placement historique).
fn centered(outer: f64, inner: u32) -> f64 {
    ((outer - f64::from(inner)) / 2.0).floor()
}

/// Rectangle de la fenêtre de l'île collée au milieu de ce bord : en haut et en bas centrée
/// horizontalement, à gauche et à droite centrée verticalement.
pub fn window_rect(screen: &Screen, edge: IslandEdge) -> WindowRect {
    let (width, height) = window_size(edge, screen.unit_scale);
    let a = area(screen, edge);
    let (x, y) = match edge {
        IslandEdge::Top => (a.x + centered(a.width, width), a.y),
        IslandEdge::Bottom => (
            a.x + centered(a.width, width),
            a.bottom() - f64::from(height),
        ),
        IslandEdge::Left => (a.x, a.y + centered(a.height, height)),
        IslandEdge::Right => (
            a.right() - f64::from(width),
            a.y + centered(a.height, height),
        ),
    };
    WindowRect {
        x: x.round() as i32,
        y: y.round() as i32,
        width,
        height,
    }
}

/// Milieu du bord (point d'attache de l'île), pour choisir la place la plus proche.
pub fn anchor(screen: &Screen, edge: IslandEdge) -> (f64, f64) {
    let a = area(screen, edge);
    match edge {
        IslandEdge::Top => (a.center_x(), a.y),
        IslandEdge::Bottom => (a.center_x(), a.bottom()),
        IslandEdge::Left => (a.x, a.center_y()),
        IslandEdge::Right => (a.right(), a.center_y()),
    }
}

/// Milieu de bord le plus proche du point, parmi les 4 bords de tous les écrans : (indice de l'écran, bord).
pub fn nearest_place(screens: &[Screen], point: (f64, f64)) -> Option<(usize, IslandEdge)> {
    let mut best: Option<(f64, usize, IslandEdge)> = None;
    for (index, screen) in screens.iter().enumerate() {
        for edge in IslandEdge::ALL {
            let (ax, ay) = anchor(screen, edge);
            let distance = (ax - point.0).powi(2) + (ay - point.1).powi(2);
            if best.map_or(true, |(d, _, _)| distance < d) {
                best = Some((distance, index, edge));
            }
        }
    }
    best.map(|(_, index, edge)| (index, edge))
}

/// Centre de la forme noire dans la fenêtre (`width` × `height`), forme de profondeur `depth`
/// (unités du repère), collée au bord de la fenêtre qui touche le bord de l'écran.
pub fn shape_center(edge: IslandEdge, width: f64, height: f64, depth: f64) -> (f64, f64) {
    match edge {
        IslandEdge::Top => (width / 2.0, depth / 2.0),
        IslandEdge::Bottom => (width / 2.0, height - depth / 2.0),
        IslandEdge::Left => (depth / 2.0, height / 2.0),
        IslandEdge::Right => (width - depth / 2.0, height / 2.0),
    }
}

/// Position du curseur à un instant (secondes depuis un point de départ quelconque).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub t: f64,
    pub x: f64,
    pub y: f64,
}

/// Vitesse lissée (unités / s) : déplacement entre le plus ancien échantillon de la fenêtre `window` et le
/// dernier. Nulle si les échantillons couvrent moins de 8 ms.
pub fn velocity(samples: &[Sample], window: f64) -> (f64, f64) {
    let Some(last) = samples.last() else {
        return (0.0, 0.0);
    };
    let first = samples
        .iter()
        .find(|s| last.t - s.t <= window)
        .unwrap_or(last);
    let dt = last.t - first.t;
    if dt < 0.008 {
        return (0.0, 0.0);
    }
    ((last.x - first.x) / dt, (last.y - first.y) / dt)
}

/// Vitesse bornée en norme à `max` (même direction).
pub fn clamp_speed(velocity: (f64, f64), max: f64) -> (f64, f64) {
    let speed = velocity.0.hypot(velocity.1);
    if !speed.is_finite() {
        return (0.0, 0.0);
    }
    if speed > max && speed > 0.0 {
        let k = max / speed;
        (velocity.0 * k, velocity.1 * k)
    } else {
        velocity
    }
}

/// Point projeté du lancer : position + vitesse (bornée à `max_speed`) × `secs`.
pub fn project(point: (f64, f64), velocity: (f64, f64), max_speed: f64, secs: f64) -> (f64, f64) {
    let (vx, vy) = clamp_speed(velocity, max_speed);
    (point.0 + vx * secs, point.1 + vy * secs)
}

/// Un pas du ressort amorti (une coordonnée) : renvoie (position, vitesse) après `dt` secondes.
/// Euler semi-implicite par sous-pas de 1/240 s ; `dt` borné à 50 ms.
pub fn spring_step(pos: f64, vel: f64, target: f64, dt: f64) -> (f64, f64) {
    let dt = dt.clamp(0.0, SPRING_MAX_DT);
    let steps = (dt / SPRING_SUBSTEP).ceil().max(1.0) as u32;
    let h = dt / f64::from(steps);
    let (mut pos, mut vel) = (pos, vel);
    for _ in 0..steps {
        let acceleration = -SPRING_STIFFNESS * (pos - target) - SPRING_DAMPING * vel;
        vel += acceleration * h;
        pos += vel * h;
    }
    (pos, vel)
}

/// Le ressort est arrivé : à moins de `pos_eps` de la cible et plus lent que `vel_eps` (par coordonnée).
pub fn spring_settled(pos: f64, vel: f64, target: f64, pos_eps: f64, vel_eps: f64) -> bool {
    (pos - target).abs() < pos_eps && vel.abs() < vel_eps
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    /// 1920 × 1080 à 100 %, barre des tâches de 40 en bas.
    fn screen_1080() -> Screen {
        Screen {
            full: rect(0.0, 0.0, 1920.0, 1080.0),
            work: rect(0.0, 0.0, 1920.0, 1040.0),
            unit_scale: 1.0,
            primary: true,
            notch: false,
        }
    }

    /// 2560 × 1440 à 150 %, à droite du premier.
    fn screen_right() -> Screen {
        Screen {
            full: rect(1920.0, 0.0, 2560.0, 1440.0),
            work: rect(1920.0, 0.0, 2560.0, 1368.0),
            unit_scale: 1.5,
            primary: false,
            notch: false,
        }
    }

    /// MacBook avec encoche, en points : barre des menus de 37, Dock de 70 en bas.
    fn screen_mac() -> Screen {
        Screen {
            full: rect(0.0, 0.0, 1512.0, 982.0),
            work: rect(0.0, 37.0, 1512.0, 875.0),
            unit_scale: 1.0,
            primary: true,
            notch: true,
        }
    }

    #[test]
    fn top_matches_the_historical_placement() {
        assert_eq!(
            window_rect(&screen_1080(), IslandEdge::Top),
            WindowRect {
                x: 640,
                y: 0,
                width: 640,
                height: 300
            }
        );
        // 2560 à 150 %, barre des tâches en haut (zone de travail décalée de 72 px).
        let mut s = screen_right();
        s.full = rect(0.0, 0.0, 2560.0, 1440.0);
        s.work = rect(0.0, 72.0, 2560.0, 1368.0);
        assert_eq!(
            window_rect(&s, IslandEdge::Top),
            WindowRect {
                x: 800,
                y: 72,
                width: 960,
                height: 450
            }
        );
        // Origine négative (écran à gauche du principal), 125 %.
        s.full = rect(-1280.0, 0.0, 1280.0, 1024.0);
        s.work = s.full;
        s.unit_scale = 1.25;
        assert_eq!(window_rect(&s, IslandEdge::Top).x, -1280 + 240);
    }

    #[test]
    fn rect_of_each_edge() {
        let s = screen_1080();
        assert_eq!(
            window_rect(&s, IslandEdge::Bottom),
            WindowRect {
                x: 640,
                y: 1040 - 300,
                width: 640,
                height: 300
            }
        );
        assert_eq!(
            window_rect(&s, IslandEdge::Left),
            WindowRect {
                x: 0,
                y: (1040 - 480) / 2,
                width: 520,
                height: 480
            }
        );
        assert_eq!(
            window_rect(&s, IslandEdge::Right),
            WindowRect {
                x: 1920 - 520,
                y: 280,
                width: 520,
                height: 480
            }
        );
        // Échelle 150 % : 780 × 720 px physiques sur les côtés.
        let r = window_rect(&screen_right(), IslandEdge::Right);
        assert_eq!((r.width, r.height), (780, 720));
        assert_eq!((r.x, r.y), (1920 + 2560 - 780, (1368 - 720) / 2));
    }

    #[test]
    fn notch_only_at_the_top_of_the_notched_screen() {
        let mac = screen_mac();
        assert!(uses_notch(&mac, IslandEdge::Top));
        for edge in [IslandEdge::Bottom, IslandEdge::Left, IslandEdge::Right] {
            assert!(!uses_notch(&mac, edge));
        }
        // En haut : écran entier (au-dessus de la barre des menus).
        assert_eq!(window_rect(&mac, IslandEdge::Top).y, 0);
        assert_eq!(anchor(&mac, IslandEdge::Top), (756.0, 0.0));
        // En bas : au-dessus du Dock.
        assert_eq!(window_rect(&mac, IslandEdge::Bottom).y, 37 + 875 - 300);
        // Côtés : centrés sur la zone de travail.
        assert_eq!(window_rect(&mac, IslandEdge::Left).y, 37 + (875 - 480) / 2);
        // Sans encoche : sous la barre des menus.
        let plain = Screen {
            notch: false,
            ..mac
        };
        assert_eq!(window_rect(&plain, IslandEdge::Top).y, 37);
    }

    #[test]
    fn nearest_edge_middle() {
        let screens = [screen_1080(), screen_right()];
        assert_eq!(
            nearest_place(&screens, (960.0, 100.0)),
            Some((0, IslandEdge::Top))
        );
        assert_eq!(
            nearest_place(&screens, (900.0, 1000.0)),
            Some((0, IslandEdge::Bottom))
        );
        assert_eq!(
            nearest_place(&screens, (100.0, 600.0)),
            Some((0, IslandEdge::Left))
        );
        assert_eq!(
            nearest_place(&screens, (1800.0, 520.0)),
            Some((0, IslandEdge::Right))
        );
        // Sur le deuxième écran.
        assert_eq!(
            nearest_place(&screens, (4400.0, 700.0)),
            Some((1, IslandEdge::Right))
        );
        assert_eq!(
            nearest_place(&screens, (2000.0, 690.0)),
            Some((1, IslandEdge::Left))
        );
        assert_eq!(nearest_place(&[], (0.0, 0.0)), None);
    }

    #[test]
    fn a_throw_counts() {
        let screens = [screen_1080()];
        // Lâchée au centre sans vitesse : ex aequo haut / bas, le premier bord (haut) gagne.
        let center = (960.0, 520.0);
        assert_eq!(
            nearest_place(
                &screens,
                project(center, (0.0, 0.0), MAX_THROW_SPEED, PROJECTION_SECS)
            ),
            Some((0, IslandEdge::Top))
        );
        // Geste rapide vers la droite (3 000 px/s) lâché près du centre : à droite.
        let thrown = project(
            (1000.0, 500.0),
            (3000.0, 0.0),
            MAX_THROW_SPEED,
            PROJECTION_SECS,
        );
        assert_eq!(
            nearest_place(&screens, thrown),
            Some((0, IslandEdge::Right))
        );
        // Vers le bas.
        let thrown = project(
            (960.0, 400.0),
            (0.0, 2500.0),
            MAX_THROW_SPEED,
            PROJECTION_SECS,
        );
        assert_eq!(
            nearest_place(&screens, thrown),
            Some((0, IslandEdge::Bottom))
        );
        // Vitesse bornée : projection de 1 500 px au plus.
        let far = project((0.0, 0.0), (1.0e6, 0.0), MAX_THROW_SPEED, PROJECTION_SECS);
        assert!((far.0 - MAX_THROW_SPEED * PROJECTION_SECS).abs() < 1e-6);
        assert_eq!(far.1, 0.0);
        assert_eq!(clamp_speed((f64::NAN, 1.0), 10.0), (0.0, 0.0));
    }

    #[test]
    fn smoothed_velocity() {
        let s = |t: f64, x: f64| Sample { t, x, y: 0.0 };
        assert_eq!(velocity(&[], VELOCITY_WINDOW), (0.0, 0.0));
        assert_eq!(velocity(&[s(0.0, 10.0)], VELOCITY_WINDOW), (0.0, 0.0));
        // 16 ms par échantillon, 16 px par échantillon = 1 000 px/s.
        let samples: Vec<Sample> = (0..20)
            .map(|i| s(f64::from(i) * 0.016, f64::from(i) * 16.0))
            .collect();
        let (vx, vy) = velocity(&samples, VELOCITY_WINDOW);
        assert!((vx - 1000.0).abs() < 1e-6, "{vx}");
        assert_eq!(vy, 0.0);
        // Arrêt de 150 ms avant de lâcher : plus de vitesse.
        let mut stopped = samples.clone();
        let last = *stopped.last().unwrap();
        for i in 1..=10 {
            stopped.push(s(last.t + f64::from(i) * 0.016, last.x));
        }
        assert_eq!(velocity(&stopped, VELOCITY_WINDOW), (0.0, 0.0));
    }

    #[test]
    fn shape_center_on_each_edge() {
        assert_eq!(
            shape_center(IslandEdge::Top, 640.0, 300.0, 40.0),
            (320.0, 20.0)
        );
        assert_eq!(
            shape_center(IslandEdge::Bottom, 640.0, 300.0, 40.0),
            (320.0, 280.0)
        );
        assert_eq!(
            shape_center(IslandEdge::Left, 520.0, 480.0, 40.0),
            (20.0, 240.0)
        );
        assert_eq!(
            shape_center(IslandEdge::Right, 520.0, 480.0, 40.0),
            (500.0, 240.0)
        );
    }

    /// Simule le ressort à 60 Hz : (temps d'arrivée, dépassement maximal au-delà de la cible).
    fn run_spring(from: f64, vel: f64, target: f64) -> (f64, f64) {
        let (mut pos, mut vel) = (from, vel);
        let direction = (target - from).signum();
        let mut overshoot: f64 = 0.0;
        let mut t = 0.0;
        while t < 3.0 {
            (pos, vel) = spring_step(pos, vel, target, 1.0 / 60.0);
            t += 1.0 / 60.0;
            overshoot = overshoot.max((pos - target) * direction);
            if spring_settled(pos, vel, target, 0.5, 10.0) {
                return (t, overshoot);
            }
        }
        (t, overshoot)
    }

    #[test]
    fn spring_overshoots_a_little_and_settles() {
        let (t, overshoot) = run_spring(0.0, 0.0, 1000.0);
        assert!(t < 0.8, "arrivée trop lente : {t}");
        assert!(
            overshoot > 0.0 && overshoot < 80.0,
            "dépassement : {overshoot}"
        );
        // Lancer rapide vers la cible : plus de dépassement, mais arrivée quand même.
        let (t, overshoot) = run_spring(0.0, 5000.0, 600.0);
        assert!(t < 1.0, "arrivée trop lente : {t}");
        assert!(overshoot < 300.0, "dépassement : {overshoot}");
        // Pas énorme (thread en retard) : borné, pas d'explosion.
        let (pos, vel) = spring_step(0.0, 0.0, 100.0, 10.0);
        assert!(pos.abs() < 100.0 && vel.is_finite());
        // Déjà arrivée : immobile.
        assert_eq!(spring_step(5.0, 0.0, 5.0, 1.0 / 60.0), (5.0, 0.0));
    }
}
