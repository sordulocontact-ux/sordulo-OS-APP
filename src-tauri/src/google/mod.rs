//! Connecteurs Google Agenda et Gmail : autorisation OAuth et jetons d'accès, même code pour Windows et
//! macOS (rien de propre à un système). Agenda et Gmail sont ensuite appelés par le front (CORS ouvert de
//! googleapis.com) avec le jeton d'accès donné par `google_access_token`.
//!
//! - App Google de l'agence (client « Application de bureau ») : Client ID et secret compilés dans l'app
//!   (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, lus par `build.rs` : variable d'environnement de la CI,
//!   sinon `.env.local`). Absents : `configured = false`, la connexion est refusée avec un message clair.
//!   Pour une app installée, Google ne considère pas ce secret comme confidentiel ; il n'est jamais
//!   journalisé.
//! - Connexion (`google_connect`, fenêtre principale) : PKCE S256, `state` aléatoire, serveur local sur
//!   127.0.0.1 et un port libre (`crate::oauth::callback`), page d'autorisation dans le navigateur par
//!   défaut (`platform::open_url`), 3 min au plus, annulable. Scope en lecture seule du service + email.
//!   Le résultat (jeton de rafraîchissement, email du compte) est renvoyé au front, qui l'enregistre sur le
//!   compte Sordulo OS (table `google_connections`). Une connexion par service.
//! - Jeton d'accès (`google_access_token`) : rafraîchi avec le jeton de rafraîchissement envoyé par le
//!   front, gardé en mémoire par (service, empreinte du jeton de rafraîchissement) jusqu'à 60 s avant son
//!   expiration. Refus de Google (`invalid_grant`) : `{ status: 'refused' }`, le front marque la
//!   connexion « À reconnecter ». Rien sur le disque, jamais de jeton dans les logs.
//!
//! Le client HTTP est bloquant : jamais appelé depuis un thread async (les commandes passent par
//! `spawn_blocking`). Verrous : `inner` seul, jamais tenu pendant un appel réseau ; `refresh` (un seul
//! rafraîchissement à la fois) peut prendre `inner` ensuite.

mod api;

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::events::EVENT_GOOGLE;
use crate::oauth::callback::{self, Texts};
use crate::oauth::pkce::{random_state, Pkce};
use crate::platform;
use crate::time::now_ms;

use api::{Credentials, TokenError};

/// Valeurs compilées (voir `build.rs`) ; vides ou absentes : connecteurs indisponibles.
const CLIENT_ID: Option<&str> = option_env!("GOOGLE_CLIENT_ID");
const CLIENT_SECRET: Option<&str> = option_env!("GOOGLE_CLIENT_SECRET");
/// Attente maximale de la redirection de Google.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(180);
/// Jeton d'accès rafraîchi s'il expire dans moins de ce temps.
const REFRESH_MARGIN_MS: u64 = 60_000;
/// Borne d'un jeton de rafraîchissement reçu du front.
const MAX_REFRESH_TOKEN_LEN: usize = 2048;

/// `GoogleService` du contrat : une connexion par service, chacune avec son scope en lecture seule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GoogleService {
    Calendar,
    Gmail,
}

impl GoogleService {
    /// Scope en lecture seule demandé en plus de `openid email`.
    fn scope(self) -> &'static str {
        match self {
            Self::Calendar => "https://www.googleapis.com/auth/calendar.readonly",
            Self::Gmail => "https://www.googleapis.com/auth/gmail.readonly",
        }
    }

    /// Nom montré à l'utilisateur.
    fn name(self) -> &'static str {
        match self {
            Self::Calendar => "Google Agenda",
            Self::Gmail => "Gmail",
        }
    }

    /// Textes de la page du navigateur et des erreurs.
    fn texts(self) -> Texts {
        const DONE: &str = "Tu peux fermer cet onglet.";
        match self {
            Self::Calendar => Texts {
                name: "Google Agenda",
                provider: "Google",
                connected: "Google Agenda est connecté à Sordulo OS",
                done: DONE,
            },
            Self::Gmail => Texts {
                name: "Gmail",
                provider: "Google",
                connected: "Gmail est connecté à Sordulo OS",
                done: DONE,
            },
        }
    }
}

