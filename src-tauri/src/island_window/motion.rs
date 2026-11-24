//! Thread de l'île (~60 Hz) : clics qui passent à travers, placement, glisser, lancer et ressort, aperçu.
//!
//! Trois modes :
//! - repos : la fenêtre ignore la souris hors des formes (`decide`), place vérifiée toutes les 2 s ;
//! - glisser (après `island_drag_start`) : la fenêtre suit le curseur en gardant le point de prise et capte
//!   la souris ; la vitesse est lissée sur 100 ms ; l'aperçu (`island-ghost`) montre la place visée ;
//! - ressort (après le relâchement ou « Replacer l'île en haut ») : la fenêtre, déjà à la taille du bord
//!   visé, rejoint sa place avec un ressort amorti qui part de la vitesse du lancer.
//!
//! Positions dans le repère de l'île (`platform::island_space`).

use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};

use super::geometry::{self, Sample, Screen, WindowRect};
use super::placement::{self, Monitor, SavedPlacement};
use super::{
    decide, ensure_visible, is_hidden, place_state, window_unit_scale, DragRequest,
    PointerDecision, WindowFrame, AROUND_NOTCH, DRAG_REQUEST, GHOST_RESCALED, PLACE_REQUESTED,
    PROMPT_RESCALED, TOP_REQUESTED, WINDOW_SCALE,
};
use crate::events::{
    EVENT_ISLAND_DRAG, EVENT_ISLAND_GHOST, EVENT_ISLAND_PLACEMENT, EVENT_ISLAND_POINTER,
    WINDOW_ISLAND_GHOST, WINDOW_PROMPT,
};
use crate::platform::{self, CursorState, IslandSpace};
use crate::state::{
    DesktopState, IslandDrag, IslandDragPhase, IslandEdge, IslandGhost, IslandPlacement,
    IslandPointer,
};

/// Période de la surveillance du curseur (~60 Hz).
const POINTER_POLL: Duration = Duration::from_millis(16);
/// Vérification du placement : toutes les ~2 s (en tours de surveillance du curseur).
const PLACE_EVERY_TICKS: u32 = 125;
/// Après un replacement ou un changement d'échelle : nouvelle vérification après ~250 ms.
const PLACE_SOON_TICKS: u32 = 15;

/// Forme au repos en haut (px CSS), si le front n'a rien envoyé d'utilisable.
pub(super) const DEFAULT_ALONG: f64 = 193.0;
pub(super) const DEFAULT_DEPTH: f64 = 40.0;

/// Échantillons du curseur gardés pendant un glisser (s), plus que la fenêtre de lissage.
const SAMPLES_KEPT: f64 = 0.25;
/// Durée maximale du ressort (s) : au-delà, la fenêtre est posée à sa place.
const SPRING_MAX_SECS: f64 = 1.5;
/// Ressort arrivé : à moins de 0,5 px CSS de la cible, plus lent que 12 px CSS / s.
const SETTLE_POS_CSS: f64 = 0.5;
const SETTLE_VEL_CSS: f64 = 12.0;

