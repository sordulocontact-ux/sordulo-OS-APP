//! Appels HTTP à Spotify (client bloquant `reqwest`, TLS du système, https seulement).
//!
//! Jamais depuis un thread async de Tauri : le client bloquant y panique. Les appels passent par le thread
//! de lecture de `spotify/mod.rs` ou par `spawn_blocking` (commandes). Les jetons partent dans les en-têtes
//! ou le corps, jamais dans l'URL, et ne sont jamais écrits dans les logs ni dans les erreurs.
//!
//! Le classement des réponses en erreurs (`classify`) est pur et testé plus bas.

use std::fmt;
use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};

use super::pkce::{form_body, REDIRECT_URI};
use super::player::{self, Profile};
use super::store::Tokens;

const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API: &str = "https://api.spotify.com/v1";
const TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Taille maximale d'une pochette téléchargée.
const ARTWORK_MAX_BYTES: usize = 10 * 1024 * 1024;
/// 429 sans `Retry-After` : attente par défaut ; bornes de l'attente demandée.
const DEFAULT_RETRY_SECS: u64 = 5;
const MAX_RETRY_SECS: u64 = 600;

/// Erreur d'un appel à Spotify, message en français (sans jeton).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// Réseau, délai, TLS.
    Network(String),
    /// 429 : attendre avant de recommencer.
    RateLimited(Duration),
    /// 401 : jeton d'accès refusé (on rafraîchit puis on réessaie une fois).
    Unauthorized,
    /// Accès retiré (`invalid_grant`, 401 après rafraîchissement) : reconnecter le compte.
    Revoked,
    /// Aucun compte connecté.
    NotConnected,
    /// Commande refusée : Spotify Premium nécessaire (ou appareil qui refuse).
    PremiumRequired,
    /// Commande sans appareil Spotify actif.
    NoActiveDevice,
    /// Autre statut HTTP.
    Status(u16, String),
    /// Réponse illisible.
    Invalid(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network(e) => write!(f, "Spotify injoignable ({e})"),
            Self::RateLimited(d) => {
                write!(
                    f,
                    "trop de demandes à Spotify, nouvel essai dans {} s",
                    d.as_secs()
                )
            }
            Self::Unauthorized => write!(f, "jeton Spotify refusé"),
            Self::Revoked => write!(f, "accès à Spotify perdu, reconnecte le compte"),
            Self::NotConnected => write!(f, "aucun compte Spotify connecté"),
            Self::PremiumRequired => write!(f, "commande réservée à Spotify Premium"),
            Self::NoActiveDevice => write!(f, "aucun appareil Spotify actif"),
            Self::Status(code, message) if message.is_empty() => {
                write!(f, "Spotify a répondu {code}")
            }
            Self::Status(code, message) => write!(f, "Spotify a répondu {code} : {message}"),
            Self::Invalid(e) => write!(f, "{e}"),
        }
    }
}

/// Réponse brute : statut, `Retry-After` (s), corps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: String,
}

/// Point d'appel, pour classer les erreurs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    /// `POST /api/token` (échange du code, rafraîchissement).
    Token,
    /// Lecture (`/v1/me`, `/v1/me/player`).
    Read,
    /// Commande du lecteur.
    Command,
}

/// Erreur correspondant à une réponse non réussie (pur).
pub fn classify(reply: &Reply, endpoint: Endpoint) -> ApiError {
    let status = reply.status;
    if status == 429 {
        let secs = reply
            .retry_after
            .unwrap_or(DEFAULT_RETRY_SECS)
            .clamp(1, MAX_RETRY_SECS);
        return ApiError::RateLimited(Duration::from_secs(secs));
    }
    if endpoint == Endpoint::Token {
        return match player::oauth_error(&reply.body).as_deref() {
            Some("invalid_grant") => ApiError::Revoked,
            Some(code) => ApiError::Status(status, code.to_owned()),
            None => ApiError::Status(status, String::new()),
        };
    }
    let (message, reason) = player::api_error(&reply.body);
    match (status, endpoint) {
        (401, _) => ApiError::Unauthorized,
        (403, Endpoint::Command) => ApiError::PremiumRequired,
        (403, _) if reason.as_deref() == Some("PREMIUM_REQUIRED") => ApiError::PremiumRequired,
        (404, Endpoint::Command) => ApiError::NoActiveDevice,
        _ => ApiError::Status(status, message.unwrap_or_default()),
    }
}

