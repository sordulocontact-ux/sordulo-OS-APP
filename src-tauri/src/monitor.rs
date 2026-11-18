//! Boucle de détection du micro (toutes les 2 s) et ticker de l'enregistrement (toutes les 1 s).
//! Deux threads dédiés, lancés une fois dans `setup`.

use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::call_apps;
use crate::events::EVENT_MIC_STATE;
use crate::platform;
use crate::recording;
use crate::state::{DesktopState, MicState, PromptReason};
use crate::tray;
use crate::windows_mgmt;

const MIC_POLL: Duration = Duration::from_secs(2);
const RECORDING_TICK: Duration = Duration::from_secs(1);
/// Le micro doit rester actif ce temps avant « Transcrire cet appel ? » : une dictée vocale de quelques
/// secondes ne déclenche rien.
const MIC_ACTIVE_DELAY: Duration = Duration::from_secs(6);

/// Proposition « mic-active » en attente du délai `MIC_ACTIVE_DELAY`.
#[derive(Debug, Default)]
struct PromptDelay {
    since: Option<Instant>,
}

impl PromptDelay {
    fn arm(&mut self, now: Instant) {
        self.since = Some(now);
    }
    fn cancel(&mut self) {
        self.since = None;
    }
    /// Vrai une seule fois, quand le délai est écoulé.
    fn fire(&mut self, now: Instant) -> bool {
        match self.since {
            Some(since) if now.duration_since(since) >= MIC_ACTIVE_DELAY => {
                self.since = None;
                true
            }
            _ => false,
        }
    }
}

/// Ce que la boucle doit faire après un changement d'état du micro.
#[derive(Debug, PartialEq, Eq)]
enum Action {
    None,
    Prompt(PromptReason),
}

/// Décide de l'action et met à jour `prompt_dismissed`. Fonction pure, testée plus bas.
fn transition(was_active: bool, now_active: bool, recording: bool, dismissed: &mut bool) -> Action {
    match (was_active, now_active) {
        (false, true) if !recording && !*dismissed => Action::Prompt(PromptReason::MicActive),
        (true, false) if recording => Action::Prompt(PromptReason::MicInactive),
        (true, false) => {
            *dismissed = false;
            Action::None
        }
        _ => Action::None,
    }
}

pub fn spawn_mic_loop(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("mic-monitor".into())
        .spawn(move || {
            let monitor = platform::mic_monitor();
            log::info!("boucle de détection du micro démarrée (toutes les {MIC_POLL:?})");
            let mut ticks: u64 = 0;
            let mut delay = PromptDelay::default();
            loop {
                match monitor.active_apps() {
                    Ok(apps) => {
                        // Seules les apps d'appel comptent (pas la dictée vocale, etc.).
                        let apps = apps.into_iter().filter(|a| call_apps::is_call_app(&a.id));
                        let mic = MicState::from_apps(apps.collect());
                        let active = mic.active;
                        match on_poll(&app, mic) {
                            Some(PromptReason::MicActive) => delay.arm(Instant::now()),
                            Some(reason) => windows_mgmt::show_prompt(&app, reason, false),
                            None => {}
                        }
                        if !active {
                            delay.cancel();
                        }
                        if delay.fire(Instant::now()) && still_promptable(&app) {
                            windows_mgmt::show_prompt(&app, PromptReason::MicActive, false);
                        }
                    }
                    Err(e) => log::warn!("détection du micro : {e:#}"),
                }
                ticks += 1;
                // Signe de vie discret (~1 min), visible avec RUST_LOG=debug.
                if ticks % 30 == 1 {
                    log::debug!("boucle de détection : {ticks} passage(s)");
                }
                thread::sleep(MIC_POLL);
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer la boucle de détection : {e}");
    }
}

/// Toujours vrai au bout du délai ? (micro actif, rien en cours, proposition pas écartée entre-temps)
fn still_promptable(app: &AppHandle) -> bool {
    let state = app.state::<DesktopState>();
    let shared = state.shared();
    shared.mic.active && shared.session.is_none() && !shared.prompt_dismissed
}

/// Met à jour l'état du micro ; renvoie la proposition à faire (« mic-active » passe par le délai).
fn on_poll(app: &AppHandle, mic: MicState) -> Option<PromptReason> {
    let state = app.state::<DesktopState>();
    let action = {
        let mut shared = state.shared();
        if shared.mic == mic {
            return None;
        }
        let was_active = shared.mic.active;
        let recording = shared.session.is_some();
        let action = transition(
            was_active,
            mic.active,
            recording,
            &mut shared.prompt_dismissed,
        );
        shared.mic = mic.clone();
        action
    };

    if mic.active {
        log::info!("micro actif : {}", mic.app_names());
    } else {
        log::info!("micro inactif");
    }
    if let Err(e) = app.emit(EVENT_MIC_STATE, &mic) {
        log::warn!("émission de {EVENT_MIC_STATE} impossible : {e}");
    }
    tray::refresh(app);

    match action {
        Action::Prompt(reason) => Some(reason),
        Action::None => None,
    }
}

pub fn spawn_recording_ticker(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("recording-ticker".into())
        .spawn(move || loop {
            thread::sleep(RECORDING_TICK);
            let recording = app.state::<DesktopState>().shared().session.is_some();
            if recording {
                recording::broadcast(&app);
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer le ticker d'enregistrement : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transitions() {
        let mut dismissed = false;
        assert_eq!(
            transition(false, true, false, &mut dismissed),
            Action::Prompt(PromptReason::MicActive)
        );
        // Déjà en cours d'enregistrement : pas de proposition.
        assert_eq!(transition(false, true, true, &mut dismissed), Action::None);
        // Écartée : pas de proposition, jusqu'au passage à inactif.
        dismissed = true;
        assert_eq!(transition(false, true, false, &mut dismissed), Action::None);
        assert_eq!(transition(true, false, false, &mut dismissed), Action::None);
        assert!(!dismissed);
        // Fin d'appel pendant l'enregistrement.
        assert_eq!(
            transition(true, false, true, &mut dismissed),
            Action::Prompt(PromptReason::MicInactive)
        );
        // Changement d'apps sans changement d'activité.
        assert_eq!(transition(true, true, false, &mut dismissed), Action::None);
    }

    #[test]
    fn prompt_waits_for_the_delay() {
        let t0 = Instant::now();
        let mut delay = PromptDelay::default();
        assert!(!delay.fire(t0 + MIC_ACTIVE_DELAY));
        delay.arm(t0);
        assert!(!delay.fire(t0 + Duration::from_secs(4)));
        assert!(delay.fire(t0 + MIC_ACTIVE_DELAY));
        assert!(!delay.fire(t0 + MIC_ACTIVE_DELAY * 2), "une seule fois");
        // Dictée courte : le micro se coupe avant le délai.
        delay.arm(t0);
        delay.cancel();
        assert!(!delay.fire(t0 + MIC_ACTIVE_DELAY));
    }
}