/// Place la fenêtre à sa place mémorisée (écran introuvable = écran principal), la redimensionne si
/// besoin et la remontre si elle a été cachée. Émet `island-placement` si le bord ou l'encoche affichés
/// changent (écran débranché ou rebranché). Renvoie le cadre (zones cliquables) et si quelque chose a bougé.
pub(super) fn place(
    app: &AppHandle,
    window: &WebviewWindow<Wry>,
    space: IslandSpace,
) -> tauri::Result<(WindowFrame, bool)> {
    let monitors = placement::monitors(app, space, AROUND_NOTCH.load(Ordering::Relaxed))?;
    let saved = place_state().saved.clone();
    let index = placement::resolve(&monitors, &saved)
        .ok_or_else(|| tauri::Error::Io(std::io::Error::other("aucun écran détecté")))?;
    let screen = monitors[index].screen;
    let target = geometry::window_rect(&screen, saved.edge);

    let shown = IslandPlacement {
        edge: saved.edge,
        notch: geometry::uses_notch(&screen, saved.edge),
    };
    let previous = std::mem::replace(&mut place_state().current, shown);
    if previous != shown {
        log::info!(
            "île : place affichée {} (encoche : {})",
            shown.edge.as_str(),
            shown.notch
        );
        emit_placement(app, shown);
    }

    let current = placement::read_rect(window, space)?;
    let mut changed = false;
    if (current.width, current.height) != (target.width, target.height) {
        placement::set_size(window, space, target.width, target.height)?;
        changed = true;
    }
    if (current.x, current.y) != (target.x, target.y) {
        placement::set_position(window, space, target.x, target.y)?;
        changed = true;
    }
    if changed {
        log::info!(
            "île placée en ({}, {}), {} × {} (bord {}, échelle {})",
            target.x,
            target.y,
            target.width,
            target.height,
            saved.edge.as_str(),
            screen.unit_scale
        );
    }
    if space == IslandSpace::Physical {
        WINDOW_SCALE.store(screen.unit_scale.to_bits(), Ordering::Relaxed);
    }
    ensure_visible(window);
    Ok((
        WindowFrame {
            x: target.x,
            y: target.y,
            scale: screen.unit_scale,
        },
        changed,
    ))
}

fn emit_placement(app: &AppHandle, placement: IslandPlacement) {
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_ISLAND_PLACEMENT, placement) {
        log::warn!("émission de {EVENT_ISLAND_PLACEMENT} impossible : {e}");
    }
}

fn emit_drag(app: &AppHandle, phase: IslandDragPhase) {
    if let Err(e) = app.emit_to(WINDOW_PROMPT, EVENT_ISLAND_DRAG, IslandDrag { phase }) {
        log::warn!("émission de {EVENT_ISLAND_DRAG} impossible : {e}");
    }
}

/// Lance la surveillance du curseur, du placement et des déplacements (thread dédié). Appelé une fois dans
/// `setup`, après `create`.
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
            let ghost = app.get_webview_window(WINDOW_ISLAND_GHOST);
            if ghost.is_none() {
                log::warn!("fenêtre {WINDOW_ISLAND_GHOST} introuvable : glisser sans aperçu");
            }
            log::info!("surveillance du curseur de l'île démarrée (toutes les {POINTER_POLL:?})");
            let mut island = Island::new(app, window, ghost);
            loop {
                island.tick();
                thread::sleep(POINTER_POLL);
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer la surveillance du curseur de l'île : {e}");
    }
}

enum Mode {
    Rest,
    Drag(Drag),
    Spring(Spring),
}

struct Drag {
    /// Point de prise au départ : curseur − coin de la fenêtre, en px CSS (reste juste si l'échelle change).
    grab: (f64, f64),
    /// Centre de la goutte dans la fenêtre (px CSS) : la prise y glisse au début (`geometry::eased_grab`).
    blob: (f64, f64),
    /// Début du glisser (s, repère de `secs`).
    started: f64,
    samples: VecDeque<Sample>,
    along: f64,
    depth: f64,
    /// Écrans au début du glisser (ils ne changent pas pendant un geste).
    monitors: Vec<Monitor>,
    /// Place visée montrée par l'aperçu : (indice de l'écran, bord).
    aimed: Option<(usize, IslandEdge)>,
    /// Autre place visée depuis peu, et depuis quand (s) : montrée si elle le reste AIM_SETTLE_SECS.
    pending: Option<((usize, IslandEdge), f64)>,
}

struct Spring {
    pos: (f64, f64),
    vel: (f64, f64),
    target: WindowRect,
    unit_scale: f64,
    started: Instant,
    last: Instant,
    /// Lâcher d'un glisser : la goutte garde sa forme pendant le vol, `end` est émis à l'arrivée
    /// (`geometry::landing`) pour qu'elle reprenne la forme du bord en se posant, pas avant.
    land: bool,
}

