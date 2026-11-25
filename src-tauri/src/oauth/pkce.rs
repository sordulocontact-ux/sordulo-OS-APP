//! OAuth PKCE (pur) : vérificateur et défi S256, `state` aléatoire, encodage pour URL et formulaire,
//! lecture de la redirection `<chemin>?code=…&state=…` reçue par le serveur local.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

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

/// Corps `application/x-www-form-urlencoded` (aussi la requête d'une URL).
pub fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
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
    /// L'utilisateur a refusé (`error=access_denied`) ou le service a renvoyé une erreur.
    Denied(String),
    /// Code d'autorisation à échanger contre les jetons.
    Code(String),
}

/// Lit la redirection (`target` : chemin et requête) attendue sur `path`, en vérifiant le `state`.
pub fn read_callback(target: &str, path: &str, expected_state: &str) -> Callback {
    let (target_path, query) = target.split_once('?').unwrap_or((target, ""));
    if target_path != path {
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
    fn encodage_et_decodage() {
        assert_eq!(percent_encode("a b&c=d/é~"), "a%20b%26c%3Dd%2F%C3%A9~");
        assert_eq!(percent_decode("a%20b+c%C3%A9").as_deref(), Some("a b cé"));
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%2"), None);
        assert_eq!(
            form_body(&[
                ("grant_type", "authorization_code"),
                ("redirect_uri", "http://127.0.0.1:43127/callback")
            ]),
            "grant_type=authorization_code&redirect_uri=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback"
        );
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
    fn redirection_lue_sur_son_chemin() {
        let read = |target| read_callback(target, "/callback", "s1");
        assert_eq!(
            read("/callback?code=AQB%2Dx&state=s1"),
            Callback::Code("AQB-x".into())
        );
        assert_eq!(
            read("/callback?error=access_denied&state=s1"),
            Callback::Denied("access_denied".into())
        );
        assert_eq!(read("/callback?code=x&state=autre"), Callback::WrongState);
        assert_eq!(read("/callback?code=x"), Callback::WrongState);
        assert_eq!(read("/favicon.ico"), Callback::Other);
        assert_eq!(read("/callbackx?state=s1"), Callback::Other);
        assert_eq!(
            read("/callback?state=s1&code="),
            Callback::Denied("code absent".into())
        );
        // Code de Google : « 4/0A… » encodé.
        assert_eq!(
            read_callback("/google?state=s1&code=4%2F0Abc&scope=email", "/google", "s1"),
            Callback::Code("4/0Abc".into())
        );
        assert_eq!(
            read_callback("/callback?state=s1&code=x", "/google", "s1"),
            Callback::Other
        );
    }
}
