//! OAuth Google (client « Application de bureau ») : URL d'autorisation, formulaires d'échange et de
//! rafraîchissement, lecture des réponses (purs, testés plus bas), appels HTTP (client bloquant `reqwest`,
//! TLS du système, https seulement).
//!
//! Jamais depuis un thread async de Tauri : le client bloquant y panique (les commandes passent par
//! `spawn_blocking`). Jetons et secret partent dans le corps ou les en-têtes, jamais dans l'URL, et ne sont
//! jamais écrits dans les logs ni dans les erreurs.

use std::fmt;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;

use crate::oauth::pkce::form_body;

/// Page d'autorisation de Google, ouverte dans le navigateur par défaut.
pub const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
/// Chemin de la redirection sur la boucle locale (le port est choisi par le système à chaque connexion :
/// Google accepte tout port de 127.0.0.1 pour un client « Application de bureau »).
pub const CALLBACK_PATH: &str = "/callback";
/// Toujours demandés en plus du scope du service : l'adresse email du compte.
const BASE_SCOPES: &str = "openid email";
const TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Durée de vie d'un jeton d'accès sans `expires_in` (Google donne 3599 s).
const DEFAULT_EXPIRES_SECS: u64 = 3600;

/// Identifiants de l'app Google de l'agence (compilés dans l'app de bureau).
#[derive(Clone, Copy)]
pub struct Credentials {
    pub client_id: &'static str,
    pub client_secret: &'static str,
}

/// Adresse de retour pour le port ouvert par le serveur local (identique dans l'autorisation et l'échange).
pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

/// URL de la page d'autorisation : code + PKCE S256, scope du service en lecture seule + email, jeton de
/// rafraîchissement (`access_type=offline`, `prompt=consent` pour l'avoir à chaque connexion).
pub fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    service_scope: &str,
    challenge: &str,
    state: &str,
) -> String {
    let scope = format!("{BASE_SCOPES} {service_scope}");
    let query = form_body(&[
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", &scope),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("include_granted_scopes", "false"),
    ]);
    format!("{AUTHORIZE_URL}?{query}")
}

/// Formulaire d'échange du code (`redirect_uri` : la même que dans l'autorisation).
pub fn exchange_form<'a>(
    credentials: &Credentials,
    code: &'a str,
    verifier: &'a str,
    redirect_uri: &'a str,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
        ("client_id", credentials.client_id),
        ("client_secret", credentials.client_secret),
    ]
}

/// Formulaire de rafraîchissement du jeton d'accès.
pub fn refresh_form<'a>(
    credentials: &Credentials,
    refresh_token: &'a str,
) -> Vec<(&'static str, &'a str)> {
    vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", credentials.client_id),
        ("client_secret", credentials.client_secret),
    ]
}

/// Jetons renvoyés par `POST /token`.
pub struct Tokens {
    pub access_token: String,
    /// Epoch Unix en ms où le jeton d'accès expire.
    pub expires_at: u64,
    /// Seulement à l'échange du code (avec `access_type=offline`).
    pub refresh_token: Option<String>,
    /// Scopes accordés, séparés par des espaces (l'écran de Google permet d'en décocher).
    pub scope: Option<String>,
    /// Jeton OpenID (email du compte), seulement à l'échange du code.
    pub id_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

/// Lit une réponse réussie de `POST /token`.
pub fn parse_tokens(body: &str, now: u64) -> Result<Tokens, String> {
    let reply: TokenReply =
        serde_json::from_str(body).map_err(|e| format!("réponse de jetons illisible : {e}"))?;
    if reply.access_token.is_empty() {
        return Err("jeton d'accès absent".into());
    }
    let expires_in = reply.expires_in.unwrap_or(DEFAULT_EXPIRES_SECS);
    Ok(Tokens {
        access_token: reply.access_token,
        expires_at: now.saturating_add(expires_in.saturating_mul(1000)),
        refresh_token: reply.refresh_token.filter(|t| !t.is_empty()),
        scope: reply.scope,
        id_token: reply.id_token.filter(|t| !t.is_empty()),
    })
}

/// Le scope demandé figure parmi ceux accordés.
pub fn has_scope(granted: &str, scope: &str) -> bool {
    granted.split_whitespace().any(|s| s == scope)
}

/// Erreur d'un appel à Google, message en français (sans jeton ni secret).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    /// `invalid_grant` : jeton de rafraîchissement révoqué, expiré (7 jours en mode Test), mot de passe
    /// changé, ou code d'autorisation déjà utilisé.
    Refused,
    /// Identifiants de l'app refusés (`invalid_client`, `unauthorized_client`, `deleted_client`).
    Client(String),
    /// Autre statut HTTP (code d'erreur OAuth s'il y en a un).
    Status(u16, String),
    /// Réseau, délai, TLS.
    Network(String),
    /// Réponse illisible.
    Invalid(String),
}