struct Island {
    app: AppHandle,
    window: WebviewWindow<Wry>,
    ghost: Option<WebviewWindow<Wry>>,
    space: IslandSpace,
    /// Cadre de la fenêtre au repos (zones cliquables), `None` avant le premier placement.
    frame: Option<WindowFrame>,
    /// Coin de la fenêtre, tel que placé par ce thread.
    pos: (f64, f64),
    mode: Mode,
    last: PointerDecision,
    until_place: u32,
    /// Profondeur de la forme au dernier glisser (px CSS) : garde la forme en place quand la fenêtre
    /// change de taille.
    depth: f64,
    ghost_rect: Option<WindowRect>,
    ghost_visible: bool,
    clock: Instant,
}

impl Island {
    fn new(app: AppHandle, window: WebviewWindow<Wry>, ghost: Option<WebviewWindow<Wry>>) -> Self {
        Self {
            app,
            window,
            ghost,
            space: platform::island_space(),
            frame: None,
            pos: (0.0, 0.0),
            mode: Mode::Rest,
            // La fenêtre est créée en ignorant la souris.
            last: PointerDecision::default(),
            until_place: 0,
            depth: DEFAULT_DEPTH,
            ghost_rect: None,
            ghost_visible: false,
            clock: Instant::now(),
        }
    }

    fn secs(&self, now: Instant) -> f64 {
        now.duration_since(self.clock).as_secs_f64()
    }

    fn tick(&mut self) {
        let now = Instant::now();
        let cursor = platform::cursor_state();
        if PLACE_REQUESTED.swap(false, Ordering::Relaxed) {
            self.until_place = self.until_place.min(PLACE_SOON_TICKS);
        }
        let request = DRAG_REQUEST
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(request) = request {
            self.start_drag(request, cursor, now);
        }
        // Pendant un glisser, la demande attend le relâchement.
        if !matches!(self.mode, Mode::Drag(_)) && TOP_REQUESTED.swap(false, Ordering::Relaxed) {
            self.go_top(now);
        }

        let decision = match std::mem::replace(&mut self.mode, Mode::Rest) {
            Mode::Rest => self.rest_tick(cursor),
            Mode::Drag(drag) => self.drag_tick(drag, cursor, now),
            Mode::Spring(spring) => {
                self.spring_tick(spring, now);
                PointerDecision::default()
            }
        };
        self.apply_decision(decision);
    }

    fn apply_decision(&mut self, decision: PointerDecision) {
        if decision.capture != self.last.capture {
            if decision.capture && !decision.inside && !matches!(self.mode, Mode::Drag(_)) {
                // Autre cas où l'on capte hors des formes : bouton enfoncé dans la marge (glisser-déposer).
                log::debug!("île : souris captée dans la marge (glisser-déposer en cours ?)");
            }
            if let Err(e) = self.window.set_ignore_cursor_events(!decision.capture) {
                log::warn!("clics de l'île : {e}");
            }
        }
        if decision.inside != self.last.inside {
            let payload = IslandPointer {
                inside: decision.inside,
            };
            if let Err(e) = self
                .app
                .emit_to(WINDOW_PROMPT, EVENT_ISLAND_POINTER, payload)
            {
                log::warn!("émission de {EVENT_ISLAND_POINTER} impossible : {e}");
            }
        }
        self.last = decision;
    }

    // -----------------------------------------------------------------------
    // Repos
    // -----------------------------------------------------------------------

    fn rest_tick(&mut self, cursor: Option<CursorState>) -> PointerDecision {
        if PROMPT_RESCALED.swap(false, Ordering::Relaxed) {
            // Windows vient de recalculer la taille de la fenêtre pour la nouvelle échelle : remettre la bonne.
            self.until_place = self.until_place.min(2);
        }
        if self.until_place == 0 {
            self.until_place = PLACE_EVERY_TICKS;
            match place(&self.app, &self.window, self.space) {
                Ok((frame, changed)) => {
                    self.frame = Some(frame);
                    self.pos = (f64::from(frame.x), f64::from(frame.y));
                    if changed {
                        // Laisser le système appliquer, puis revérifier (échelle de l'écran d'arrivée).
                        self.until_place = PLACE_SOON_TICKS;
                    }
                }
                Err(e) => log::debug!("placement de l'île : {e}"),
            }
        }
        self.until_place = self.until_place.saturating_sub(1);

        match self.frame {
            // Masquée : rien à capter.
            _ if is_hidden() => PointerDecision::default(),
            Some(frame) => {
                let state = self.app.state::<DesktopState>();
                let hits = state.island_hits();
                decide(&hits, frame, cursor)
            }
            None => PointerDecision::default(),
        }
    }

