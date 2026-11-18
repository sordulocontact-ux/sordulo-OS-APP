//! Seuls les appels déclenchent « Transcrire cet appel ? ».
//!
//! - App d'appel dédiée (Zoom, Teams, Slack, Discord, WhatsApp…) : proposition immédiate.
//! - Navigateur : le registre dit seulement qu'il utilise le micro, pas quel onglet. On propose s'il
//!   joue du son audible sur au moins deux mesures (le son des participants, pas le « bip » de début de
//!   dictée) ou si le titre d'une fenêtre visible indique un appel
//!   (« Meet – abc-defg-hij »). Une dictée vocale dans Claude web ne joue rien : pas de proposition.
//! - Autres apps (Claude bureau, enregistreur…) : ignorées.
//!
//! `id` = identifiant du détecteur : clé `NonPackaged` (chemin avec `#`) ou famille de paquet sous
//! Windows, bundle id sous macOS.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallApp {
    Dedicated,
    Browser,
}

/// Apps d'appel reconnues par un mot dans leur identifiant.
const CALL_APP_WORDS: &[&str] = &[
    "zoom", "teams", "slack", "discord", "whatsapp", "webex", "skype", "signal", "telegram",
    "facetime",
];

/// Navigateurs, reconnus par leur nom exact.
const BROWSERS: &[&str] = &[
    "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "chromium", "safari",
];

/// Mots d'un titre de fenêtre qui indiquent un appel dans un navigateur.
const CALL_TITLE_WORDS: &[&str] = &[
    "meet", "teams", "zoom", "discord", "whereby", "jitsi", "webex", "slack", "whatsapp", "skype",
];

/// Nom court de l'app : exécutable sans `.exe` (clé `NonPackaged`), sinon dernier segment pointé
/// de la famille de paquet ou du bundle id (`TheBrowserCompany.Arc_xxx` → `arc`).
pub fn short_name(id: &str) -> String {
    let id = id.to_ascii_lowercase();
    if id.contains('#') {
        let exe = id.rsplit('#').next().unwrap_or_default();
        return exe.strip_suffix(".exe").unwrap_or(exe).to_owned();
    }
    let family = id.split('_').next().unwrap_or_default();
    family.rsplit('.').next().unwrap_or_default().to_owned()
}

pub fn classify(id: &str) -> Option<CallApp> {
    let lower = id.to_ascii_lowercase();
    if CALL_APP_WORDS.iter().any(|w| lower.contains(w)) {
        Some(CallApp::Dedicated)
    } else if BROWSERS.contains(&short_name(id).as_str()) {
        Some(CallApp::Browser)
    } else {
        None
    }
}

/// Le titre contient un mot d'appel entier (« Meet – … » oui, « Meeting notes » non).
pub fn is_call_title(title: &str) -> bool {
    title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| CALL_TITLE_WORDS.contains(&word))
}

/// Signe qu'un navigateur est en appel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserSignal {
    /// Une fenêtre visible a un titre d'appel : suffit seul.
    Title,
    /// Le navigateur joue du son audible : à confirmer sur plusieurs mesures (un « bip » de début de
    /// dictée ne doit pas compter).
    Sound,
}

pub fn browser_signal(
    browser_id: &str,
    playing_audio: &[String],
    titles: &[String],
) -> Option<BrowserSignal> {
    if titles.iter().any(|t| is_call_title(t)) {
        Some(BrowserSignal::Title)
    } else if playing_audio.contains(&short_name(browser_id)) {
        Some(BrowserSignal::Sound)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_apps() {
        for id in [
            "C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe",
            "MSTeams_8wekyb3d8bbwe",
            "5319275A.WhatsAppDesktop_cv1g1gvanyjgm",
            "C:#Users#me#AppData#Local#Discord#app-1.0.9#Discord.exe",
            "us.zoom.xos",
        ] {
            assert_eq!(classify(id), Some(CallApp::Dedicated), "{id}");
        }
        for id in [
            "C:#Program Files#Google#Chrome#Application#chrome.exe",
            "C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe",
            "TheBrowserCompany.Arc_ttt1ap7aakyb4",
            "com.google.Chrome",
        ] {
            assert_eq!(classify(id), Some(CallApp::Browser), "{id}");
        }
        for id in [
            "C:#Users#me#AppData#Local#AnthropicClaude#app-1.0#claude.exe",
            "C:#Users#me#.local#bin#claude.exe",
            "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe",
            "C:#tools#search.exe",
        ] {
            assert_eq!(classify(id), None, "{id}");
        }
    }

    #[test]
    fn call_titles() {
        assert!(is_call_title("Meet – abc-defg-hij - Google Chrome"));
        assert!(is_call_title("Réunion | Microsoft Teams"));
        assert!(!is_call_title("Meeting notes - Claude"));
        assert!(!is_call_title("Claude"));
        assert!(!is_call_title("Arc"));
    }

    #[test]
    fn browser_call_hints() {
        let arc = "TheBrowserCompany.Arc_ttt1ap7aakyb4";
        let none: Vec<String> = vec![];
        // Dictée dans Claude web : rien ne joue, aucun titre d'appel.
        assert_eq!(
            browser_signal(arc, &["spotify".into()], &["Arc".into()]),
            None
        );
        // Meet dans Arc : Arc joue le son des participants.
        assert_eq!(
            browser_signal(arc, &["arc".into()], &none),
            Some(BrowserSignal::Sound)
        );
        // Meet dans Chrome : titre de fenêtre.
        let chrome = "C:#Program Files#Google#Chrome#Application#chrome.exe";
        assert_eq!(
            browser_signal(chrome, &none, &["Meet – abc - Google Chrome".into()]),
            Some(BrowserSignal::Title)
        );
    }
}
