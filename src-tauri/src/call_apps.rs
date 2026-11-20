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

/// Service d'appel reconnu (même liste que `CallService` de `src/shared/desktop-contract.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CallService {
    Meet,
    Teams,
    Zoom,
    Discord,
    Slack,
    Whatsapp,
    Webex,
    Skype,
    Signal,
    Telegram,
    Facetime,
    Whereby,
    Jitsi,
}

impl CallService {
    /// Nom humain affiché dans l'île.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Meet => "Google Meet",
            Self::Teams => "Microsoft Teams",
            Self::Zoom => "Zoom",
            Self::Discord => "Discord",
            Self::Slack => "Slack",
            Self::Whatsapp => "WhatsApp",
            Self::Webex => "Webex",
            Self::Skype => "Skype",
            Self::Signal => "Signal",
            Self::Telegram => "Telegram",
            Self::Facetime => "FaceTime",
            Self::Whereby => "Whereby",
            Self::Jitsi => "Jitsi",
        }
    }
}

/// Mot (en minuscules) → service. Pour un identifiant d'app, le mot peut être n'importe où dans la chaîne ;
/// pour un titre de fenêtre, il doit être un mot entier (« Meeting notes » n'est pas « Meet »).
const SERVICE_WORDS: &[(&str, CallService)] = &[
    ("meet", CallService::Meet),
    ("teams", CallService::Teams),
    ("zoom", CallService::Zoom),
    ("discord", CallService::Discord),
    ("slack", CallService::Slack),
    ("whatsapp", CallService::Whatsapp),
    ("webex", CallService::Webex),
    ("skype", CallService::Skype),
    ("signal", CallService::Signal),
    ("telegram", CallService::Telegram),
    ("facetime", CallService::Facetime),
    ("whereby", CallService::Whereby),
    ("jitsi", CallService::Jitsi),
];

/// Service d'une app d'appel dédiée, d'après son identifiant. `meet` est exclu : un id contenant « meet »
/// n'est pas une app Meet (Meet vit dans un navigateur).
pub fn service_from_id(id: &str) -> Option<CallService> {
    let lower = id.to_ascii_lowercase();
    SERVICE_WORDS
        .iter()
        .filter(|(word, _)| *word != "meet" && *word != "whereby" && *word != "jitsi")
        .find(|(word, _)| lower.contains(word))
        .map(|(_, service)| *service)
}

/// Service indiqué par un titre de fenêtre (mot entier).
pub fn service_from_title(title: &str) -> Option<CallService> {
    let lower = title.to_lowercase();
    lower.split(|c: char| !c.is_alphanumeric()).find_map(|word| {
        SERVICE_WORDS
            .iter()
            .find(|(w, _)| *w == word)
            .map(|(_, service)| *service)
    })
}

/// Service reconnu pour une app qui utilise le micro : depuis son identifiant (app dédiée), ou, pour un
/// navigateur, depuis le premier titre de fenêtre visible qui en désigne un. Rien : `None`.
pub fn recognize_service(id: &str, titles: &[String]) -> Option<CallService> {
    match classify(id)? {
        CallApp::Dedicated => service_from_id(id),
        CallApp::Browser => titles.iter().find_map(|t| service_from_title(t)),
    }
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

    #[test]
    fn recognizes_services() {
        let none: Vec<String> = vec![];
        for (id, service) in [
            ("C:#Users#me#AppData#Local#Discord#app-1.0.9#Discord.exe", CallService::Discord),
            ("MSTeams_8wekyb3d8bbwe", CallService::Teams),
            ("C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe", CallService::Zoom),
            ("5319275A.WhatsAppDesktop_cv1g1gvanyjgm", CallService::Whatsapp),
            ("us.zoom.xos", CallService::Zoom),
        ] {
            assert_eq!(recognize_service(id, &none), Some(service), "{id}");
        }
        let chrome = "C:#Program Files#Google#Chrome#Application#chrome.exe";
        assert_eq!(
            recognize_service(chrome, &["Meet – abc-defg-hij - Google Chrome".into()]),
            Some(CallService::Meet)
        );
        assert_eq!(
            recognize_service(chrome, &["Claude".into(), "Réunion | Microsoft Teams".into()]),
            Some(CallService::Teams)
        );
        // Navigateur sans titre d'appel, app non reconnue : rien.
        assert_eq!(recognize_service(chrome, &["Meeting notes".into()]), None);
        assert_eq!(recognize_service(chrome, &none), None);
        assert_eq!(recognize_service("C:#tools#claude.exe", &["Meet – x".into()]), None);
    }

    #[test]
    fn service_names_and_serialization() {
        assert_eq!(CallService::Meet.display_name(), "Google Meet");
        assert_eq!(CallService::Teams.display_name(), "Microsoft Teams");
        assert_eq!(CallService::Discord.display_name(), "Discord");
        assert_eq!(serde_json::to_value(CallService::Whatsapp).unwrap(), "whatsapp");
        assert_eq!(serde_json::to_value(CallService::Facetime).unwrap(), "facetime");
    }
}