    // -----------------------------------------------------------------------
    // Glisser
    // -----------------------------------------------------------------------

    fn start_drag(&mut self, request: DragRequest, cursor: Option<CursorState>, now: Instant) {
        if is_hidden() || matches!(self.mode, Mode::Drag(_)) || self.frame.is_none() {
            log::debug!("île : glisser ignoré (masquée, déjà en cours ou pas encore placée)");
            return;
        }
        let Some(cursor) = cursor.filter(|c| c.primary_down) else {
            log::debug!("île : bouton relâché avant le début du glisser");
            return;
        };
        let monitors = match placement::monitors(
            &self.app,
            self.space,
            AROUND_NOTCH.load(Ordering::Relaxed),
        ) {
            Ok(monitors) if !monitors.is_empty() => monitors,
            Ok(_) => {
                log::warn!("île : aucun écran détecté, glisser ignoré");
                return;
            }
            Err(e) => {
                log::warn!("île : écrans illisibles, glisser ignoré : {e}");
                return;
            }
        };
        let scale = window_unit_scale(self.space);
        let point = (f64::from(cursor.x), f64::from(cursor.y));
        let grab = (
            (point.0 - self.pos.0) / scale,
            (point.1 - self.pos.1) / scale,
        );
        // Pendant le glisser, l'île devient une goutte (front) : au lâcher, c'est son centre qui est gardé.
        self.depth = geometry::DRAG_BLOB;
        let edge = place_state().current.edge;
        let (window_w, window_h) = if edge.is_vertical() {
            geometry::VERTICAL_SIZE
        } else {
            geometry::HORIZONTAL_SIZE
        };
        let blob = geometry::shape_center(edge, window_w, window_h, geometry::DRAG_BLOB);
        let started = self.secs(now);
        let mut samples = VecDeque::new();
        samples.push_back(Sample {
            t: started,
            x: point.0,
            y: point.1,
        });
        self.mode = Mode::Drag(Drag {
            grab,
            blob,
            started,
            samples,
            along: request.along,
            depth: request.depth,
            monitors,
            aimed: None,
            pending: None,
        });
        emit_drag(&self.app, IslandDragPhase::Start);
        log::info!(
            "île : glisser commencé (forme {:.0} × {:.0} px CSS)",
            request.along,
            request.depth
        );
    }

    /// Place visée si l'île était lâchée maintenant : milieu de bord le plus proche du point projeté, en
    /// gardant `current` (la place montrée par l'aperçu) tant qu'aucune n'est nettement plus proche.
    fn aim(
        monitors: &[Monitor],
        point: (f64, f64),
        velocity: (f64, f64),
        scale: f64,
        current: Option<(usize, IslandEdge)>,
    ) -> Option<(usize, IslandEdge)> {
        let screens: Vec<Screen> = monitors.iter().map(|m| m.screen).collect();
        let projected = geometry::project(
            point,
            velocity,
            geometry::MAX_THROW_SPEED * scale,
            geometry::PROJECTION_SECS,
        );
        geometry::sticky_place(&screens, projected, current)
    }