/// `GoogleStatus` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    pub configured: bool,
    pub connecting: Option<GoogleService>,
}

/// `GoogleAuthorization` du contrat (pas de `Debug` : contient le jeton de rafraîchissement).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthorization {
    pub service: GoogleService,
    pub refresh_token: String,
    pub account: String,
}

/// `GoogleAccess` du contrat (pas de `Debug` : contient le jeton d'accès).
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum GoogleAccess {
    Ok {
        #[serde(rename = "accessToken")]
        access_token: String,
        /// Epoch Unix en ms.
        #[serde(rename = "expiresAt")]
        expires_at: u64,
    },
    Refused,
}

/// Jeton d'accès gardé en mémoire.
#[derive(Clone, PartialEq, Eq)]
struct Access {
    token: String,
    /// Epoch Unix en ms.
    expires_at: u64,
}

impl Access {
    fn usable(&self, now: u64) -> bool {
        now.saturating_add(REFRESH_MARGIN_MS) < self.expires_at
    }
}

/// Clé du cache : service et empreinte (SHA-256) du jeton de rafraîchissement, jamais le jeton lui-même.
type CacheKey = (GoogleService, String);

fn cache_key(service: GoogleService, refresh_token: &str) -> CacheKey {
    (service, URL_SAFE_NO_PAD.encode(Sha256::digest(refresh_token.as_bytes())))
}

#[derive(Default)]
struct Inner {
    connecting: Option<GoogleService>,
    cache: HashMap<CacheKey, Access>,
}

impl Inner {
    /// Jeton d'accès encore utilisable pour cette clé.
    fn usable(&self, key: &CacheKey, now: u64) -> Option<Access> {
        self.cache.get(key).filter(|a| a.usable(now)).cloned()
    }

    /// Jeton à rendre sans rafraîchir. `force` (après un 401 d'une API Google) : seulement un jeton
    /// différent de `rejected` (celui que le front avait), c'est-à-dire rafraîchi entre-temps par un autre appel.
    fn reusable(&self, key: &CacheKey, now: u64, force: bool, rejected: Option<&Access>) -> Option<Access> {
        self.usable(key, now)
            .filter(|a| !force || rejected.is_some_and(|r| r.token != a.token))
    }

    /// Garde un jeton et oublie ceux qui ont expiré.
    fn keep(&mut self, key: CacheKey, access: Access, now: u64) {
        self.cache.retain(|_, a| a.expires_at > now);
        self.cache.insert(key, access);
    }
}

/// État Tauri des connecteurs Google (`app.manage`).
pub struct GoogleState {
    inner: Mutex<Inner>,
    /// Un seul rafraîchissement à la fois.
    refresh: Mutex<()>,
    client: OnceLock<Client>,
    /// Numéro de la dernière connexion lancée : une nouvelle connexion ou une annulation arrête la précédente.
    attempt: AtomicU64,
}

impl GoogleState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            refresh: Mutex::new(()),
            client: OnceLock::new(),
            attempt: AtomicU64::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Client HTTP (construit au premier appel, hors thread async).
    fn client(&self) -> Result<&Client, String> {
        if let Some(client) = self.client.get() {
            return Ok(client);
        }
        let client = api::client()?;
        Ok(self.client.get_or_init(|| client))
    }
}

fn state(app: &AppHandle) -> &GoogleState {
    app.state::<GoogleState>().inner()
}

/// Identifiants compilés, `None` s'ils manquent ou sont vides.
fn credentials() -> Option<Credentials> {
    let present = |v: Option<&'static str>| v.map(str::trim).filter(|v| !v.is_empty());
    Some(Credentials {
        client_id: present(CLIENT_ID)?,
        client_secret: present(CLIENT_SECRET)?,
    })
}

fn not_configured() -> String {
    "Google Agenda et Gmail sont indisponibles dans cette version de l'app de bureau : elle a été compilée \
     sans les identifiants Google de l'agence (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)."
        .into()
}

/// Journalise au démarrage si les identifiants sont compilés (jamais leur valeur).
pub fn start() {
    if credentials().is_some() {
        log::info!("Google : identifiants de l'agence compilés, connecteurs disponibles");
    } else {
        log::info!("Google : identifiants absents de cette version, connecteurs indisponibles");
    }
}