impl fmt::Display for TokenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused => write!(f, "Google refuse l'accès, reconnecte le compte"),
            Self::Client(code) => write!(
                f,
                "identifiants Google de l'app refusés ({code}) : vérifie le client OAuth de l'agence"
            ),
            Self::Status(code, error) if error.is_empty() => write!(f, "Google a répondu {code}"),
            Self::Status(code, error) => write!(f, "Google a répondu {code} ({error})"),
            Self::Network(e) => write!(f, "Google injoignable ({e})"),
            Self::Invalid(e) => write!(f, "{e}"),
        }
    }
}

/// Code d'erreur OAuth d'une réponse (`{"error":"invalid_grant","error_description":"…"}`).
fn oauth_error(body: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Reply {
        error: String,
    }
    serde_json::from_str::<Reply>(body)
        .ok()
        .map(|r| r.error)
        .filter(|e| !e.is_empty())
}

/// Erreur correspondant à une réponse non réussie de `POST /token` (pur).
pub fn classify_token(status: u16, body: &str) -> TokenError {
    let error = oauth_error(body);
    match error.as_deref() {
        Some("invalid_grant") => TokenError::Refused,
        Some(code @ ("invalid_client" | "unauthorized_client" | "deleted_client")) => {
            TokenError::Client(code.to_owned())
        }
        Some(code) => TokenError::Status(status, crate::oauth::callback::short_code(code)),
        None => TokenError::Status(status, String::new()),
    }
}

#[derive(Deserialize)]
struct EmailClaims {
    #[serde(default)]
    email: Option<String>,
}

fn valid_email(email: Option<String>) -> Option<String> {
    email
        .map(|e| e.trim().to_owned())
        .filter(|e| e.contains('@') && e.chars().count() <= 320)
}

/// Email du compte d'après le jeton OpenID reçu de `POST /token` (en HTTPS, directement de Google :
/// pas de vérification de signature à faire, voir la doc OpenID Connect de Google).
pub fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: EmailClaims = serde_json::from_slice(&bytes).ok()?;
    valid_email(claims.email)
}

/// Email du compte d'après la réponse de `GET /v1/userinfo`.
pub fn parse_userinfo(body: &str) -> Result<String, String> {
    let claims: EmailClaims = serde_json::from_str(body)
        .map_err(|e| format!("profil Google illisible : {e}"))?;
    valid_email(claims.email).ok_or_else(|| "adresse email du compte Google absente".to_owned())
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

/// Statut et corps d'une réponse.
fn send(request: RequestBuilder) -> Result<(u16, String), TokenError> {
    let response = request
        .send()
        .map_err(|e| TokenError::Network(e.without_url().to_string()))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|e| TokenError::Network(e.without_url().to_string()))?;
    Ok((status, body))
}

fn token_request(client: &Client, form: &[(&str, &str)], now: u64) -> Result<Tokens, TokenError> {
    let request = client
        .post(TOKEN_URL)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form_body(form));
    let (status, body) = send(request)?;
    if !(200..300).contains(&status) {
        return Err(classify_token(status, &body));
    }
    parse_tokens(&body, now).map_err(TokenError::Invalid)
}

