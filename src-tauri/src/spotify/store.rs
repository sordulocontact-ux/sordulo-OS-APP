//! Compte Spotify utilisé par cet ordinateur, en mémoire seulement, et `SpotifyStatus` du contrat.
//!
//! La connexion appartient au compte Sordulo OS (table `spotify_connections`, migration 0009), pas à
//! l'ordinateur : le front lit la ligne du compte et l'envoie à Rust (`spotify_set_connection`). Rust garde
//! le Client ID, le jeton de rafraîchissement et le jeton d'accès (1 h) en mémoire ; rien n'est écrit sur
//! le disque. L'ancien fichier `spotify.json` (jetons gardés sur l'ordinateur) est supprimé au démarrage.
//!
//! Rotation : quand Spotify renvoie un nouveau jeton de rafraîchissement, Rust le prend tout de suite et le
//! signale au front ([`TokenChange`]), qui l'enregistre sur le compte. Tant que le front renvoie l'ancien
//! (pas encore enregistré), Rust garde le nouveau et répète la rotation ([`merge`]).
//! Refus de Spotify (`invalid_grant`) : Rust arrête d'utiliser ce jeton et le signale au front, qui relit la
//! ligne (un autre ordinateur a pu faire tourner le jeton) avant de déclarer l'accès perdu.
//!
//! Les jetons ne sont jamais écrits dans les logs (`Debug` masqué). Tout ce fichier est pur et testé.

use std::fmt;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::pkce::valid_client_id;

/// Rafraîchir le jeton d'accès quand il lui reste moins de 60 s.
const REFRESH_MARGIN_MS: u64 = 60_000;
/// Bornes de la ligne du compte (mêmes contrôles que la table).
const MAX_REFRESH_TOKEN_LEN: usize = 2048;
const MAX_ACCOUNT_CHARS: usize = 200;

/// Jetons OAuth renvoyés par Spotify (échange du code, rafraîchissement).
#[derive(Clone, PartialEq, Eq)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Epoch Unix en ms où le jeton d'accès expire.
    pub expires_at: u64,
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

/// Jeton d'accès en mémoire.
#[derive(Clone, PartialEq, Eq)]
pub struct Access {
    pub token: String,
    /// Epoch Unix en ms où il expire.
    pub expires_at: u64,
}

impl Access {
    /// Expire (ou expirera dans moins d'une minute) à l'instant `now` (ms).
    pub fn expires_soon(&self, now: u64) -> bool {
        now.saturating_add(REFRESH_MARGIN_MS) >= self.expires_at
    }
}

impl From<&Tokens> for Access {
    fn from(tokens: &Tokens) -> Self {
        Self {
            token: tokens.access_token.clone(),
            expires_at: tokens.expires_at,
        }
    }
}

impl fmt::Debug for Access {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Access")
            .field("token", &"<masqué>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// `SpotifyConnection` du contrat : ligne du compte envoyée par le front (`spotify_set_connection`).
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub client_id: String,
    pub refresh_token: String,
    #[serde(default)]
    pub account: Option<String>,
    #[serde(default)]
    pub premium: bool,
}

impl fmt::Debug for Connection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Connection")
            .field("client_id", &self.client_id)
            .field("refresh_token", &"<masqué>")
            .field("account", &self.account)
            .field("premium", &self.premium)
            .finish()
    }
}

impl Connection {
    /// Mêmes contrôles que la table (le front lit sa propre ligne, mais rien n'est pris sans vérifier).
    pub fn validate(&self) -> Result<(), String> {
        if !valid_client_id(&self.client_id) {
            return Err("Client ID Spotify invalide.".into());
        }
        let token = &self.refresh_token;
        if token.trim().is_empty()
            || token.len() > MAX_REFRESH_TOKEN_LEN
            || token.chars().any(char::is_control)
        {
            return Err("Jeton Spotify invalide : reconnecte le compte.".into());
        }
        if self
            .account
            .as_ref()
            .is_some_and(|a| a.chars().count() > MAX_ACCOUNT_CHARS)
        {
            return Err("Nom du compte Spotify trop long.".into());
        }
        Ok(())
    }
}

/// `SpotifyTokenChange` du contrat (événement `desktop://spotify-token`, fenêtre de l'île).
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenChange {
    /// Jeton que la ligne du compte contient encore (remplacé seulement s'il y est toujours).
    pub previous_refresh_token: String,
    /// Nouveau jeton à enregistrer ; `None` : Spotify a refusé le jeton, relire la ligne.
    pub refresh_token: Option<String>,
}

impl fmt::Debug for TokenChange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenChange")
            .field("previous_refresh_token", &"<masqué>")
            .field("refresh_token", &self.refresh_token.as_ref().map(|_| "<masqué>"))
            .finish()
    }
}