// ---------------------------------------------------------------------------
// État, événements
// ---------------------------------------------------------------------------

/// `google_status`.
pub fn status(app: &AppHandle) -> GoogleStatus {
    GoogleStatus {
        configured: credentials().is_some(),
        connecting: state(app).lock().connecting,
    }
}

fn emit_status(app: &AppHandle) {
    let status = status(app);
    if let Err(e) = app.emit(EVENT_GOOGLE, status) {
        log::warn!("émission de {EVENT_GOOGLE} impossible : {e}");
    }
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

/// `google_connect` : ouvre la page d'autorisation et attend la redirection (bloquant, 3 min au plus).
/// Renvoie de quoi enregistrer la connexion sur le compte ; c'est le front qui l'enregistre.
pub fn connect(app: &AppHandle, service: GoogleService) -> Result<GoogleAuthorization, String> {
    let credentials = credentials().ok_or_else(not_configured)?;
    let google = state(app);
    let attempt = google.attempt.fetch_add(1, Ordering::SeqCst) + 1;
    google.lock().connecting = Some(service);
    emit_status(app);
    let result = run_connect(app, &credentials, service, attempt);
    // Une connexion plus récente (ou une annulation) a pris la main : elle gère `connecting`.
    if google.attempt.load(Ordering::SeqCst) == attempt {
        google.lock().connecting = None;
    }
    emit_status(app);
    match &result {
        Ok(_) => log::info!("Google : {} autorisé", service.name()),
        Err(e) => log::warn!("Google : connexion à {} non aboutie : {e}", service.name()),
    }
    result
}

/// Ouvre le serveur local sur un port libre de 127.0.0.1.
fn bind_loopback() -> Result<TcpListener, String> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("Serveur local de connexion impossible : {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Serveur local de connexion impossible : {e}"))?;
    Ok(listener)
}

fn run_connect(
    app: &AppHandle,
    credentials: &Credentials,
    service: GoogleService,
    attempt: u64,
) -> Result<GoogleAuthorization, String> {
    let pkce = Pkce::generate()?;
    let expected_state = random_state()?;
    let listener = bind_loopback()?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Serveur local de connexion impossible : {e}"))?
        .port();
    let redirect_uri = api::redirect_uri(port);
    let url = api::authorize_url(
        credentials.client_id,
        &redirect_uri,
        service.scope(),
        &pkce.challenge,
        &expected_state,
    );
    platform::open_url(&url).map_err(|e| format!("Impossible d'ouvrir le navigateur : {e:#}"))?;
    log::info!("Google : page d'autorisation de {} ouverte dans le navigateur", service.name());
    let google = state(app);
    callback::wait_for_code(
        &listener,
        api::CALLBACK_PATH,
        &expected_state,
        Instant::now() + CONNECT_TIMEOUT,
        &service.texts(),
        || google.attempt.load(Ordering::SeqCst) != attempt,
        |code| {
            finish_connect(
                app,
                credentials,
                service,
                &code,
                &pkce.verifier,
                &redirect_uri,
                attempt,
            )
        },
    )
}

/// Échange le code, vérifie le scope accordé et lit l'email du compte. Le jeton d'accès reçu est gardé
/// (pas de rafraîchissement juste après la connexion).
fn finish_connect(
    app: &AppHandle,
    credentials: &Credentials,
    service: GoogleService,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    attempt: u64,
) -> Result<GoogleAuthorization, String> {
    let name = service.name();
    let google = state(app);
    let client = google.client()?;
    let tokens = api::exchange_code(client, credentials, code, verifier, redirect_uri, now_ms())
        .map_err(|e| format!("Connexion à {name} impossible : {e}"))?;
    let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
        format!(
            "Google n'a pas renvoyé d'accès durable pour {name}. Retire l'accès de Sordulo OS dans ton \
             compte Google (myaccount.google.com/permissions), puis reconnecte."
        )
    })?;
    if tokens
        .scope
        .as_deref()
        .is_some_and(|granted| !api::has_scope(granted, service.scope()))
    {
        return Err(format!(
            "Accès à {name} non accordé : coche l'autorisation demandée sur la page de Google, puis \
             reconnecte."
        ));
    }
    let account = match tokens.id_token.as_deref().and_then(api::email_from_id_token) {
        Some(email) => email,
        None => api::userinfo_email(client, &tokens.access_token)
            .map_err(|e| format!("Lecture du compte Google impossible : {e}"))?,
    };
    let now = now_ms();
    let mut inner = google.lock();
    if google.attempt.load(Ordering::SeqCst) != attempt {
        return Err(format!("Connexion à {name} annulée."));
    }
    inner.keep(
        cache_key(service, &refresh_token),
        Access {
            token: tokens.access_token,
            expires_at: tokens.expires_at,
        },
        now,
    );
    Ok(GoogleAuthorization {
        service,
        refresh_token,
        account,
    })
}

