//! OAuth PKCE de Spotify, sans secret (pur) : vérificateur et défi S256, `state` aléatoire, URL
//! d'autorisation, corps de formulaire, lecture de la redirection `/callback?code=…&state=…`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Page d'autorisation de Spotify, ouverte dans le navigateur par défaut.
pub const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
/// Port du petit serveur local qui reçoit la redirection (seulement pendant la connexion).
pub const CALLBACK_PORT: u16 = 43127;
/// Chemin de la redirection.
pub const CALLBACK_PATH: &str = "/callback";
/// À déclarer tel quel dans le tableau de bord Spotify (Redirect URIs).
pub const REDIRECT_URI: &str = "http://127.0.0.1:43127/callback";
/// Lire ce qui joue (et sur quel appareil), le commander, savoir si le compte est Premium.
pub const SCOPES: &str =
    "user-read-playback-state user-read-currently-playing user-modify-playback-state user-read-private";

/// Octets aléatoires du vérificateur : 64 octets donnent 86 caractères (PKCE : 43 à 128).
const VERIFIER_BYTES: usize = 64;
/// Octets aléatoires du `state`.
const STATE_BYTES: usize = 24;

/// Chaîne aléatoire en base64url sans remplissage (`bytes` octets tirés par le système).
pub fn random_token(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| format!("aléa du système indisponible : {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(&buf))
}

/// Paire PKCE : le vérificateur reste ici, le défi part dans l'URL d'autorisation.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn generate() -> Result<Self, String> {
        Ok(Self::from_verifier(random_token(VERIFIER_BYTES)?))
    }

    pub fn from_verifier(verifier: String) -> Self {
        let challenge = challenge_of(&verifier);
        Self {
            verifier,
            challenge,
        }
    }
}

/// `state` de la demande d'autorisation (vérifié au retour).
pub fn random_state() -> Result<String, String> {
    random_token(STATE_BYTES)
}

/// Défi S256 : base64url sans remplissage du SHA-256 du vérificateur.
pub fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Client ID d'une app Spotify : 32 caractères hexadécimaux en pratique ; on accepte de l'alphanumérique
/// court (il part dans une URL et dans le fichier des jetons).
pub fn valid_client_id(client_id: &str) -> bool {
    !client_id.is_empty()
        && client_id.len() <= 64
        && client_id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Encodage pour URL et formulaire : tout sauf `A-Z a-z 0-9 - . _ ~` en `%XX`.
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Décodage d'un paramètre de requête (`%XX`, `+` = espace). `None` si l'encodage est invalide.
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = text.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Corps `application/x-www-form-urlencoded`.
pub fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// URL de la page d'autorisation (code + PKCE S256).
pub fn authorize_url(client_id: &str, challenge: &str, state: &str) -> String {
    let query = form_body(&[
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", REDIRECT_URI),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge),
        ("state", state),
        ("scope", SCOPES),
    ]);
    format!("{AUTHORIZE_URL}?{query}")
}

/// Cible d'une requête HTTP `GET` (`/callback?…`) d'après sa première ligne, `None` sinon.
pub fn request_target(head: &str) -> Option<&str> {
    let line = head.lines().next()?;
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    (method == "GET" && version.starts_with("HTTP/1.") && target.starts_with('/')).then_some(target)
}

/// Ce qu'apporte une requête reçue par le serveur local.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    /// Autre chemin (`/favicon.ico`…) : ignorée.
    Other,
    /// `state` absent ou différent : vieil onglet ou requête étrangère, ignorée.
    WrongState,
    /// L'utilisateur a refusé (`error=access_denied`) ou Spotify a renvoyé une erreur.
    Denied(String),
    /// Code d'autorisation à échanger contre les jetons.
    Code(String),
}

/// Lit la redirection de Spotify (`target` : chemin et requête) en vérifiant le `state`.
pub fn read_callback(target: &str, expected_state: &str) -> Callback {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != CALLBACK_PATH {
        return Callback::Other;
    }
    let params: Vec<(String, String)> = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(key)?, percent_decode(value)?))
        })
        .collect();
    let get = |name: &str| {
        params
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    };
    if get("state") != Some(expected_state) {
        return Callback::WrongState;
    }
    if let Some(error) = get("error") {
        return Callback::Denied(error.to_owned());
    }
    match get("code") {
        Some(code) if !code.is_empty() => Callback::Code(code.to_owned()),
        _ => Callback::Denied("code absent".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defi_s256_de_la_rfc_7636() {
        // Exemple de l'annexe B de la RFC 7636.
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verificateur_aleatoire_conforme() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert_ne!(a.verifier, b.verifier);
        assert!(
            (43..=128).contains(&a.verifier.len()),
            "{}",
            a.verifier.len()
        );
        let allowed = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
        assert!(a.verifier.chars().all(allowed));
        // base64url sans remplissage.
        assert!(
            !a.challenge.contains('=') && !a.challenge.contains('+') && !a.challenge.contains('/')
        );
        assert_eq!(a.challenge.len(), 43);
        assert_ne!(random_state().unwrap(), random_state().unwrap());
    }

    #[test]
    fn client_id() {
        assert!(valid_client_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("abc def"));
        assert!(!valid_client_id("abc&scope=x"));
        assert!(!valid_client_id(&"a".repeat(65)));
    }

    #[test]
    fn encodage_et_decodage() {
        assert_eq!(percent_encode("a b&c=d/é~"), "a%20b%26c%3Dd%2F%C3%A9~");
        assert_eq!(percent_decode("a%20b+c%C3%A9").as_deref(), Some("a b cé"));
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%2"), None);
        assert_eq!(
            form_body(&[
                ("grant_type", "authorization_code"),
                ("redirect_uri", REDIRECT_URI)
            ]),
            "grant_type=authorization_code&redirect_uri=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback"
        );
    }

    #[test]
    fn url_d_autorisation() {
        let url = authorize_url("abc123", "defi", "etat");
        assert!(url.starts_with("https://accounts.spotify.com/authorize?client_id=abc123&"));
        assert!(url.contains("&response_type=code&"));
        assert!(url.contains("&redirect_uri=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback&"));
        assert!(url.contains("&code_challenge_method=S256&code_challenge=defi&state=etat&"));
        assert!(url.ends_with(
            "&scope=user-read-playback-state%20user-read-currently-playing%20\
             user-modify-playback-state%20user-read-private"
        ));
    }

    #[test]
    fn premiere_ligne_de_la_requete() {
        assert_eq!(
            request_target("GET /callback?code=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            Some("/callback?code=x")
        );
        assert_eq!(request_target("POST /callback HTTP/1.1\r\n"), None);
        assert_eq!(request_target("GET http://evil/ HTTP/1.1\r\n"), None);
        assert_eq!(request_target(""), None);
    }

    #[test]
    fn redirection_de_spotify() {
        assert_eq!(
            read_callback("/callback?code=AQB%2Dx&state=s1", "s1"),
            Callback::Code("AQB-x".into())
        );
        assert_eq!(
            read_callback("/callback?error=access_denied&state=s1", "s1"),
            Callback::Denied("access_denied".into())
        );
        assert_eq!(
            read_callback("/callback?code=x&state=autre", "s1"),
            Callback::WrongState
        );
        assert_eq!(
            read_callback("/callback?code=x", "s1"),
            Callback::WrongState
        );
        assert_eq!(read_callback("/favicon.ico", "s1"), Callback::Other);
        assert_eq!(read_callback("/callbackx?state=s1", "s1"), Callback::Other);
        assert_eq!(
            read_callback("/callback?state=s1&code=", "s1"),
            Callback::Denied("code absent".into())
        );
    }
}
