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
            let mut sound_hits: u32 = 0;
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
                            Some(PromptReason::MicActive) => {
                                pending = true;
                                sound_hits = 0;
                            }
                            Some(reason) => windows_mgmt::show_prompt(&app, reason, false),
                            None => {}
                        }
                        if !active {
                            pending = false;
                        }
                        if pending {
                            if !still_promptable(&app) {
                                pending = false;
                            } else {
                                let signal = call_signal(&app);
                                if confirm_call(signal, &mut sound_hits) {
                                    log::info!("appel détecté ({signal:?})");
                                    pending = false;
                                    windows_mgmt::show_prompt(&app, PromptReason::MicActive, false);
                                }
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

/// Mesures avec du son audible (à des secondes différentes) avant de proposer pour un navigateur.
const SOUND_HITS_NEEDED: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallSignal {
    None,
    /// Une app d'appel dédiée utilise le micro.
    Dedicated,
    /// Un navigateur au micro, avec un signe d'appel (voir `call_apps`).
    Browser(call_apps::BrowserSignal),
}

fn call_signal(app: &AppHandle) -> CallSignal {
    let apps = app.state::<DesktopState>().shared().mic.apps.clone();
    if apps
        .iter()
        .any(|a| call_apps::classify(&a.id) == Some(call_apps::CallApp::Dedicated))
    {
        return CallSignal::Dedicated;
    }
    let playing = platform::processes_playing_audio();
    let titles = platform::visible_window_titles();
    let signals: Vec<_> = apps
        .iter()
        .filter_map(|a| call_apps::browser_signal(&a.id, &playing, &titles))
        .collect();
    if signals.contains(&call_apps::BrowserSignal::Title) {
        CallSignal::Browser(call_apps::BrowserSignal::Title)
    } else if signals.contains(&call_apps::BrowserSignal::Sound) {
        CallSignal::Browser(call_apps::BrowserSignal::Sound)
    } else {
        log::debug!("navigateur au micro sans signe d'appel");
        CallSignal::None
    }
}

/// Faut-il proposer maintenant ? Compte les mesures avec du son dans `sound_hits`.
fn confirm_call(signal: CallSignal, sound_hits: &mut u32) -> bool {
    match signal {
        CallSignal::Dedicated | CallSignal::Browser(call_apps::BrowserSignal::Title) => true,
        CallSignal::Browser(call_apps::BrowserSignal::Sound) => {
            *sound_hits += 1;
            *sound_hits >= SOUND_HITS_NEEDED
        }
        CallSignal::None => false,
    }
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

    #[test]
    fn browser_sound_needs_two_hits() {
        use call_apps::BrowserSignal::{Sound, Title};
        let mut hits = 0;
        // « Bip » de début de dictée : une seule mesure avec du son.
        assert!(!confirm_call(CallSignal::Browser(Sound), &mut hits));
        assert!(!confirm_call(CallSignal::None, &mut hits));
        // Voix des participants : une deuxième mesure.
        assert!(confirm_call(CallSignal::Browser(Sound), &mut hits));
        let mut hits = 0;
        assert!(confirm_call(CallSignal::Dedicated, &mut hits));
        assert!(confirm_call(CallSignal::Browser(Title), &mut hits));
    }
}