    fn drag_tick(
        &mut self,
        mut drag: Drag,
        cursor: Option<CursorState>,
        now: Instant,
    ) -> PointerDecision {
        let t = self.secs(now);
        let Some(cursor) = cursor else {
            // Curseur illisible (session verrouillée) : lâchée sur place, sans élan.
            let point = drag.samples.back().map_or(self.pos, |s| (s.x, s.y));
            self.release(drag, point, (0.0, 0.0), now);
            return PointerDecision::default();
        };
        let point = (f64::from(cursor.x), f64::from(cursor.y));
        drag.samples.push_back(Sample {
            t,
            x: point.0,
            y: point.1,
        });
        while drag.samples.front().is_some_and(|s| t - s.t > SAMPLES_KEPT) {
            drag.samples.pop_front();
        }
        let velocity =
            geometry::velocity(drag.samples.make_contiguous(), geometry::VELOCITY_WINDOW);
        if !cursor.primary_down {
            self.release(drag, point, velocity, now);
            return PointerDecision::default();
        }

        let scale = window_unit_scale(self.space);
        let grab = geometry::eased_grab(drag.grab, drag.blob, t - drag.started);
        let next = (
            (point.0 - grab.0 * scale).round(),
            (point.1 - grab.1 * scale).round(),
        );
        if next != self.pos {
            if let Err(e) =
                placement::set_position(&self.window, self.space, next.0 as i32, next.1 as i32)
            {
                log::debug!("île : déplacement impossible : {e}");
            }
            self.pos = next;
        }

        let aimed = Self::aim(&drag.monitors, point, velocity, scale, drag.aimed);
        if aimed == drag.aimed {
            drag.pending = None;
        } else if let Some(candidate) = aimed {
            // Première place : tout de suite ; ensuite, seulement si elle reste visée un instant.
            let settled = match drag.pending {
                Some((pending, since)) if pending == candidate => {
                    t - since >= geometry::AIM_SETTLE_SECS
                }
                _ => {
                    drag.pending = Some((candidate, t));
                    false
                }
            };
            if drag.aimed.is_none() || settled {
                self.show_ghost(
                    &drag.monitors[candidate.0],
                    candidate.1,
                    drag.along,
                    drag.depth,
                );
                drag.aimed = Some(candidate);
                drag.pending = None;
            }
        }
        if GHOST_RESCALED.swap(false, Ordering::Relaxed) {
            self.reapply_ghost();
        }
        self.mode = Mode::Drag(drag);
        // La fenêtre suit le curseur : elle capte la souris, aucun clic ne passe dessous.
        PointerDecision {
            inside: false,
            capture: true,
        }
    }

    fn release(&mut self, drag: Drag, point: (f64, f64), velocity: (f64, f64), now: Instant) {
        let scale = window_unit_scale(self.space);
        // Même place que l'aperçu, sauf si le lancer vise nettement ailleurs.
        let target = Self::aim(&drag.monitors, point, velocity, scale, drag.aimed);
        self.hide_ghost();
        let Some((index, edge)) = target else {
            emit_drag(&self.app, IslandDragPhase::End);
            self.until_place = 0;
            return;
        };
        let throw = geometry::clamp_speed(velocity, geometry::MAX_THROW_SPEED * scale);
        let monitor = &drag.monitors[index];
        log::info!(
            "île lâchée : bord {} de l'écran {} (élan {:.0} unités/s)",
            edge.as_str(),
            monitor.id.name.as_deref().unwrap_or("sans nom"),
            throw.0.hypot(throw.1)
        );
        let saved = SavedPlacement {
            edge,
            screen: Some(monitor.id.clone()),
        };
        self.move_to(monitor.screen, edge, saved, throw, now);
        if let Mode::Spring(spring) = &mut self.mode {
            spring.land = true;
        }
    }

    // -----------------------------------------------------------------------
    // Aperçu
    // -----------------------------------------------------------------------

