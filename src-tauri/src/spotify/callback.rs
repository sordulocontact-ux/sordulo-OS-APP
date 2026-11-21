//! Petit serveur local qui reçoit la redirection de Spotify (`http://127.0.0.1:43127/callback`), ouvert
//! seulement pendant une connexion (3 min au plus) et sur la boucle locale seulement.
//!
//! Une requête à la fois : la bonne (`state` vérifié) termine l'attente ; les autres (favicon, vieil onglet)
//! reçoivent une petite page et l'attente continue. Le navigateur reçoit une page en français avec le
//! résultat (« Spotify est connecté, tu peux fermer cet onglet » ou l'erreur).

use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

use super::pkce::{read_callback, request_target, Callback, CALLBACK_PORT};

const IO_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_HEAD_BYTES: usize = 8 * 1024;
/// Pas de la boucle d'attente (non bloquante : vérifie l'annulation et le délai).
const ACCEPT_STEP: Duration = Duration::from_millis(150);
/// Port encore tenu par une connexion annulée à l'instant : quelques essais.
const BIND_ATTEMPTS: u32 = 15;

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
    loop {
        if cancelled() {
            return Err("Connexion à Spotify annulée.".into());
        }
        if Instant::now() >= deadline {
            return Err(
                "Délai dépassé : la connexion à Spotify n'a pas été terminée dans le navigateur."
                    .into(),
            );
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_STEP);
                continue;
            }
            Err(e) => {
                log::debug!("Spotify : connexion locale refusée : {e}");
                thread::sleep(ACCEPT_STEP);
                continue;
            }
        };
        let Some(target) = read_target(&mut stream) else {
            respond(
                &mut stream,
                400,
                "Requête invalide",
                "Cette adresse sert seulement à connecter Spotify.",
            );
            continue;
        };
        match read_callback(&target, expected_state) {
            Callback::Other => {
                respond(
                    &mut stream,
                    404,
                    "Page introuvable",
                    "Cette adresse sert seulement à connecter Spotify.",
                );
            }
            Callback::WrongState => {
                respond(
                    &mut stream,
                    400,
                    "Lien expiré",
                    "Cette page de connexion n'est plus valable. Relance la connexion depuis Sordulo OS.",
                );
            }
            Callback::Denied(error) => {
                respond(
                    &mut stream,
                    200,
                    "Connexion annulée",
                    "Spotify n'a pas été connecté. Tu peux fermer cet onglet.",
                );
                return Err(if error == "access_denied" {
                    "Connexion à Spotify refusée dans le navigateur.".into()
                } else {
                    format!("Spotify a refusé la connexion ({}).", short_code(&error))
                });
            }
            Callback::Code(code) => {
                let result = finish(code);
                match &result {
                    Ok(_) => respond(
                        &mut stream,
                        200,
                        "Spotify est connecté",
                        "Tu peux fermer cet onglet et revenir dans Sordulo OS.",
                    ),
                    Err(e) => respond(&mut stream, 500, "Connexion impossible", e),
                }
                return result;
            }
        }
    }
}

/// Code d'erreur renvoyé par Spotify, réduit à des caractères sûrs pour un message.
fn short_code(error: &str) -> String {
    error
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(64)
        .collect()
}

/// Lit l'en-tête de la requête et renvoie sa cible (`/callback?…`).
fn read_target(stream: &mut TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok()?;
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        if head.len() > MAX_HEAD_BYTES {
            return None;
        }
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => head.extend_from_slice(&buf[..n]),
            Err(_) => return None,
        }
    }
    let head = String::from_utf8_lossy(&head);
    request_target(&head).map(str::to_owned)
}

/// Échappe le texte pour la page HTML.
fn escape_html(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '&' => "&amp;".to_owned(),
            '<' => "&lt;".to_owned(),
            '>' => "&gt;".to_owned(),
            '"' => "&quot;".to_owned(),
            '\'' => "&#39;".to_owned(),
            c => c.to_string(),
        })
        .collect()
}

/// Page montrée dans le navigateur après la redirection.
pub fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>Sordulo OS · Spotify</title><style>\
         body{{margin:0;min-height:100vh;display:grid;place-items:center;\
         font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#111;color:#f2f2f2}}\
         main{{max-width:28rem;padding:2rem;text-align:center}}h1{{font-size:1.5rem;margin:0 0 .75rem}}\
         p{{margin:0;color:#bdbdbd;line-height:1.5}}</style></head>\
         <body><main><h1>{}</h1><p>{}</p></main></body></html>",
        escape_html(title),
        escape_html(message)
    )
}

fn respond(stream: &mut TcpStream, status: u16, title: &str, message: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let body = page(title, message);
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if let Err(e) = stream
        .write_all(response.as_bytes())
        .and_then(|()| stream.flush())
    {
        log::debug!("Spotify : réponse au navigateur impossible : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_echappee() {
        let html = page("Connexion impossible", "<script>alert('x')</script> & co");
        assert!(html.contains("<h1>Connexion impossible</h1>"));
        assert!(html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co"));
        assert!(!html.contains("<script>"));
        assert!(html.starts_with("<!doctype html><html lang=\"fr\">"));
    }

    #[test]
    fn code_d_erreur_nettoye() {
        assert_eq!(short_code("invalid_scope<b>"), "invalid_scopeb");
    }

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
        assert!(expired.unwrap_err().starts_with("Délai dépassé"));
    }
}
