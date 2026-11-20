//! macOS — titres des onglets affichés par un navigateur, pour reconnaître le service d'un appel fait
//! dans le navigateur (Meet, Discord dans Arc…).
//!
//! Sans autorisation, macOS ne donne pas le titre des fenêtres des autres apps. On demande donc au
//! navigateur, par AppleScript (JXA via `osascript`), le titre de l'onglet actif de chaque fenêtre.
//! macOS demande une fois à l'utilisateur d'autoriser Sordulo OS à « contrôler » ce navigateur (en dev,
//! la demande est faite au nom du terminal qui a lancé l'app). Refusé : on n'insiste pas pendant 10 min,
//! et la détection repose sur le son joué par le navigateur (service non reconnu).
//!
//! Appelé seulement quand un navigateur tient le micro, à chaque tour (1 s) de la boucle : la lecture est
//! faite en arrière-plan et mise en cache, l'appel ne bloque jamais (le premier tour ne trouve rien, les
//! suivants si). Firefox n'expose pas ses onglets : rien.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::call_apps;

/// Âge maximal des titres en cache avant une nouvelle lecture.
const REFRESH_AFTER: Duration = Duration::from_secs(2);
/// Délai maximal d'`osascript` (une demande d'autorisation affichée le bloque).
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30);
/// Pause après un refus d'autorisation ou une erreur.
const BACKOFF_AFTER_DENIAL: Duration = Duration::from_secs(600);
const BACKOFF_AFTER_ERROR: Duration = Duration::from_secs(10);

/// JXA : titres des onglets actifs de chaque fenêtre (`argv[0]` = bundle id, `argv[1]` = « safari » ou non).
/// Ne lance jamais le navigateur s'il est fermé.
const SCRIPT: &str = r#"function run(argv) {
  const app = Application(argv[0]);
  if (!app.running()) return "[]";
  const out = [];
  for (const w of app.windows()) {
    try { out.push(argv[1] === "safari" ? w.currentTab().name() : w.activeTab().title()); } catch (e) {}
  }
  return JSON.stringify(out);
}"#;

#[derive(Default)]
struct Entry {
    titles: Vec<String>,
    fetched: Option<Instant>,
    in_flight: bool,
    paused_until: Option<Instant>,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Titres connus pour le navigateur `browser` (nom court, voir `call_apps::short_name`) ; relance une
/// lecture en arrière-plan s'ils sont trop vieux.
pub fn browser_page_titles(browser: &str) -> Vec<String> {
    let Some(bundle_id) = call_apps::browser_bundle_id(browser) else {
        return Vec::new();
    };
    let Ok(mut cache) = cache().lock() else {
        return Vec::new();
    };
    let entry = cache.entry(browser.to_owned()).or_default();
    let now = Instant::now();
    let stale = entry.fetched.is_none_or(|at| now.duration_since(at) >= REFRESH_AFTER);
    let paused = entry.paused_until.is_some_and(|until| now < until);
    if stale && !paused && !entry.in_flight {
        entry.in_flight = true;
        let browser = browser.to_owned();
        let spawned = thread::Builder::new()
            .name("browser-titles".into())
            .spawn(move || refresh(&browser, bundle_id));
        if let Err(e) = spawned {
            entry.in_flight = false;
            log::debug!("lecture des onglets impossible : {e}");
        }
    }
    entry.titles.clone()
}

fn refresh(browser: &str, bundle_id: &str) {
    let result = read_titles(bundle_id, browser == "safari");
    let Ok(mut cache) = cache().lock() else {
        return;
    };
    let entry = cache.entry(browser.to_owned()).or_default();
    entry.in_flight = false;
    entry.fetched = Some(Instant::now());
    match result {
        Ok(titles) => {
            entry.titles = titles;
            entry.paused_until = None;
        }
        Err(e) => {
            entry.titles.clear();
            let denied = e.contains("-1743");
            entry.paused_until = Some(
                Instant::now()
                    + if denied {
                        BACKOFF_AFTER_DENIAL
                    } else {
                        BACKOFF_AFTER_ERROR
                    },
            );
            if denied {
                log::info!(
                    "onglets de {browser} : autorisation refusée (Réglages > Confidentialité > Automatisation)"
                );
            } else {
                log::debug!("onglets de {browser} : {e}");
            }
        }
    }
}

fn read_titles(bundle_id: &str, safari: bool) -> Result<Vec<String>, String> {
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", SCRIPT, bundle_id])
        .arg(if safari { "safari" } else { "chromium" })
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("osascript : {e}"))?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < SCRIPT_TIMEOUT => {
                thread::sleep(Duration::from_millis(50))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("osascript : délai dépassé".into());
            }
            Err(e) => return Err(format!("osascript : {e}")),
        }
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }
    if !status.success() {
        return Err(stderr.trim().to_owned());
    }
    let mut titles: Vec<String> =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("réponse illisible : {e}"))?;
    titles.retain(|t| !t.trim().is_empty());
    titles.dedup();
    Ok(titles)
}