/// `google_cancel_connect` : arrête une autorisation qui attend dans le navigateur.
pub fn cancel_connect(app: &AppHandle) -> GoogleStatus {
    let google = state(app);
    google.attempt.fetch_add(1, Ordering::SeqCst);
    let was = google.lock().connecting.take();
    if let Some(service) = was {
        log::info!("Google : connexion à {} annulée", service.name());
        emit_status(app);
    }
    status(app)
}

// ---------------------------------------------------------------------------
// Jeton d'accès
// ---------------------------------------------------------------------------

/// `google_access_token` (bloquant : depuis `spawn_blocking`). Jeton gardé en mémoire s'il est encore
/// bon, sinon rafraîchi ; `force_refresh` (après un 401 de Calendar ou Gmail) : le jeton en mémoire est
/// ignoré. `Refused` : Google refuse le jeton de rafraîchissement. Erreur : réseau, autre.
pub fn access_token(
    app: &AppHandle,
    service: GoogleService,
    refresh_token: &str,
    force_refresh: bool,
) -> Result<GoogleAccess, String> {
    let credentials = credentials().ok_or_else(not_configured)?;
    let refresh_token = refresh_token.trim();
    if refresh_token.is_empty() || refresh_token.len() > MAX_REFRESH_TOKEN_LEN {
        return Err(format!("Connexion à {} invalide : reconnecte le compte.", service.name()));
    }
    let google = state(app);
    let key = cache_key(service, refresh_token);
    let ok = |access: Access| GoogleAccess::Ok {
        access_token: access.token,
        expires_at: access.expires_at,
    };
    // Jeton connu avant d'attendre : avec `force_refresh`, c'est celui que l'API Google vient de refuser.
    let before = google.lock().cache.get(&key).cloned();
    if !force_refresh {
        if let Some(access) = google.lock().usable(&key, now_ms()) {
            return Ok(ok(access));
        }
    }
    let _refreshing = google.refresh.lock().unwrap_or_else(|e| e.into_inner());
    // Un autre appel a peut-être rafraîchi pendant l'attente du verrou.
    let reusable = google
        .lock()
        .reusable(&key, now_ms(), force_refresh, before.as_ref());
    if let Some(access) = reusable {
        return Ok(ok(access));
    }
    let client = google.client()?;
    match api::refresh(client, &credentials, refresh_token, now_ms()) {
        Ok(tokens) => {
            let access = Access {
                token: tokens.access_token,
                expires_at: tokens.expires_at,
            };
            google.lock().keep(key, access.clone(), now_ms());
            log::debug!("Google : jeton d'accès de {} rafraîchi", service.name());
            Ok(ok(access))
        }
        Err(TokenError::Refused) => {
            google.lock().cache.remove(&key);
            log::warn!(
                "Google : accès à {} refusé (révoqué ou expiré), à reconnecter",
                service.name()
            );
            Ok(GoogleAccess::Refused)
        }
        Err(e) => Err(format!("Accès à {} impossible : {e}", service.name())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formes_json_du_contrat() {
        assert_eq!(
            serde_json::from_value::<GoogleService>(serde_json::json!("calendar")).unwrap(),
            GoogleService::Calendar
        );
        assert_eq!(
            serde_json::from_value::<GoogleService>(serde_json::json!("gmail")).unwrap(),
            GoogleService::Gmail
        );
        assert!(serde_json::from_value::<GoogleService>(serde_json::json!("drive")).is_err());
        assert_eq!(
            serde_json::to_value(GoogleStatus {
                configured: true,
                connecting: Some(GoogleService::Gmail)
            })
            .unwrap(),
            serde_json::json!({ "configured": true, "connecting": "gmail" })
        );
        assert_eq!(
            serde_json::to_value(GoogleStatus {
                configured: false,
                connecting: None
            })
            .unwrap(),
            serde_json::json!({ "configured": false, "connecting": null })
        );
        assert_eq!(
            serde_json::to_value(GoogleAuthorization {
                service: GoogleService::Calendar,
                refresh_token: "1//0r".into(),
                account: "mael@sordulo.fr".into()
            })
            .unwrap(),
            serde_json::json!({
                "service": "calendar",
                "refreshToken": "1//0r",
                "account": "mael@sordulo.fr"
            })
        );
        assert_eq!(
            serde_json::to_value(GoogleAccess::Ok {
                access_token: "ya29.a".into(),
                expires_at: 1_790_000_000_000
            })
            .unwrap(),
            serde_json::json!({
                "status": "ok",
                "accessToken": "ya29.a",
                "expiresAt": 1_790_000_000_000u64
            })
        );
        assert_eq!(
            serde_json::to_value(GoogleAccess::Refused).unwrap(),
            serde_json::json!({ "status": "refused" })
        );
    }

    #[test]
    fn scopes_en_lecture_seule() {
        assert!(GoogleService::Calendar.scope().ends_with("/calendar.readonly"));
        assert!(GoogleService::Gmail.scope().ends_with("/gmail.readonly"));
        assert_eq!(
            GoogleService::Calendar.texts().connected,
            "Google Agenda est connecté à Sordulo OS"
        );
        assert_eq!(GoogleService::Gmail.texts().connected, "Gmail est connecté à Sordulo OS");
    }

    #[test]
    fn jeton_garde_jusqu_a_une_minute_de_l_expiration() {
        let mut inner = Inner::default();
        let key = cache_key(GoogleService::Gmail, "1//0r");
        // L'empreinte ne contient pas le jeton, et dépend du service.
        assert!(!key.1.contains("1//0r"));
        assert_ne!(key, cache_key(GoogleService::Calendar, "1//0r"));
        assert_ne!(key, cache_key(GoogleService::Gmail, "1//0autre"));
        let access = Access {
            token: "ya29.a".into(),
            expires_at: 1_000_000,
        };
        inner.keep(key.clone(), access.clone(), 0);
        assert!(inner.usable(&key, 1_000_000 - 60_001) == Some(access));
        assert!(inner.usable(&key, 1_000_000 - 60_000).is_none());
        assert!(inner.usable(&cache_key(GoogleService::Calendar, "1//0r"), 0).is_none());
        // Les jetons expirés sont oubliés au prochain ajout.
        let other = cache_key(GoogleService::Calendar, "1//0r");
        inner.keep(
            other.clone(),
            Access {
                token: "ya29.b".into(),
                expires_at: 5_000_000,
            },
            1_000_001,
        );
        assert!(!inner.cache.contains_key(&key));
        assert!(inner.cache.contains_key(&other));
    }

    #[test]
    fn rafraichissement_force_ignore_le_jeton_refuse() {
        let mut inner = Inner::default();
        let key = cache_key(GoogleService::Calendar, "1//0r");
        let refused = Access {
            token: "ya29.refuse".into(),
            expires_at: 10_000_000,
        };
        inner.keep(key.clone(), refused.clone(), 0);
        // Sans forcer : le jeton en mémoire sert.
        assert!(inner.reusable(&key, 0, false, None) == Some(refused.clone()));
        // Forcé : le jeton que l'API a refusé n'est jamais rendu (rafraîchissement).
        assert!(inner.reusable(&key, 0, true, Some(&refused)).is_none());
        assert!(inner.reusable(&key, 0, true, None).is_none());
        // Forcé, mais un autre appel a rafraîchi pendant l'attente : son nouveau jeton sert.
        let fresh = Access {
            token: "ya29.neuf".into(),
            expires_at: 10_000_000,
        };
        inner.keep(key.clone(), fresh.clone(), 0);
        assert!(inner.reusable(&key, 0, true, Some(&refused)) == Some(fresh));
    }
}