/// Client HTTP partagé : https seulement (redirections comprises), délais bornés.
pub fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("SorduloOS/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("client HTTP indisponible : {e}"))
}

fn send(request: RequestBuilder) -> Result<Reply, ApiError> {
    let response = request
        .send()
        .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    let body = response
        .text()
        .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
    Ok(Reply {
        status,
        retry_after,
        body,
    })
}

fn checked(reply: Reply, endpoint: Endpoint) -> Result<Reply, ApiError> {
    if (200..300).contains(&reply.status) {
        Ok(reply)
    } else {
        Err(classify(&reply, endpoint))
    }
}

fn token_request(client: &Client, form: &[(&str, &str)]) -> Result<String, ApiError> {
    let request = client
        .post(TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form_body(form));
    Ok(checked(send(request)?, Endpoint::Token)?.body)
}

/// Échange le code d'autorisation contre les jetons (PKCE : `code_verifier`, pas de secret).
pub fn exchange_code(
    client: &Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    now: u64,
) -> Result<Tokens, ApiError> {
    let body = token_request(
        client,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ],
    )?;
    player::parse_tokens(&body, now, None).map_err(ApiError::Invalid)
}

/// Nouveau jeton d'accès (Spotify peut aussi renouveler le jeton de rafraîchissement).
pub fn refresh(
    client: &Client,
    client_id: &str,
    refresh_token: &str,
    now: u64,
) -> Result<Tokens, ApiError> {
    let body = token_request(
        client,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ],
    )?;
    player::parse_tokens(&body, now, Some(refresh_token)).map_err(ApiError::Invalid)
}

fn authorized(request: RequestBuilder, access_token: &str) -> RequestBuilder {
    request.header(AUTHORIZATION, format!("Bearer {access_token}"))
}

/// Compte connecté : nom affiché et Premium.
pub fn profile(client: &Client, access_token: &str) -> Result<Profile, ApiError> {
    let reply = send(authorized(client.get(format!("{API}/me")), access_token))?;
    let reply = checked(reply, Endpoint::Read)?;
    player::parse_profile(&reply.body).map_err(ApiError::Invalid)
}

/// Corps de `GET /v1/me/player` (morceaux et épisodes), `None` si rien ne joue (204).
pub fn player(client: &Client, access_token: &str) -> Result<Option<String>, ApiError> {
    let request = client.get(format!("{API}/me/player?additional_types=episode"));
    let reply = checked(send(authorized(request, access_token))?, Endpoint::Read)?;
    Ok((reply.status != 204 && !reply.body.trim().is_empty()).then_some(reply.body))
}

/// Commande envoyée à l'appareil Spotify actif.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerCommand {
    Previous,
    Next,
    Pause,
    Play,
}

impl PlayerCommand {
    /// Méthode et chemin (sous `/v1`).
    pub fn route(self) -> (&'static str, &'static str) {
        match self {
            Self::Previous => ("POST", "/me/player/previous"),
            Self::Next => ("POST", "/me/player/next"),
            Self::Pause => ("PUT", "/me/player/pause"),
            Self::Play => ("PUT", "/me/player/play"),
        }
    }
}

pub fn player_command(
    client: &Client,
    access_token: &str,
    command: PlayerCommand,
) -> Result<(), ApiError> {
    let (method, path) = command.route();
    let url = format!("{API}{path}");
    let request = match method {
        "PUT" => client.put(url),
        _ => client.post(url),
    };
    // Corps vide explicite : Spotify refuse parfois un POST sans longueur (411).
    let request = authorized(request, access_token).body("");
    checked(send(request)?, Endpoint::Command).map(|_| ())
}

