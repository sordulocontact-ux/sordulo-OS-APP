//! Détection des applications qui utilisent le micro.
//!
//! Windows tient à jour, pour chaque application, deux horodatages QWORD sous
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone` :
//! `LastUsedTimeStart` et `LastUsedTimeStop`. Une application utilise le micro en ce moment quand
//! `LastUsedTimeStop` vaut 0 et `LastUsedTimeStart` est non nul.
//!
//! - Sous-clés directes : applications empaquetées (nom de famille du paquet, ex. `MSTeams_8wekyb3d8bbwe`).
//! - Sous-clé `NonPackaged` : exécutables classiques, nom = chemin complet avec `#` à la place de `\`
//!   (ex. `C:#Program Files#Google#Chrome#Application#chrome.exe`).

use crate::platform::{MicApp, MicMonitor};
use std::path::{Path, PathBuf};
use winreg::{RegKey, HKCU};

const CONSENT_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
const NON_PACKAGED: &str = "NonPackaged";
/// Nom de l'exécutable de Sordulo OS (cas dev : `src-tauri/target/debug/sordulo-os.exe`).
const SELF_EXE_NAME: &str = "sordulo-os.exe";

/// Détecteur de micro par le registre. Lecture seule, sans état : peut être appelé toutes les 2 s.
pub struct RegistryMicMonitor {
    /// Chemin de notre propre exécutable, au format des clés `NonPackaged` (`#`, minuscules).
    self_key: Option<String>,
    /// Même chemin, canonique : Windows note le chemin tel qu'il a été lancé, parfois au format
    /// court 8.3 (`C:#Users#ABCDEF~1#…`), qui ne se compare pas tel quel au chemin long.
    self_canonical: Option<PathBuf>,
}

impl RegistryMicMonitor {
    pub fn new() -> Self {
        let exe = std::env::current_exe().ok();
        Self {
            self_key: exe
                .as_ref()
                .map(|path| exe_path_to_key(&path.to_string_lossy())),
            self_canonical: exe.and_then(|path| std::fs::canonicalize(path).ok()),
        }
    }

    /// Comparaison par chemin canonique (formes courte/longue). Appelée seulement pour les
    /// entrées actives, donc rarement : l'accès disque reste négligeable.
    fn is_self_canonical(&self, key: &str) -> bool {
        let Some(own) = self.self_canonical.as_deref() else {
            return false;
        };
        std::fs::canonicalize(key_to_exe_path(key)).is_ok_and(|path| same_path(&path, own))
    }
}

impl Default for RegistryMicMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl MicMonitor for RegistryMicMonitor {
    fn active_apps(&self) -> anyhow::Result<Vec<MicApp>> {
        let root = match HKCU.open_subkey(CONSENT_KEY) {
            Ok(key) => key,
            Err(err) => {
                // Clé absente (Windows ancien, politique d'entreprise…) : personne n'utilise le micro.
                log::debug!("Registre du micro illisible : {err}");
                return Ok(Vec::new());
            }
        };

        let mut apps = Vec::new();

        for name in root.enum_keys().filter_map(Result::ok) {
            if name.eq_ignore_ascii_case(NON_PACKAGED) {
                continue;
            }
            if subkey_in_use(&root, &name) {
                apps.push(MicApp {
                    display_name: packaged_display_name(&name),
                    id: name,
                });
            }
        }

        if let Ok(non_packaged) = root.open_subkey(NON_PACKAGED) {
            for name in non_packaged.enum_keys().filter_map(Result::ok) {
                if is_self(&name, self.self_key.as_deref()) {
                    continue;
                }
                if subkey_in_use(&non_packaged, &name) {
                    if self.is_self_canonical(&name) {
                        continue;
                    }
                    apps.push(MicApp {
                        display_name: non_packaged_display_name(&name),
                        id: name,
                    });
                }
            }
        }

        Ok(apps)
    }
}

/// Lit les deux horodatages d'une sous-clé. Toute erreur (clé ou valeur absente, mauvais type) → `false`.
fn subkey_in_use(parent: &RegKey, name: &str) -> bool {
    let Ok(key) = parent.open_subkey(name) else {
        return false;
    };
    let start = key.get_value::<u64, _>("LastUsedTimeStart").ok();
    let stop = key.get_value::<u64, _>("LastUsedTimeStop").ok();
    is_in_use(start, stop)
}

