//! Boucle de détection du micro (toutes les 2 s) et ticker de l'enregistrement (toutes les 1 s).
//! Deux threads dédiés, lancés une fois dans `setup`.

use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::call_apps;
use crate::events::{EVENT_AUDIO_LEVEL, EVENT_MIC_STATE, WINDOW_PROMPT};
use crate::platform;
use crate::recording;
use crate::state::{DesktopState, MicState, PromptReason};
use crate::tray;
use crate::windows_mgmt;

const MIC_POLL: Duration = Duration::from_secs(1);
const RECORDING_TICK: Duration = Duration::from_secs(1);
/// Période d'émission du niveau sonore vers l'île (l'onde défile toutes les ~90 ms).
const LEVEL_TICK: Duration = Duration::from_millis(90);
/// Niveau (dBFS) en dessous duquel l'onde reste à plat, et au-dessus duquel elle est au maximum.
const LEVEL_FLOOR_DB: f32 = -55.0;
const LEVEL_CEIL_DB: f32 = -12.0;
/// Constante de temps de la retombée de l'onde (l'attaque est instantanée).
const LEVEL_RELEASE_SECS: f32 = 0.15;

/// Payload de `desktop://audio-level` (voir `AudioLevel` dans desktop-contract.ts).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioLevel {
    /// 0..1, déjà mis à l'échelle pour l'affichage.
    level: f32,
    /// Epoch en ms.
    at: u64,
}

/// Niveau RMS linéaire → 0..1 pour l'affichage : -55 dBFS et moins → 0, -12 dBFS et plus → 1,
/// courbe douce (smoothstep) entre les deux. Silence (ou valeur invalide) → 0.
fn display_level(rms: f32) -> f32 {
    if !rms.is_finite() || rms <= 1e-6 {
        return 0.0;
    }
    let db = 20.0 * rms.log10();
    let t = ((db - LEVEL_FLOOR_DB) / (LEVEL_CEIL_DB - LEVEL_FLOOR_DB)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Lissage de l'onde : attaque immédiate, relâche exponentielle (~150 ms).
#[derive(Debug, Default)]
struct LevelSmoother {
    value: f32,
}

impl LevelSmoother {
    /// `target` : niveau d'affichage visé (0..1) ; `dt` : temps écoulé depuis le pas précédent.
    fn step(&mut self, target: f32, dt: Duration) -> f32 {
        let released = self.value * (-dt.as_secs_f32() / LEVEL_RELEASE_SECS).exp();
        self.value = target.max(released);
        if self.value < 0.01 {
            self.value = 0.0;
        }
        self.value
    }

    fn reset(&mut self) {
        self.value = 0.0;
    }
}

fn spawn_level_ticker(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("audio-level".into())
        .spawn(move || {
            let mut smoother = LevelSmoother::default();
            loop {
                thread::sleep(LEVEL_TICK);
                // Lecture sans verrou : rien n'est émis hors enregistrement.
                let Some(raw) = platform::recording_level() else {
                    smoother.reset();
                    continue;
                };
                let level = smoother.step(display_level(raw), LEVEL_TICK);
                let at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u64);
                if let Err(e) =
                    app.emit_to(WINDOW_PROMPT, EVENT_AUDIO_LEVEL, AudioLevel { level, at })
                {
                    log::debug!("émission de {EVENT_AUDIO_LEVEL} impossible : {e}");
                }
            }
        });
    if let Err(e) = spawned {
        log::error!("impossible de lancer le ticker du niveau sonore : {e}");
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
            // « mic-active » en attente d'un signe d'appel (navigateur sans son ni titre d'appel pour l'instant).
            let mut pending = false;
            let mut sound_hits: u32 = 0;
            loop {
                match monitor.active_apps() {
                    Ok(apps) => {
                        // Seules les apps d'appel et les navigateurs comptent (pas la dictée dans Claude, etc.).
                        let apps: Vec<_> = apps
                            .into_iter()
                            .filter(|a| call_apps::classify(&a.id).is_some())
                            .collect();
                        // Les titres des fenêtres ne servent qu'à reconnaître le service d'un navigateur.
                        let titles = if apps
                            .iter()
                            .any(|a| call_apps::classify(&a.id) == Some(call_apps::CallApp::Browser))
                        {
                            platform::visible_window_titles()
                        } else {
                            Vec::new()
                        };
                        let mic = MicState::from_apps_with_titles(apps, &titles);
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
    spawn_level_ticker(app.clone());
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
    fn display_level_scale() {
        assert_eq!(display_level(0.0), 0.0);
        assert_eq!(display_level(f32::NAN), 0.0);
        // -55 dBFS et moins : plat ; -12 dBFS et plus : plein.
        assert_eq!(display_level(10f32.powf(-55.0 / 20.0)), 0.0);
        assert_eq!(display_level(10f32.powf(-70.0 / 20.0)), 0.0);
        assert!((display_level(10f32.powf(-12.0 / 20.0)) - 1.0).abs() < 1e-5);
        assert_eq!(display_level(1.0), 1.0);
        // Milieu de la plage (-33,5 dBFS) : milieu de l'échelle, et courbe croissante.
        let mid = display_level(10f32.powf(-33.5 / 20.0));
        assert!((mid - 0.5).abs() < 0.01, "{mid}");
        let mut previous = 0.0;
        for db in (-55..=-12).map(|d| d as f32) {
            let v = display_level(10f32.powf(db / 20.0));
            assert!(v >= previous, "{db} dB : {v} < {previous}");
            previous = v;
        }
    }

    #[test]
    fn level_smoother_attacks_fast_and_releases_slowly() {
        let dt = Duration::from_millis(90);
        let mut s = LevelSmoother::default();
        assert_eq!(s.step(0.8, dt), 0.8);
        // Attaque immédiate même depuis une valeur haute vers une plus haute.
        assert_eq!(s.step(1.0, dt), 1.0);
        // Relâche : ~55 % par pas de 90 ms (constante de 150 ms), jamais en dessous de la cible.
        let after = s.step(0.0, dt);
        assert!((after - 0.549).abs() < 0.01, "{after}");
        assert_eq!(s.step(0.9, dt), 0.9);
        // Retombe complètement à zéro (seuil d'extinction) puis y reste.
        for _ in 0..20 {
            s.step(0.0, dt);
        }
        assert_eq!(s.step(0.0, dt), 0.0);
        s.step(0.5, dt);
        s.reset();
        assert_eq!(s.step(0.0, dt), 0.0);
    }

    #[test]
    fn audio_level_serializes_camel_case() {
        let json = serde_json::to_value(AudioLevel { level: 0.5, at: 42 }).unwrap();
        assert_eq!(json, serde_json::json!({ "level": 0.5, "at": 42 }));
    }

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