/// Octets de la pochette (URL https vérifiée par l'appelant, sans jeton), `None` si vide ou trop grosse.
pub fn download_artwork(client: &Client, url: &str) -> Result<Option<Vec<u8>>, ApiError> {
    if !player::valid_artwork_url(url) {
        return Ok(None);
    }
    let response = client
        .get(url)
        .send()
        .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(ApiError::Status(status, String::new()));
    }
    if response
        .content_length()
        .is_some_and(|len| len > ARTWORK_MAX_BYTES as u64)
    {
        return Ok(None);
    }
    let bytes = response
        .bytes()
        .map_err(|e| ApiError::Network(e.without_url().to_string()))?;
    Ok((!bytes.is_empty() && bytes.len() <= ARTWORK_MAX_BYTES).then(|| bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(status: u16, body: &str) -> Reply {
        Reply {
            status,
            retry_after: None,
            body: body.into(),
        }
    }

    #[test]
    fn trop_de_demandes() {
        let mut r = reply(429, "");
        assert_eq!(
            classify(&r, Endpoint::Read),
            ApiError::RateLimited(Duration::from_secs(5))
        );
        r.retry_after = Some(30);
        assert_eq!(
            classify(&r, Endpoint::Read),
            ApiError::RateLimited(Duration::from_secs(30))
        );
        r.retry_after = Some(0);
        assert_eq!(
            classify(&r, Endpoint::Command),
            ApiError::RateLimited(Duration::from_secs(1))
        );
        r.retry_after = Some(86_400);
        assert_eq!(
            classify(&r, Endpoint::Token),
            ApiError::RateLimited(Duration::from_secs(600))
        );
    }

    #[test]
    fn jetons_refuses() {
        assert_eq!(
            classify(&reply(400, r#"{"error":"invalid_grant"}"#), Endpoint::Token),
            ApiError::Revoked
        );
        assert_eq!(
            classify(
                &reply(400, r#"{"error":"invalid_client"}"#),
                Endpoint::Token
            ),
            ApiError::Status(400, "invalid_client".into())
        );
        assert_eq!(
            classify(&reply(503, "<html>"), Endpoint::Token),
            ApiError::Status(503, String::new())
        );
        assert_eq!(
            classify(&reply(401, ""), Endpoint::Read),
            ApiError::Unauthorized
        );
        assert_eq!(
            classify(&reply(401, ""), Endpoint::Command),
            ApiError::Unauthorized
        );
    }

    #[test]
    fn commandes_refusees() {
        let premium =
            r#"{"error":{"status":403,"message":"Premium required","reason":"PREMIUM_REQUIRED"}}"#;
        assert_eq!(
            classify(&reply(403, premium), Endpoint::Command),
            ApiError::PremiumRequired
        );
        assert_eq!(
            classify(&reply(403, premium), Endpoint::Read),
            ApiError::PremiumRequired
        );
        assert_eq!(
            classify(
                &reply(403, r#"{"error":{"status":403,"message":"Forbidden"}}"#),
                Endpoint::Read
            ),
            ApiError::Status(403, "Forbidden".into())
        );
        assert_eq!(
            classify(&reply(404, ""), Endpoint::Command),
            ApiError::NoActiveDevice
        );
        assert_eq!(
            classify(&reply(502, ""), Endpoint::Read),
            ApiError::Status(502, String::new())
        );
    }

    #[test]
    fn routes_des_commandes() {
        assert_eq!(
            PlayerCommand::Previous.route(),
            ("POST", "/me/player/previous")
        );
        assert_eq!(PlayerCommand::Next.route(), ("POST", "/me/player/next"));
        assert_eq!(PlayerCommand::Pause.route(), ("PUT", "/me/player/pause"));
        assert_eq!(PlayerCommand::Play.route(), ("PUT", "/me/player/play"));
    }

    #[test]
    fn messages_en_francais_sans_jeton() {
        assert_eq!(
            ApiError::Status(500, String::new()).to_string(),
            "Spotify a répondu 500"
        );
        assert_eq!(
            ApiError::RateLimited(Duration::from_secs(7)).to_string(),
            "trop de demandes à Spotify, nouvel essai dans 7 s"
        );
    }

    /// Diagnostic réseau (TLS du système, classement des erreurs) avec un faux jeton, sans compte :
    /// `cargo test spotify_joignable -- --ignored --nocapture` (dans `src-tauri/`).
    #[test]
    #[ignore]
    fn spotify_joignable() {
        let client = client().unwrap();
        assert_eq!(profile(&client, "faux-jeton"), Err(ApiError::Unauthorized));
        let refused = refresh(&client, "00000000000000000000000000000000", "faux", 0);
        println!("rafraîchissement refusé : {refused:?}");
        assert!(refused.is_err());
    }

    /// Le client se construit (TLS du système disponible), hors de tout runtime async.
    #[test]
    fn client_https() {
        assert!(client().is_ok());
    }
}