/// `SpotifyAuthorization` du contrat : résultat de `spotify_connect`, que le front enregistre sur le compte.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub refresh_token: String,
    pub account: String,
    pub premium: bool,
}

impl fmt::Debug for Authorization {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Authorization")
            .field("refresh_token", &"<masqué>")
            .field("account", &self.account)
            .field("premium", &self.premium)
            .finish()
    }
}

/// Compte utilisé par cet ordinateur.
#[derive(Clone, PartialEq, Eq)]
pub struct Account {
    /// Client ID, jeton de rafraîchissement courant, nom affiché, Premium.
    pub connection: Connection,
    pub access: Option<Access>,
    /// Jeton que la ligne du compte contient encore après une rotation pas encore enregistrée.
    pub saved_token: Option<String>,
    /// Spotify a refusé le jeton : plus d'appel en attendant que le front relise la ligne.
    pub refused: bool,
}

impl fmt::Debug for Account {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Account")
            .field("connection", &self.connection)
            .field("access", &self.access)
            .field("saved_token", &self.saved_token.as_ref().map(|_| "<masqué>"))
            .field("refused", &self.refused)
            .finish()
    }
}

impl Account {
    /// Compte reçu du front ; `authorized` : jetons de la connexion qui vient d'être faite (jeton d'accès
    /// repris s'il va avec ce jeton de rafraîchissement).
    pub fn new(connection: Connection, authorized: Option<&Tokens>) -> Self {
        let access = authorized
            .filter(|t| t.refresh_token == connection.refresh_token)
            .map(Access::from);
        Self {
            connection,
            access,
            saved_token: None,
            refused: false,
        }
    }

    /// Jeton de rafraîchissement que la ligne du compte contient (le courant s'il est enregistré).
    fn token_in_database(&self) -> &str {
        self.saved_token
            .as_deref()
            .unwrap_or(&self.connection.refresh_token)
    }

    /// Nouveaux jetons après un rafraîchissement. Jeton de rafraîchissement changé : la rotation à
    /// enregistrer sur le compte.
    pub fn rotate(&mut self, fresh: &Tokens) -> Option<TokenChange> {
        self.access = Some(Access::from(fresh));
        if fresh.refresh_token == self.connection.refresh_token {
            return None;
        }
        let previous = self.token_in_database().to_owned();
        self.saved_token = Some(previous.clone());
        self.connection.refresh_token = fresh.refresh_token.clone();
        Some(TokenChange {
            previous_refresh_token: previous,
            refresh_token: Some(fresh.refresh_token.clone()),
        })
    }

    /// Spotify refuse le jeton : on arrête de l'utiliser et le front relit la ligne.
    pub fn refuse(&mut self) -> TokenChange {
        self.refused = true;
        self.access = None;
        TokenChange {
            previous_refresh_token: self.token_in_database().to_owned(),
            refresh_token: None,
        }
    }

    /// Ce que le front doit (re)faire pour ce compte : rotation pas enregistrée ou refus.
    fn pending_change(&self) -> Option<TokenChange> {
        let previous = self.saved_token.clone()?;
        Some(TokenChange {
            previous_refresh_token: previous,
            refresh_token: (!self.refused).then(|| self.connection.refresh_token.clone()),
        })
    }
}

/// Résultat de [`merge`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Merged {
    pub account: Option<Account>,
    /// Le compte (ou son jeton) a changé : lecture à reprendre de zéro, profil à relire.
    pub replaced: bool,
    /// Changement de jeton à signaler (de nouveau) au front.
    pub resend: Option<TokenChange>,
}