/// Règle d'usage : `LastUsedTimeStop` = 0 et `LastUsedTimeStart` non nul. Valeur absente → pas d'usage.
pub(crate) fn is_in_use(start: Option<u64>, stop: Option<u64>) -> bool {
    matches!((start, stop), (Some(start), Some(0)) if start != 0)
}

/// Convertit un chemin d'exécutable au format des clés `NonPackaged` : `\` → `#`, minuscules.
pub(crate) fn exe_path_to_key(path: &str) -> String {
    let path = path
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| path.strip_prefix(r"\\?\").unwrap_or(path).to_string());
    path.replace(['\\', '/'], "#").to_lowercase()
}

/// Inverse de [`exe_path_to_key`] (sans la casse) : `C:#Dir#app.exe` → `C:\Dir\app.exe`.
fn key_to_exe_path(key: &str) -> PathBuf {
    PathBuf::from(key.replace('#', "\\"))
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// Dernier segment d'une clé `NonPackaged` (le nom de l'exécutable).
fn exe_name(key: &str) -> &str {
    key.rsplit('#').next().unwrap_or(key)
}

/// Vrai si la clé désigne Sordulo OS elle-même (même exécutable, ou un `sordulo-os.exe` quelconque).
pub(crate) fn is_self(key: &str, self_key: Option<&str>) -> bool {
    if self_key.is_some_and(|own| key.to_lowercase() == own) {
        return true;
    }
    exe_name(key).eq_ignore_ascii_case(SELF_EXE_NAME)
}

/// Nom affiché d'un exécutable classique : le nom du fichier (ex. `chrome.exe`).
pub(crate) fn non_packaged_display_name(key: &str) -> String {
    let name = exe_name(key);
    if name.is_empty() {
        key.to_string()
    } else {
        name.to_string()
    }
}

/// Nom affiché d'une application empaquetée.
///
/// `MSTeams_8wekyb3d8bbwe` → « Microsoft Teams » ; `Microsoft.Teams_x` → « Microsoft Teams » ;
/// `5319275A.WhatsAppDesktop_x` → « WhatsApp ». Nom inattendu → nom brut.
pub(crate) fn packaged_display_name(key: &str) -> String {
    // Nom de famille du paquet = `<Nom>_<IdÉditeur>` : on retire l'identifiant d'éditeur.
    let family = key.rsplit_once('_').map_or(key, |(name, _)| name);

    if let Some(known) = known_app_name(family) {
        return known.to_string();
    }

    let valid = !family.is_empty()
        && family
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !valid {
        return key.to_string();
    }

    let segments: Vec<&str> = family
        .split('.')
        .filter(|s| !s.is_empty())
        .enumerate()
        // Préfixe d'éditeur du Store (ex. `5319275A`) : retiré s'il reste autre chose après.
        .filter(|(i, s)| !(*i == 0 && looks_like_publisher_prefix(s)))
        .map(|(_, s)| s)
        .collect();

    if segments.is_empty() || segments.len() > 3 {
        return key.to_string();
    }
    segments.join(" ")
}

/// Préfixes d'éditeur générés par le Store : hexadécimal majuscule avec au moins un chiffre (ex. `5319275A`).
fn looks_like_publisher_prefix(segment: &str) -> bool {
    segment.len() >= 6
        && segment.chars().any(|c| c.is_ascii_digit())
        && segment
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
}

/// Quelques applications d'appel courantes dont le nom de paquet n'est pas lisible tel quel.
fn known_app_name(family: &str) -> Option<&'static str> {
    const KNOWN: &[(&str, &str)] = &[
        ("MSTeams", "Microsoft Teams"),
        ("MicrosoftTeams", "Microsoft Teams"),
        ("Microsoft.Teams", "Microsoft Teams"),
        ("Microsoft.SkypeApp", "Skype"),
        ("5319275A.WhatsAppDesktop", "WhatsApp"),
        ("Microsoft.WindowsSoundRecorder", "Enregistreur audio"),
        ("Microsoft.WindowsCamera", "Caméra"),
        ("Microsoft.OutlookForWindows", "Outlook"),
    ];
    KNOWN
        .iter()
        .find(|(id, _)| id.eq_ignore_ascii_case(family))
        .map(|(_, name)| *name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_rule() {
        assert!(is_in_use(Some(134_384_352_871_598_548), Some(0)));
        assert!(!is_in_use(
            Some(134_384_352_871_598_548),
            Some(134_384_352_939_755_411)
        ));
        assert!(!is_in_use(Some(0), Some(0)), "jamais utilisé");
        assert!(!is_in_use(None, Some(0)), "valeur illisible");
        assert!(!is_in_use(Some(1), None), "valeur illisible");
        assert!(!is_in_use(None, None));
    }

    #[test]
    fn non_packaged_names() {
        assert_eq!(
            non_packaged_display_name("C:#Program Files#Google#Chrome#Application#chrome.exe"),
            "chrome.exe"
        );
        assert_eq!(
            non_packaged_display_name("C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe"),
            "Zoom.exe"
        );
        assert_eq!(
            non_packaged_display_name("C:#Users#me#.local#bin#claude.exe.old.1794"),
            "claude.exe.old.1794"
        );
        assert_eq!(non_packaged_display_name("weird"), "weird");
        assert_eq!(non_packaged_display_name("C:#dir#"), "C:#dir#");
    }

    #[test]
    fn packaged_names() {
        assert_eq!(
            packaged_display_name("MSTeams_8wekyb3d8bbwe"),
            "Microsoft Teams"
        );
        assert_eq!(
            packaged_display_name("Microsoft.Teams_8wekyb3d8bbwe"),
            "Microsoft Teams"
        );
        assert_eq!(
            packaged_display_name("5319275A.WhatsAppDesktop_cv1g1gvanyjgm"),
            "WhatsApp"
        );
        assert_eq!(
            packaged_display_name("Microsoft.GamingApp_8wekyb3d8bbwe"),
            "Microsoft GamingApp"
        );
        assert_eq!(
            packaged_display_name("E046963F.LenovoCompanion_k1h2ywk1493x8"),
            "LenovoCompanion"
        );
        assert_eq!(
            packaged_display_name("Microsoft.MixedReality.Portal_8wekyb3d8bbwe"),
            "Microsoft MixedReality Portal"
        );
        // Trop de segments ou caractères inattendus : nom brut.
        assert_eq!(packaged_display_name("A.B.C.D_x"), "A.B.C.D_x");
        assert_eq!(packaged_display_name("Nom bizarre_x"), "Nom bizarre_x");
        assert_eq!(packaged_display_name("_x"), "_x");
    }

    #[test]
    fn exe_path_conversion() {
        assert_eq!(
            exe_path_to_key(r"C:\Program Files\Sordulo OS\sordulo-os.exe"),
            "c:#program files#sordulo os#sordulo-os.exe"
        );
        assert_eq!(
            exe_path_to_key(r"\\?\C:\Apps\Sordulo.exe"),
            "c:#apps#sordulo.exe"
        );
        assert_eq!(
            exe_path_to_key(r"\\?\UNC\server\share\app.exe"),
            "##server#share#app.exe"
        );
    }

    #[test]
    fn self_detection_with_short_path() {
        // Notre exécutable de test, désigné par son chemin canonique puis par la clé du registre.
        let monitor = RegistryMicMonitor::new();
        let exe = std::env::current_exe().unwrap();
        let key = exe.to_string_lossy().replace('\\', "#");
        assert!(monitor.is_self_canonical(&key));
        assert!(monitor.is_self_canonical(&key.to_uppercase()));
        assert!(!monitor.is_self_canonical("C:#Windows#System32#notepad.exe"));
        assert!(!monitor.is_self_canonical("C:#inexistant#app.exe"));
        assert_eq!(
            key_to_exe_path("C:#Dir#app.exe"),
            PathBuf::from(r"C:\Dir\app.exe")
        );
    }

    #[test]
    fn self_detection() {
        let own = exe_path_to_key(r"C:\Program Files\Sordulo OS\Sordulo OS.exe");
        // Même exécutable, casse différente.
        assert!(is_self(
            "C:#PROGRAM FILES#Sordulo OS#Sordulo OS.exe",
            Some(&own)
        ));
        // Cas dev : n'importe quel sordulo-os.exe.
        assert!(is_self(
            r"C:#Users#me#GitHub#sordulo-OS#src-tauri#target#debug#sordulo-os.exe",
            None
        ));
        assert!(is_self("D:#x#SORDULO-OS.EXE", Some(&own)));
        // Autres applications.
        assert!(!is_self(
            "C:#Program Files#Google#Chrome#Application#chrome.exe",
            Some(&own)
        ));
        assert!(!is_self("C:#x#sordulo-os.exe.bak", None));
    }
}