/// Échange le code d'autorisation contre les jetons.
pub fn exchange_code(
    client: &Client,
    credentials: &Credentials,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    now: u64,
) -> Result<Tokens, TokenError> {
    token_request(
        client,
        &exchange_form(credentials, code, verifier, redirect_uri),
        now,
    )
}

/// Nouveau jeton d'accès à partir du jeton de rafraîchissement.
pub fn refresh(
    client: &Client,
    credentials: &Credentials,
    refresh_token: &str,
    now: u64,
) -> Result<Tokens, TokenError> {
    token_request(client, &refresh_form(credentials, refresh_token), now)
}

/// Email du compte (repli quand la réponse n'avait pas de jeton OpenID lisible).
pub fn userinfo_email(client: &Client, access_token: &str) -> Result<String, TokenError> {
    let request = client
        .get(USERINFO_URL)
        .header(AUTHORIZATION, format!("Bearer {access_token}"));
    let (status, body) = send(request)?;
    if !(200..300).contains(&status) {
        return Err(TokenError::Status(status, String::new()));
    }
    parse_userinfo(&body).map_err(TokenError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREDENTIALS: Credentials = Credentials {
        client_id: "123-abc.apps.googleusercontent.com",
        client_secret: "GOCSPX-secret",
    };

    fn query_of(url: &str) -> Vec<(String, String)> {
        let (_, query) = url.split_once('?').unwrap();
        query
            .split('&')
            .map(|pair| {
                let (k, v) = pair.split_once('=').unwrap();
                (
                    crate::oauth::pkce::percent_decode(k).unwrap(),
                    crate::oauth::pkce::percent_decode(v).unwrap(),
                )
            })
            .collect()
    }

    fn get<'a>(pairs: &'a [(String, String)], name: &str) -> &'a str {
        pairs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
            .unwrap_or_else(|| panic!("paramètre absent : {name}"))
    }

    #[test]
    fn url_d_autorisation() {
        let redirect = redirect_uri(50123);
        assert_eq!(redirect, "http://127.0.0.1:50123/callback");
        let url = authorize_url(
            CREDENTIALS.client_id,
            &redirect,
            "https://www.googleapis.com/auth/calendar.readonly",
            "defi",
            "etat",
        );
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?client_id=123-abc.apps.googleusercontent.com&"));
        assert!(crate::platform::is_openable_url(&url));
        // Ni secret ni jeton dans l'URL.
        assert!(!url.contains("GOCSPX"));
        let pairs = query_of(&url);
        assert_eq!(get(&pairs, "client_id"), CREDENTIALS.client_id);
        assert_eq!(get(&pairs, "redirect_uri"), "http://127.0.0.1:50123/callback");
        assert_eq!(get(&pairs, "response_type"), "code");
        assert_eq!(
            get(&pairs, "scope"),
            "openid email https://www.googleapis.com/auth/calendar.readonly"
        );
        assert_eq!(get(&pairs, "code_challenge"), "defi");
        assert_eq!(get(&pairs, "code_challenge_method"), "S256");
        assert_eq!(get(&pairs, "state"), "etat");
        assert_eq!(get(&pairs, "access_type"), "offline");
        assert_eq!(get(&pairs, "prompt"), "consent");
        assert_eq!(get(&pairs, "include_granted_scopes"), "false");
        assert_eq!(pairs.len(), 10);
    }

    #[test]
    fn formulaires_d_echange_et_de_rafraichissement() {
        let form = exchange_form(&CREDENTIALS, "4/0Acode", "verif", "http://127.0.0.1:50123/callback");
        assert_eq!(
            form_body(&form),
            "grant_type=authorization_code&code=4%2F0Acode&code_verifier=verif\
             &redirect_uri=http%3A%2F%2F127.0.0.1%3A50123%2Fcallback\
             &client_id=123-abc.apps.googleusercontent.com&client_secret=GOCSPX-secret"
        );
        let form = refresh_form(&CREDENTIALS, "1//0refresh");
        assert_eq!(
            form_body(&form),
            "grant_type=refresh_token&refresh_token=1%2F%2F0refresh\
             &client_id=123-abc.apps.googleusercontent.com&client_secret=GOCSPX-secret"
        );
    }

    #[test]
    fn reponse_de_jetons() {
        let body = r#"{"access_token":"ya29.a","expires_in":3599,"refresh_token":"1//0r",
            "scope":"openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
            "token_type":"Bearer","id_token":"x.y.z"}"#;
        let tokens = parse_tokens(body, 1_000).unwrap();
        assert_eq!(tokens.access_token, "ya29.a");
        assert_eq!(tokens.expires_at, 1_000 + 3_599_000);
        assert_eq!(tokens.refresh_token.as_deref(), Some("1//0r"));
        assert_eq!(tokens.id_token.as_deref(), Some("x.y.z"));
        let scope = tokens.scope.unwrap();
        assert!(has_scope(&scope, "https://www.googleapis.com/auth/gmail.readonly"));
        assert!(!has_scope(&scope, "https://www.googleapis.com/auth/calendar.readonly"));

        // Rafraîchissement : ni jeton de rafraîchissement ni jeton OpenID.
        let tokens = parse_tokens(r#"{"access_token":"ya29.b","token_type":"Bearer"}"#, 0).unwrap();
        assert_eq!(tokens.expires_at, 3_600_000);
        assert!(tokens.refresh_token.is_none() && tokens.id_token.is_none());

        assert!(parse_tokens(r#"{"access_token":""}"#, 0).is_err());
        assert!(parse_tokens("<html>", 0).is_err());
    }

    #[test]
    fn jetons_refuses() {
        let refused = r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#;
        assert_eq!(classify_token(400, refused), TokenError::Refused);
        assert_eq!(classify_token(401, refused), TokenError::Refused);
        assert_eq!(
            classify_token(401, r#"{"error":"invalid_client","error_description":"Unauthorized"}"#),
            TokenError::Client("invalid_client".into())
        );
        assert_eq!(
            classify_token(400, r#"{"error":"invalid_request"}"#),
            TokenError::Status(400, "invalid_request".into())
        );
        assert_eq!(
            classify_token(503, "<html>"),
            TokenError::Status(503, String::new())
        );
    }

    #[test]
    fn messages_en_francais_sans_jeton() {
        assert_eq!(TokenError::Status(500, String::new()).to_string(), "Google a répondu 500");
        assert_eq!(
            TokenError::Refused.to_string(),
            "Google refuse l'accès, reconnecte le compte"
        );
    }

    #[test]
    fn email_du_compte() {
        let claims = URL_SAFE_NO_PAD.encode(r#"{"iss":"https://accounts.google.com","email":"mael@sordulo.fr","email_verified":true}"#);
        let id_token = format!("eyJhbGciOiJSUzI1NiJ9.{claims}.signature");
        assert_eq!(email_from_id_token(&id_token).as_deref(), Some("mael@sordulo.fr"));
        // Remplissage toléré.
        let padded = format!("a.{claims}==.b");
        assert_eq!(email_from_id_token(&padded).as_deref(), Some("mael@sordulo.fr"));
        assert_eq!(email_from_id_token("pas-un-jwt"), None);
        let no_email = URL_SAFE_NO_PAD.encode(r#"{"sub":"1"}"#);
        assert_eq!(email_from_id_token(&format!("a.{no_email}.b")), None);

        assert_eq!(
            parse_userinfo(r#"{"sub":"1","email":"sacha@gmail.com","email_verified":true}"#).as_deref(),
            Ok("sacha@gmail.com")
        );
        assert!(parse_userinfo(r#"{"sub":"1"}"#).is_err());
        assert!(parse_userinfo(r#"{"email":"pas une adresse"}"#).is_err());
    }

    /// Le client se construit (TLS du système disponible), hors de tout runtime async.
    #[test]
    fn client_https() {
        assert!(client().is_ok());
    }
}