/// Applique la ligne du compte envoyée par le front (`None` : pas de compte utilisable, ou déconnexion de
/// Sordulo OS) au compte courant.
///
/// - Même Client ID et même jeton : on garde tout (accès, refus) ; la rotation est enregistrée. Le nom et
///   Premium restent ceux relus chez Spotify par cet ordinateur (le front les reporte sur le compte).
/// - La ligne contient encore le jeton d'avant notre rotation : on garde le nôtre et on renvoie la rotation.
/// - Autre jeton ou autre Client ID (connexion, rotation par un autre ordinateur) : on repart de la ligne.
pub fn merge(current: Option<&Account>, incoming: Option<Connection>, authorized: Option<&Tokens>) -> Merged {
    let Some(incoming) = incoming else {
        return Merged {
            account: None,
            replaced: current.is_some(),
            resend: None,
        };
    };
    if let Some(account) = current.filter(|a| a.connection.client_id == incoming.client_id) {
        if account.connection.refresh_token == incoming.refresh_token {
            let mut kept = account.clone();
            kept.saved_token = None;
            return Merged {
                account: Some(kept),
                replaced: false,
                resend: None,
            };
        }
        if account.saved_token.as_deref() == Some(incoming.refresh_token.as_str()) {
            return Merged {
                account: Some(account.clone()),
                replaced: false,
                resend: account.pending_change(),
            };
        }
    }
    Merged {
        account: Some(Account::new(incoming, authorized)),
        replaced: true,
        resend: None,
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

/// État montré au front d'après le compte courant et une connexion en attente dans le navigateur.
pub fn status_of(account: Option<&Account>, connecting: bool) -> SpotifyStatus {
    let usable = account.filter(|a| !a.refused);
    SpotifyStatus {
        connected: usable.is_some(),
        account: usable.and_then(|a| a.connection.account.clone()),
        premium: usable.is_some_and(|a| a.connection.premium),
        needs_reconnect: account.is_some_and(|a| a.refused),
        connecting,
    }
}

/// Supprime l'ancien fichier des jetons (`spotify.json`, avant la connexion par compte). Vrai s'il existait.
pub fn remove_legacy_file(path: &Path) -> std::io::Result<bool> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(token: &str) -> Connection {
        Connection {
            client_id: "abc".into(),
            refresh_token: token.into(),
            account: Some("Maël".into()),
            premium: true,
        }
    }

    fn tokens(refresh: &str) -> Tokens {
        Tokens {
            access_token: "acces-secret".into(),
            refresh_token: refresh.into(),
            expires_at: 1_000_000,
        }
    }

    #[test]
    fn expiration_avec_marge() {
        let a = Access::from(&tokens("r"));
        assert!(!a.expires_soon(900_000));
        assert!(a.expires_soon(940_000));
        assert!(a.expires_soon(2_000_000));
    }

    #[test]
    fn jetons_jamais_dans_debug() {
        let mut account = Account::new(connection("rafraichissement-secret"), Some(&tokens("rafraichissement-secret")));
        let change = account.rotate(&Tokens {
            refresh_token: "nouveau-secret".into(),
            ..tokens("x")
        });
        let auth = Authorization {
            refresh_token: "auth-secret".into(),
            account: "Maël".into(),
            premium: true,
        };
        let text = format!("{account:?} {change:?} {auth:?} {:?}", tokens("t-secret"));
        assert!(!text.contains("secret"), "{text}");
        assert!(text.contains("<masqué>"));
    }

    #[test]
    fn connexion_verifiee() {
        assert!(connection("r").validate().is_ok());
        for bad in [
            Connection { client_id: "a b".into(), ..connection("r") },
            Connection { client_id: String::new(), ..connection("r") },
            connection(""),
            connection("   "),
            connection("a\nb"),
            connection(&"x".repeat(2049)),
            Connection { account: Some("x".repeat(201)), ..connection("r") },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
        assert!(connection(&"x".repeat(2048)).validate().is_ok());
    }

    #[test]
    fn connexion_du_contrat() {
        let c: Connection = serde_json::from_value(serde_json::json!({
            "clientId": "abc", "refreshToken": "r", "account": null, "premium": false
        }))
        .unwrap();
        assert_eq!(c.account, None);
        let c: Connection =
            serde_json::from_value(serde_json::json!({ "clientId": "abc", "refreshToken": "r" })).unwrap();
        assert!(!c.premium);
    }

    #[test]
    fn acces_repris_de_la_connexion_qui_vient_d_etre_faite() {
        let a = Account::new(connection("r1"), Some(&tokens("r1")));
        assert_eq!(a.access.as_ref().map(|x| x.token.as_str()), Some("acces-secret"));
        assert!(Account::new(connection("r1"), Some(&tokens("autre"))).access.is_none());
        assert!(Account::new(connection("r1"), None).access.is_none());
    }

    #[test]
    fn rotation_puis_enregistrement() {
        let mut a = Account::new(connection("r1"), None);
        // Même jeton de rafraîchissement : rien à enregistrer.
        assert_eq!(a.rotate(&tokens("r1")), None);
        assert!(a.access.is_some());
        let change = a.rotate(&tokens("r2")).unwrap();
        assert_eq!(change.previous_refresh_token, "r1");
        assert_eq!(change.refresh_token.as_deref(), Some("r2"));
        assert_eq!(a.connection.refresh_token, "r2");
        // Deuxième rotation avant l'enregistrement : la ligne contient toujours r1.
        let change = a.rotate(&tokens("r3")).unwrap();
        assert_eq!(change.previous_refresh_token, "r1");
        assert_eq!(change.refresh_token.as_deref(), Some("r3"));

        // Le front renvoie encore r1 : on garde r3 et on répète la rotation.
        let m = merge(Some(&a), Some(connection("r1")), None);
        assert!(!m.replaced);
        assert_eq!(m.account.as_ref().unwrap().connection.refresh_token, "r3");
        assert_eq!(m.resend, Some(change));
        // r3 enregistré : rotation acquittée, accès gardé.
        let m = merge(Some(&a), Some(connection("r3")), None);
        assert!(!m.replaced && m.resend.is_none());
        let kept = m.account.unwrap();
        assert_eq!(kept.saved_token, None);
        assert!(kept.access.is_some());
    }

    #[test]
    fn refus_signale_le_jeton_de_la_ligne() {
        let mut a = Account::new(connection("r1"), Some(&tokens("r1")));
        let change = a.refuse();
        assert_eq!(change.previous_refresh_token, "r1");
        assert_eq!(change.refresh_token, None);
        assert!(a.refused && a.access.is_none());
        // Refus après une rotation pas encore enregistrée : la ligne contient r1.
        let mut b = Account::new(connection("r1"), None);
        b.rotate(&tokens("r2"));
        assert_eq!(b.refuse().previous_refresh_token, "r1");
        // Le front renvoie r1 : le refus est répété.
        let m = merge(Some(&b), Some(connection("r1")), None);
        assert_eq!(m.resend.unwrap().refresh_token, None);
    }

    #[test]
    fn meme_jeton_garde_le_refus_et_le_profil_relu() {
        let mut a = Account::new(connection("r1"), None);
        a.connection.premium = false;
        a.connection.account = Some("Relu chez Spotify".into());
        a.refuse();
        let m = merge(Some(&a), Some(connection("r1")), None);
        let kept = m.account.unwrap();
        assert!(kept.refused && !m.replaced);
        assert_eq!(kept.connection.account.as_deref(), Some("Relu chez Spotify"));
        assert!(!kept.connection.premium);
    }

    #[test]
    fn autre_jeton_ou_autre_client_id_remplace() {
        let mut a = Account::new(connection("r1"), None);
        a.refuse();
        // Un autre ordinateur a fait tourner le jeton : on repart de la ligne, refus levé.
        let m = merge(Some(&a), Some(connection("r9")), None);
        assert!(m.replaced);
        let b = m.account.unwrap();
        assert!(!b.refused && b.connection.refresh_token == "r9");
        // Autre Client ID avec le même jeton (impossible en pratique) : remplacé aussi.
        let other = Connection { client_id: "xyz".into(), ..connection("r9") };
        assert!(merge(Some(&b), Some(other), None).replaced);
        // Nouvelle connexion : jeton d'accès repris.
        let m = merge(None, Some(connection("r5")), Some(&tokens("r5")));
        assert!(m.replaced && m.account.unwrap().access.is_some());
    }

    #[test]
    fn plus_de_compte() {
        let a = Account::new(connection("r1"), None);
        let m = merge(Some(&a), None, None);
        assert!(m.account.is_none() && m.replaced);
        assert!(!merge(None, None, None).replaced);
    }

    #[test]
    fn statut_selon_le_compte() {
        assert_eq!(
            status_of(None, false),
            SpotifyStatus {
                connected: false,
                account: None,
                premium: false,
                needs_reconnect: false,
                connecting: false
            }
        );
        let mut a = Account::new(connection("r1"), None);
        let on = status_of(Some(&a), false);
        assert!(on.connected && on.premium && !on.needs_reconnect);
        assert_eq!(on.account.as_deref(), Some("Maël"));
        a.refuse();
        let status = status_of(Some(&a), true);
        assert!(!status.connected && !status.premium && status.needs_reconnect && status.connecting);
        assert_eq!(status.account, None);
    }

    #[test]
    fn formes_du_contrat() {
        let json = serde_json::to_value(status_of(Some(&Account::new(connection("r"), None)), false)).unwrap();
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
        let change = TokenChange {
            previous_refresh_token: "a".into(),
            refresh_token: None,
        };
        assert_eq!(
            serde_json::to_value(change).unwrap(),
            serde_json::json!({ "previousRefreshToken": "a", "refreshToken": null })
        );
        let auth = Authorization {
            refresh_token: "r".into(),
            account: "Maël".into(),
            premium: false,
        };
        assert_eq!(
            serde_json::to_value(auth).unwrap(),
            serde_json::json!({ "refreshToken": "r", "account": "Maël", "premium": false })
        );
    }

    #[test]
    fn ancien_fichier_supprime() {
        let dir = std::env::temp_dir().join(format!("sordulo-spotify-test-{}", std::process::id()));
        let path = dir.join("spotify.json");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!remove_legacy_file(&path).unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"{ "clientId": "abc" }"#).unwrap();
        assert!(remove_legacy_file(&path).unwrap());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
