//! Boucle de détection du micro (toutes les 2 s) et ticker de l'enregistrement (toutes les 1 s).
//! Deux threads dédiés, lancés une fois dans `setup`.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::call_apps;
use crate::events::EVENT_MIC_STATE;
use crate::platform;
use crate::recording;
use crate::state::{DesktopState, MicState, PromptReason};
use crate::tray;
use crate::windows_mgmt;

const MIC_POLL: Duration = Duration::from_secs(1);
const RECORDING_TICK: Duration = Duration::from_secs(1);
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
            // « mic-active » en attente d'un signe d'appel (navigateur sans son ni titre d'appel pour l'instant).
            let mut pending = false;
            loop {
                match monitor.active_apps() {
                    Ok(apps) => {
                        // Seules les apps d'appel et les navigateurs comptent (pas la dictée dans Claude, etc.).
                        let apps = apps
                            .into_iter()
                            .filter(|a| call_apps::classify(&a.id).is_some());
                        let mic = MicState::from_apps(apps.collect());
                        let active = mic.active;
                        match on_poll(&app, mic) {
                            Some(PromptReason::MicActive) => pending = true,
                            Some(reason) => windows_mgmt::show_prompt(&app, reason, false),
                            None => {}
                        }
                        if !active {
                            pending = false;
                        }
                        if pending {
                            if !still_promptable(&app) {
                                pending = false;
                            } else if looks_like_call(&app) {
                                pending = false;
                                windows_mgmt::show_prompt(&app, PromptReason::MicActive, false);
                            }
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

/// Une app d'appel dédiée utilise le micro, ou un navigateur qui semble en appel (voir `call_apps`).
fn looks_like_call(app: &AppHandle) -> bool {
    let apps = app.state::<DesktopState>().shared().mic.apps.clone();
    if apps
        .iter()
        .any(|a| call_apps::classify(&a.id) == Some(call_apps::CallApp::Dedicated))
    {
        return true;
    }
    let playing = platform::processes_playing_audio();
    let titles = platform::visible_window_titles();
    let in_call = apps
        .iter()
        .any(|a| call_apps::browser_in_call(&a.id, &playing, &titles));
    if !in_call {
        log::debug!("navigateur au micro sans signe d'appel (son : {playing:?})");
    }
    in_call
}

/// Proposition toujours d'actualité ? (micro actif, rien en cours, pas écartée entre-temps)
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
}
