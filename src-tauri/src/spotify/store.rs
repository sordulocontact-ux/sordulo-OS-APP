//! Compte Spotify gardé sur le disque (`app_data_dir()/spotify.json`) et `SpotifyStatus` du contrat.
//!
//! Le fichier contient le Client ID, les jetons (accès + rafraîchissement), le nom du compte et Premium.
//! Accès perdu : les jetons sont retirés mais le fichier reste avec `needsReconnect` (la carte du connecteur
//! affiche « À reconnecter » même après un redémarrage). Déconnexion : le fichier est supprimé.
//! Les jetons ne sont jamais écrits dans les logs (`Debug` masqué).

use std::fmt;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Rafraîchir le jeton d'accès quand il lui reste moins de 60 s.
const REFRESH_MARGIN_MS: u64 = 60_000;

/// Jetons OAuth du compte.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Epoch Unix en ms où le jeton d'accès expire.
    pub expires_at: u64,
}

impl Tokens {
    /// Le jeton d'accès expire (ou expirera dans moins d'une minute) à l'instant `now` (ms).
    pub fn expires_soon(&self, now: u64) -> bool {
        now.saturating_add(REFRESH_MARGIN_MS) >= self.expires_at
    }
}

impl fmt::Debug for Tokens {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Tokens")
            .field("access_token", &"<masqué>")
            .field("refresh_token", &"<masqué>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// Contenu de `spotify.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    /// Client ID de l'app Spotify (nécessaire pour rafraîchir les jetons).
    pub client_id: String,
    #[serde(default)]
    pub tokens: Option<Tokens>,
    /// Nom affiché du compte Spotify.
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub premium: bool,
    /// Accès refusé par Spotify : il faut reconnecter le compte.
    #[serde(default)]
    pub needs_reconnect: bool,
}

impl Stored {
    pub fn connected(&self) -> bool {
        self.tokens.is_some()
    }

    /// Oublie les jetons après un refus de Spotify (le reste sert à afficher « À reconnecter »).
    pub fn lose_access(&mut self) {
        self.tokens = None;
        self.needs_reconnect = true;
    }
}

/// `SpotifyStatus` du contrat (`src/shared/desktop-contract.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub connected: bool,
    /// Nom affiché du compte, `null` hors connexion.
    pub account: Option<String>,
    pub premium: bool,
    pub needs_reconnect: bool,
    pub connecting: bool,
}

/// État montré au front d'après le fichier (s'il y en a un) et une connexion en attente.
pub fn status_of(stored: Option<&Stored>, connecting: bool) -> SpotifyStatus {
    let connected = stored.is_some_and(Stored::connected);
    SpotifyStatus {
        connected,
        account: stored.filter(|_| connected).and_then(|s| s.account.clone()),
        premium: connected && stored.is_some_and(|s| s.premium),
        needs_reconnect: !connected && stored.is_some_and(|s| s.needs_reconnect),
        connecting,
    }
}

/// Relit le fichier. Absent : `None` ; illisible : `None` avec un avertissement (on repart de zéro).
pub fn load(path: &Path) -> Option<Stored> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            log::warn!("Spotify : lecture de {} impossible : {e}", path.display());
            return None;
        }
    };
    match serde_json::from_str::<Stored>(&text) {
        Ok(stored) if !stored.client_id.is_empty() => Some(stored),
        Ok(_) => None,
        Err(e) => {
            log::warn!(
                "Spotify : {} illisible ({e}), compte à reconnecter",
                path.display()
            );
            None
        }
    }
}

/// Écrit le fichier (dans un fichier temporaire puis renommé : jamais à moitié écrit).
pub fn save(path: &Path, stored: &Stored) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(stored).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(&json)?;
        file.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

/// Supprime le fichier (déconnexion). Absent : rien à faire.
pub fn delete(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens() -> Tokens {
        Tokens {
            access_token: "acces-secret".into(),
            refresh_token: "rafraichissement-secret".into(),
            expires_at: 1_000_000,
        }
    }

    fn connected() -> Stored {
        Stored {
            client_id: "abc".into(),
            tokens: Some(tokens()),
            account: Some("Maël".into()),
            premium: true,
            needs_reconnect: false,
        }
    }

    #[test]
    fn expiration_avec_marge() {
        let t = tokens();
        assert!(!t.expires_soon(900_000));
        assert!(t.expires_soon(940_000));
        assert!(t.expires_soon(2_000_000));
    }

    #[test]
    fn jetons_jamais_dans_debug() {
        let text = format!("{:?}", connected());
        assert!(!text.contains("secret"), "{text}");
        assert!(text.contains("<masqué>"));
    }

    #[test]
    fn statut_selon_le_fichier() {
        let off = status_of(None, false);
        assert_eq!(
            off,
            SpotifyStatus {
                connected: false,
                account: None,
                premium: false,
                needs_reconnect: false,
                connecting: false
            }
        );
        let on = status_of(Some(&connected()), false);
        assert!(on.connected && on.premium && !on.needs_reconnect);
        assert_eq!(on.account.as_deref(), Some("Maël"));
        // Accès perdu : ni compte ni Premium, « À reconnecter ».
        let mut lost = connected();
        lost.lose_access();
        let status = status_of(Some(&lost), true);
        assert!(
            !status.connected && !status.premium && status.needs_reconnect && status.connecting
        );
        assert_eq!(status.account, None);
    }

    #[test]
    fn statut_a_la_forme_du_contrat() {
        let json = serde_json::to_value(status_of(Some(&connected()), false)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "connected": true,
                "account": "Maël",
                "premium": true,
                "needsReconnect": false,
                "connecting": false
            })
        );
    }

    #[test]
    fn fichier_ecrit_relu_supprime() {
        let dir = std::env::temp_dir().join(format!("sordulo-spotify-test-{}", std::process::id()));
        let path = dir.join("spotify.json");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(load(&path), None);
        save(&path, &connected()).unwrap();
        assert_eq!(load(&path), Some(connected()));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"clientId\"") && text.contains("\"refreshToken\""));
        // Ancien fichier sans les champs optionnels : relu quand même.
        std::fs::write(&path, r#"{ "clientId": "abc" }"#).unwrap();
        let bare = load(&path).unwrap();
        assert!(!bare.connected() && !bare.needs_reconnect);
        // Fichier abîmé : ignoré.
        std::fs::write(&path, "pas du json").unwrap();
        assert_eq!(load(&path), None);
        delete(&path).unwrap();
        delete(&path).unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
