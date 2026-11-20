//! Retour du lien de connexion par email vers l'app bureau.
//!
//! Le front demande à Supabase de rediriger vers `sordulo://auth`. Windows lance alors l'exécutable
//! avec l'URL en argument : soit au démarrage (app fermée), soit dans un second lancement que le plugin
//! single-instance renvoie à l'instance ouverte. macOS envoie l'URL à l'app (lancée ou déjà ouverte) par
//! un événement « ouvrir l'URL » (`RunEvent::Opened`, voir `lib.rs` et `from_opened`) ; le schéma est
//! déclaré dans `Info.plist` (CFBundleURLTypes), donc seulement pour l'app empaquetée (.app), pas en dev. L'URL est gardée dans l'état ; la fenêtre principale
//! est prévenue par `desktop://auth-callback` et la lit une seule fois avec `take_auth_callback`.

use tauri::{AppHandle, Emitter, Manager};

use crate::events::{EVENT_AUTH_CALLBACK, URL_SCHEME, WINDOW_MAIN};
use crate::platform;
use crate::state::DesktopState;
use crate::windows_mgmt;

/// Associe `sordulo://` à cet exécutable (à chaque démarrage : le chemin peut changer).
pub fn register() {
    match platform::register_url_scheme(URL_SCHEME) {
        Ok(()) => log::info!("schéma {URL_SCHEME}:// associé à l'app"),
        Err(e) => log::warn!("association du schéma {URL_SCHEME}:// impossible : {e:#}"),
    }
}

/// Premier argument de la ligne de commande qui est un lien `sordulo://`.
pub fn find_in_args<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let prefix = format!("{URL_SCHEME}://");
    args.iter()
        .map(|a| a.as_ref().trim().trim_matches('"'))
        .find(|a| a.len() > prefix.len() && a[..prefix.len()].eq_ignore_ascii_case(&prefix))
        .map(str::to_owned)
}

/// Premier lien `sordulo://` parmi les URL ouvertes par macOS.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn from_opened(urls: &[tauri::Url]) -> Option<String> {
    let urls: Vec<&str> = urls.iter().map(tauri::Url::as_str).collect();
    find_in_args(&urls)
}

/// Garde l'URL pour la fenêtre principale, la prévient, et la montre.
pub fn deliver(app: &AppHandle, url: String) {
    log::info!("lien de connexion reçu");
    app.state::<DesktopState>().shared().pending_auth_url = Some(url);
    if let Err(e) = app.emit_to(WINDOW_MAIN, EVENT_AUTH_CALLBACK, ()) {
        log::warn!("émission de {EVENT_AUTH_CALLBACK} impossible : {e}");
    }
    windows_mgmt::show_main(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_link_among_arguments() {
        let args = [
            r"C:\app\sordulo-os.exe",
            "sordulo://auth#access_token=a&refresh_token=b",
        ];
        assert_eq!(
            find_in_args(&args).as_deref(),
            Some("sordulo://auth#access_token=a&refresh_token=b")
        );
        assert_eq!(
            find_in_args(&["x.exe", "\"SORDULO://auth?code=1\""]).as_deref(),
            Some("SORDULO://auth?code=1")
        );
        assert_eq!(find_in_args(&["x.exe", "--flag", "sordulo://"]), None);
        assert_eq!(find_in_args::<&str>(&[]), None);
    }
}