    fn show_ghost(&mut self, monitor: &Monitor, edge: IslandEdge, along: f64, depth: f64) {
        let Some(ghost) = &self.ghost else {
            return;
        };
        let rect = geometry::window_rect(&monitor.screen, edge);
        if let Err(e) = placement::apply_rect(ghost, self.space, rect) {
            log::debug!("aperçu de l'île : placement impossible : {e}");
        }
        self.ghost_rect = Some(rect);
        let payload = IslandGhost {
            edge,
            notch: geometry::uses_notch(&monitor.screen, edge),
            along,
            depth,
        };
        if let Err(e) = self
            .app
            .emit_to(WINDOW_ISLAND_GHOST, EVENT_ISLAND_GHOST, Some(payload))
        {
            log::warn!("émission de {EVENT_ISLAND_GHOST} impossible : {e}");
        }
        if !self.ghost_visible {
            // Jamais activable (créée ainsi) : montrée sans voler le focus.
            match ghost.show() {
                Ok(()) => self.ghost_visible = true,
                Err(e) => log::warn!("impossible d'afficher l'aperçu de l'île : {e}"),
            }
        }
    }

    /// L'échelle de l'aperçu a changé (autre écran) : Windows a recalculé sa taille, remettre la bonne.
    fn reapply_ghost(&self) {
        if let (Some(ghost), Some(rect)) = (&self.ghost, self.ghost_rect) {
            if let Err(e) = placement::apply_rect(ghost, self.space, rect) {
                log::debug!("aperçu de l'île : placement impossible : {e}");
            }
        }
    }

    fn hide_ghost(&mut self) {
        self.ghost_rect = None;
        let Some(ghost) = &self.ghost else {
            return;
        };
        if let Err(e) =
            self.app
                .emit_to(WINDOW_ISLAND_GHOST, EVENT_ISLAND_GHOST, None::<IslandGhost>)
        {
            log::warn!("émission de {EVENT_ISLAND_GHOST} impossible : {e}");
        }
        if self.ghost_visible {
            if let Err(e) = ghost.hide() {
                log::warn!("impossible de cacher l'aperçu de l'île : {e}");
            }
            self.ghost_visible = false;
        }
    }

    // -----------------------------------------------------------------------
    // Ressort
    // -----------------------------------------------------------------------

    /// « Replacer l'île en haut » : en haut de l'écran principal (mémorisé sans écran précis).
    fn go_top(&mut self, now: Instant) {
        let monitors = match placement::monitors(
            &self.app,
            self.space,
            AROUND_NOTCH.load(Ordering::Relaxed),
        ) {
            Ok(monitors) => monitors,
            Err(e) => {
                log::warn!("île : écrans illisibles, replacement en haut impossible : {e}");
                return;
            }
        };
        let Some(index) = placement::primary_index(&monitors) else {
            log::warn!("île : aucun écran détecté, replacement en haut impossible");
            return;
        };
        log::info!("île replacée en haut de l'écran principal (menu du soleil)");
        let velocity = match &self.mode {
            Mode::Spring(spring) => spring.vel,
            _ => (0.0, 0.0),
        };
        if self.frame.is_none() {
            // Pas encore placée : pas d'animation, le placement s'en charge.
            placement::save(&self.app, &SavedPlacement::TOP_OF_PRIMARY);
            place_state().saved = SavedPlacement::TOP_OF_PRIMARY;
            self.until_place = 0;
            return;
        }
        self.move_to(
            monitors[index].screen,
            IslandEdge::Top,
            SavedPlacement::TOP_OF_PRIMARY,
            velocity,
            now,
        );
    }

