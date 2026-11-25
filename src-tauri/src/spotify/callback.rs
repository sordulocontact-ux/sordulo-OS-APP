//! Petit serveur local qui reçoit la redirection de Spotify (`http://127.0.0.1:43127/callback`), ouvert
//! seulement pendant une connexion (3 min au plus) et sur la boucle locale seulement.
//!
//! Le port est fixe (déclaré dans le tableau de bord Spotify) ; l'attente de la bonne requête, la page
//! montrée au navigateur et les messages sont communs aux connecteurs (`crate::oauth::callback`), avec les
//! textes de Spotify (« Spotify est connecté, tu peux fermer cet onglet » ou l'erreur).

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::thread;
use std::time::Instant;

use super::pkce::{CALLBACK_PATH, CALLBACK_PORT};
use crate::oauth::callback::{self as oauth_callback, Texts, ACCEPT_STEP};

/// Port encore tenu par une connexion annulée à l'instant : quelques essais.
const BIND_ATTEMPTS: u32 = 15;

const TEXTS: Texts = Texts {
    name: "Spotify",
    provider: "Spotify",
    connected: "Spotify est connecté",
    done: "Tu peux fermer cet onglet et revenir dans Sordulo OS.",
};

/// Ouvre le port de la redirection sur 127.0.0.1.
pub fn bind() -> Result<TcpListener, String> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, CALLBACK_PORT);
    let mut last_error = None;
    for _ in 0..BIND_ATTEMPTS {
        match TcpListener::bind(address) {
            Ok(listener) => {
                listener
                    .set_nonblocking(true)
                    .map_err(|e| format!("Port {CALLBACK_PORT} inutilisable : {e}"))?;
                return Ok(listener);
            }
            Err(e) if e.kind() == ErrorKind::AddrInUse => {
                last_error = Some(e);
                thread::sleep(ACCEPT_STEP);
            }
            Err(e) => return Err(format!("Port {CALLBACK_PORT} inutilisable : {e}")),
        }
    }
    Err(format!(
        "Le port {CALLBACK_PORT} est déjà utilisé par une autre application ({}).",
        last_error.map_or_else(String::new, |e| e.to_string())
    ))
}

/// Attend la redirection jusqu'à `deadline` ou l'annulation, puis appelle `finish` avec le code (échange
/// des jetons) et montre son résultat dans le navigateur.
pub fn wait_for_code<T>(
    listener: &TcpListener,
    expected_state: &str,
    deadline: Instant,
    cancelled: impl Fn() -> bool,
    finish: impl FnOnce(String) -> Result<T, String>,
) -> Result<T, String> {
    oauth_callback::wait_for_code(
        listener,
        CALLBACK_PATH,
        expected_state,
        deadline,
        &TEXTS,
        cancelled,
        finish,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    /// Serveur réel sur un port de test : favicon ignoré, mauvais `state` ignoré, puis le bon code.
    #[test]
    fn attend_la_bonne_redirection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = thread::spawn(move || {
            let get = |path: &str| {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
                let mut out = String::new();
                s.read_to_string(&mut out).unwrap();
                out
            };
            (
                get("/favicon.ico"),
                get("/callback?code=vieux&state=autre"),
                get("/callback?code=le-code&state=bon"),
            )
        });
        let result = wait_for_code(
            &listener,
            "bon",
            Instant::now() + Duration::from_secs(10),
            || false,
            Ok::<String, String>,
        );
        assert_eq!(result.as_deref(), Ok("le-code"));
        let (favicon, stale, ok) = browser.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(stale.starts_with("HTTP/1.1 400") && stale.contains("Lien expiré"));
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("Spotify est connecté"));
        assert!(ok.contains("<title>Sordulo OS · Spotify</title>"));
    }

    #[test]
    fn annulation_et_delai() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let far = Instant::now() + Duration::from_secs(60);
        let cancelled = wait_for_code(&listener, "s", far, || true, Ok::<String, String>);
        assert_eq!(cancelled, Err("Connexion à Spotify annulée.".into()));
        let expired = wait_for_code(
            &listener,
            "s",
            Instant::now(),
            || false,
            Ok::<String, String>,
        );
        assert_eq!(
            expired.unwrap_err(),
            "Délai dépassé : la connexion à Spotify n'a pas été terminée dans le navigateur."
        );
    }
}
