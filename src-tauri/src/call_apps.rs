//! Seules les apps d'appel déclenchent « Transcrire cet appel ? » : navigateurs (Meet), Zoom, Teams,
//! Slack, Discord, WhatsApp… Les autres usages du micro (dictée vocale dans Claude, etc.) sont ignorés.
//!
//! `id` = identifiant du détecteur : clé `NonPackaged` (chemin avec `#`) ou famille de paquet sous
//! Windows, bundle id sous macOS.

/// Apps d'appel reconnues par un mot dans leur identifiant.
const CALL_APP_WORDS: &[&str] = &[
    "zoom", "teams", "slack", "discord", "whatsapp", "webex", "skype", "signal", "telegram",
    "facetime",
];

/// Navigateurs (appels Meet, Teams web…), reconnus par leur nom exact.
const BROWSERS: &[&str] = &[
    "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc", "chromium", "safari",
];

/// Nom court de l'app : exécutable sans `.exe` (clé `NonPackaged`), sinon dernier segment pointé
/// de la famille de paquet ou du bundle id (`TheBrowserCompany.Arc_xxx` → `arc`).
fn short_name(id: &str) -> String {
    let id = id.to_ascii_lowercase();
    if id.contains('#') {
        let exe = id.rsplit('#').next().unwrap_or_default();
        return exe.strip_suffix(".exe").unwrap_or(exe).to_owned();
    }
    let family = id.split('_').next().unwrap_or_default();
    family.rsplit('.').next().unwrap_or_default().to_owned()
}

pub fn is_call_app(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    CALL_APP_WORDS.iter().any(|w| lower.contains(w)) || BROWSERS.contains(&short_name(id).as_str())
}

#[cfg(test)]
mod tests {
    use super::is_call_app;

    #[test]
    fn keeps_call_apps_only() {
        for id in [
            "C:#Program Files#Google#Chrome#Application#chrome.exe",
            "C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe",
            "TheBrowserCompany.Arc_ttt1ap7aakyb4",
            "C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe",
            "MSTeams_8wekyb3d8bbwe",
            "5319275A.WhatsAppDesktop_cv1g1gvanyjgm",
            "C:#Users#me#AppData#Local#slack#app-4.41.0#slack.exe",
            "us.zoom.xos",
            "com.google.Chrome",
        ] {
            assert!(is_call_app(id), "{id} devrait déclencher");
        }
        for id in [
            "C:#Users#me#AppData#Local#AnthropicClaude#app-1.0#claude.exe",
            "C:#Users#me#.local#bin#claude.exe",
            "Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe",
            "C:#Program Files#Audacity#Audacity.exe",
            "C:#tools#search.exe",
        ] {
            assert!(!is_call_app(id), "{id} ne devrait pas déclencher");
        }
    }
}