    /// Nouvelle place : mémorisée, `island-placement` émis (même si elle n'a pas changé), fenêtre
    /// redimensionnée pour le bord visé, puis ressort jusqu'à sa position.
    fn move_to(
        &mut self,
        screen: Screen,
        edge: IslandEdge,
        saved: SavedPlacement,
        velocity: (f64, f64),
        now: Instant,
    ) {
        let shown = IslandPlacement {
            edge,
            notch: geometry::uses_notch(&screen, edge),
        };
        placement::save(&self.app, &saved);
        let previous = {
            let mut state = place_state();
            state.saved = saved;
            std::mem::replace(&mut state.current, shown)
        };
        emit_placement(&self.app, shown);

        let target = geometry::window_rect(&screen, edge);
        // Départ : la forme garde son centre pendant que la fenêtre change de taille (le front fait la
        // transition de la forme avec son propre ressort).
        let scale_now = window_unit_scale(self.space);
        let (old_w, old_h) = geometry::window_size(previous.edge, scale_now);
        let old_center = geometry::shape_center(
            previous.edge,
            f64::from(old_w),
            f64::from(old_h),
            self.depth * scale_now,
        );
        let new_center = geometry::shape_center(
            edge,
            f64::from(target.width),
            f64::from(target.height),
            self.depth * screen.unit_scale,
        );
        let start = (
            (self.pos.0 + old_center.0 - new_center.0).round(),
            (self.pos.1 + old_center.1 - new_center.1).round(),
        );
        if let Err(e) = placement::set_size(&self.window, self.space, target.width, target.height) {
            log::warn!("île : redimensionnement impossible : {e}");
        }
        if start != self.pos {
            if let Err(e) =
                placement::set_position(&self.window, self.space, start.0 as i32, start.1 as i32)
            {
                log::debug!("île : déplacement impossible : {e}");
            }
        }
        self.pos = start;
        PROMPT_RESCALED.store(false, Ordering::Relaxed);
        self.mode = Mode::Spring(Spring {
            pos: start,
            vel: velocity,
            target,
            unit_scale: screen.unit_scale,
            started: now,
            last: now,
            land: false,
        });
    }

    fn spring_tick(&mut self, mut spring: Spring, now: Instant) {
        let dt = now.duration_since(spring.last).as_secs_f64();
        spring.last = now;
        let (tx, ty) = (f64::from(spring.target.x), f64::from(spring.target.y));
        let (px, vx) = geometry::spring_step(spring.pos.0, spring.vel.0, tx, dt);
        let (py, vy) = geometry::spring_step(spring.pos.1, spring.vel.1, ty, dt);
        spring.pos = (px, py);
        spring.vel = (vx, vy);
        if PROMPT_RESCALED.swap(false, Ordering::Relaxed) {
            // Changement d'écran en vol (Windows a recalculé la taille) : remettre celle du bord visé.
            let WindowRect { width, height, .. } = spring.target;
            if let Err(e) = placement::set_size(&self.window, self.space, width, height) {
                log::debug!("île : redimensionnement impossible : {e}");
            }
        }

        let (pos_eps, vel_eps) = (
            SETTLE_POS_CSS * spring.unit_scale,
            SETTLE_VEL_CSS * spring.unit_scale,
        );
        let settled = geometry::spring_settled(px, vx, tx, pos_eps, vel_eps)
            && geometry::spring_settled(py, vy, ty, pos_eps, vel_eps);
        let timed_out = now.duration_since(spring.started).as_secs_f64() > SPRING_MAX_SECS;
        if spring.land
            && (settled
                || timed_out
                || geometry::landing((px, py), (tx, ty), spring.unit_scale))
        {
            // La goutte arrive : le front lui rend la forme du bord pendant les derniers pixels.
            spring.land = false;
            emit_drag(&self.app, IslandDragPhase::End);
        }
        if settled || timed_out {
            // Position et taille finales exactes.
            if let Err(e) = placement::apply_rect(&self.window, self.space, spring.target) {
                log::warn!("île : placement final impossible : {e}");
            }
            self.pos = (tx, ty);
            self.frame = Some(WindowFrame {
                x: spring.target.x,
                y: spring.target.y,
                scale: spring.unit_scale,
            });
            // Vérification complète peu après (échelle de l'écran d'arrivée appliquée par le système).
            self.until_place = PLACE_SOON_TICKS;
            log::info!(
                "île posée en ({}, {}){}",
                spring.target.x,
                spring.target.y,
                if timed_out {
                    " (ressort écourté)"
                } else {
                    ""
                }
            );
            return;
        }
        let next = (px.round(), py.round());
        if next != self.pos {
            if let Err(e) =
                placement::set_position(&self.window, self.space, next.0 as i32, next.1 as i32)
            {
                log::debug!("île : déplacement impossible : {e}");
            }
            self.pos = next;
        }
        self.mode = Mode::Spring(spring);
    }
}
