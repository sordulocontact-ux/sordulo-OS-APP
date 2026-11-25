//! OAuth PKCE de Spotify, sans secret (pur) : adresses, Client ID, URL d'autorisation. Le PKCE, le `state`,
//! l'encodage et la lecture de la redirection sont communs aux connecteurs (`crate::oauth::pkce`).

pub use crate::oauth::pkce::{form_body, random_state, Pkce};

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

/// Client ID d'une app Spotify : 32 caractères hexadécimaux en pratique ; on accepte de l'alphanumérique
/// court (il part dans une URL et dans le fichier des jetons).
pub fn valid_client_id(client_id: &str) -> bool {
    !client_id.is_empty()
        && client_id.len() <= 64
        && client_id.chars().all(|c| c.is_ascii_alphanumeric())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_id() {
        assert!(valid_client_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("abc def"));
        assert!(!valid_client_id("abc&scope=x"));
        assert!(!valid_client_id(&"a".repeat(65)));
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
    fn redirection_de_spotify() {
        use crate::oauth::pkce::{read_callback, Callback};
        assert_eq!(
            read_callback("/callback?code=AQB%2Dx&state=s1", CALLBACK_PATH, "s1"),
            Callback::Code("AQB-x".into())
        );
        assert_eq!(
            read_callback("/favicon.ico", CALLBACK_PATH, "s1"),
            Callback::Other
        );
        assert_eq!(REDIRECT_URI, format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}"));
    }
}
