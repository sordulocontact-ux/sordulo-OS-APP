//! Petit serveur local qui reçoit la redirection d'une autorisation OAuth, ouvert seulement pendant une
//! connexion (3 min au plus) et sur la boucle locale seulement. Commun à Spotify (port fixe) et Google (port
//! libre choisi par le système) : le connecteur ouvre le port, ce module attend la bonne requête.
//!
//! Une requête à la fois : la bonne (chemin et `state` vérifiés) termine l'attente ; les autres (favicon,
//! vieil onglet) reçoivent une petite page et l'attente continue. Le navigateur reçoit une page en français
//! avec le résultat (« Spotify est connecté, tu peux fermer cet onglet » ou l'erreur).

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

use super::pkce::{read_callback, request_target, Callback};

const IO_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_HEAD_BYTES: usize = 8 * 1024;
/// Pas de la boucle d'attente (non bloquante : vérifie l'annulation et le délai).
pub const ACCEPT_STEP: Duration = Duration::from_millis(150);

/// Textes d'un connecteur, dans la page du navigateur et dans les erreurs renvoyées au front.
#[derive(Debug, Clone, Copy)]
pub struct Texts {
    /// Ce qu'on connecte : « Spotify », « Google Agenda », « Gmail » (« Connexion à {name} annulée. »).
    pub name: &'static str,
    /// Qui peut refuser : « Spotify », « Google » (« {provider} a refusé la connexion (…). »).
    pub provider: &'static str,
    /// Titre de la page de réussite (« Spotify est connecté »).
    pub connected: &'static str,
    /// Texte de la page de réussite.
    pub done: &'static str,
}

/// Attend sur `listener` (non bloquant) la redirection vers `path` jusqu'à `deadline` ou l'annulation,
/// puis appelle `finish` avec le code (échange des jetons) et montre son résultat dans le navigateur.
pub fn wait_for_code<T>(
    listener: &TcpListener,
    path: &str,
    expected_state: &str,
    deadline: Instant,
    texts: &Texts,
    cancelled: impl Fn() -> bool,
    finish: impl FnOnce(String) -> Result<T, String>,
) -> Result<T, String> {
    let name = texts.name;
    let only_here = format!("Cette adresse sert seulement à connecter {name}.");
    loop {
        if cancelled() {
            return Err(format!("Connexion à {name} annulée."));
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "Délai dépassé : la connexion à {name} n'a pas été terminée dans le navigateur."
            ));
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_STEP);
                continue;
            }
            Err(e) => {
                log::debug!("{name} : connexion locale refusée : {e}");
                thread::sleep(ACCEPT_STEP);
                continue;
            }
        };
        let Some(target) = read_target(&mut stream) else {
            respond(&mut stream, texts, 400, "Requête invalide", &only_here);
            continue;
        };
        match read_callback(&target, path, expected_state) {
            Callback::Other => {
                respond(&mut stream, texts, 404, "Page introuvable", &only_here);
            }
            Callback::WrongState => {
                respond(
                    &mut stream,
                    texts,
                    400,
                    "Lien expiré",
                    "Cette page de connexion n'est plus valable. Relance la connexion depuis Sordulo OS.",
                );
            }
            Callback::Denied(error) => {
                respond(
                    &mut stream,
                    texts,
                    200,
                    "Connexion annulée",
                    &format!("{name} n'a pas été connecté. Tu peux fermer cet onglet."),
                );
                return Err(if error == "access_denied" {
                    format!("Connexion à {name} refusée dans le navigateur.")
                } else {
                    format!(
                        "{} a refusé la connexion ({}).",
                        texts.provider,
                        short_code(&error)
                    )
                });
            }
            Callback::Code(code) => {
                let result = finish(code);
                match &result {
                    Ok(_) => respond(&mut stream, texts, 200, texts.connected, texts.done),
                    Err(e) => respond(&mut stream, texts, 500, "Connexion impossible", e),
                }
                return result;
            }
        }
    }
}

/// Code d'erreur renvoyé par le service, réduit à des caractères sûrs pour un message.
pub fn short_code(error: &str) -> String {
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

/// Page montrée dans le navigateur après la redirection (onglet « Sordulo OS · {name} »).
pub fn page(name: &str, title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>Sordulo OS · {}</title><style>\
         body{{margin:0;min-height:100vh;display:grid;place-items:center;\
         font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#111;color:#f2f2f2}}\
         main{{max-width:28rem;padding:2rem;text-align:center}}h1{{font-size:1.5rem;margin:0 0 .75rem}}\
         p{{margin:0;color:#bdbdbd;line-height:1.5}}</style></head>\
         <body><main><h1>{}</h1><p>{}</p></main></body></html>",
        escape_html(name),
        escape_html(title),
        escape_html(message)
    )
}

fn respond(stream: &mut TcpStream, texts: &Texts, status: u16, title: &str, message: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let body = page(texts.name, title, message);
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    if let Err(e) = stream
        .write_all(response.as_bytes())
        .and_then(|()| stream.flush())
    {
        log::debug!("{} : réponse au navigateur impossible : {e}", texts.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXTS: Texts = Texts {
        name: "Gmail",
        provider: "Google",
        connected: "Gmail est connecté à Sordulo OS",
        done: "Tu peux fermer cet onglet.",
    };

    #[test]
    fn page_echappee() {
        let html = page("Spotify", "Connexion impossible", "<script>alert('x')</script> & co");
        assert!(html.contains("<h1>Connexion impossible</h1>"));
        assert!(html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; co"));
        assert!(!html.contains("<script>"));
        assert!(html.starts_with("<!doctype html><html lang=\"fr\">"));
        assert!(html.contains("<title>Sordulo OS · Spotify</title>"));
    }

    #[test]
    fn code_d_erreur_nettoye() {
        assert_eq!(short_code("invalid_scope<b>"), "invalid_scopeb");
    }

    fn get(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    /// Serveur réel sur un port libre : textes du connecteur et chemin choisi.
    #[test]
    fn textes_et_chemin_du_connecteur() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = thread::spawn(move || {
            (
                get(port, "/callback?code=x&state=bon"),
                get(port, "/google?code=4%2F0A&state=bon"),
            )
        });
        let result = wait_for_code(
            &listener,
            "/google",
            "bon",
            Instant::now() + Duration::from_secs(10),
            &TEXTS,
            || false,
            Ok::<String, String>,
        );
        assert_eq!(result.as_deref(), Ok("4/0A"));
        let (other, ok) = browser.join().unwrap();
        assert!(other.starts_with("HTTP/1.1 404") && other.contains("connecter Gmail."));
        assert!(ok.starts_with("HTTP/1.1 200"));
        assert!(ok.contains("<h1>Gmail est connecté à Sordulo OS</h1>"));
        assert!(ok.contains("<title>Sordulo OS · Gmail</title>"));
    }

    #[test]
    fn refus_dans_le_navigateur() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = thread::spawn(move || get(port, "/google?error=access_denied&state=s"));
        let far = Instant::now() + Duration::from_secs(10);
        let denied = wait_for_code(&listener, "/google", "s", far, &TEXTS, || false, Ok::<String, String>);
        assert_eq!(denied, Err("Connexion à Gmail refusée dans le navigateur.".into()));
        assert!(browser.join().unwrap().contains("Gmail n&#39;a pas été connecté"));

        let browser = thread::spawn(move || get(port, "/google?error=admin_policy_enforced&state=s"));
        let refused = wait_for_code(&listener, "/google", "s", far, &TEXTS, || false, Ok::<String, String>);
        assert_eq!(
            refused,
            Err("Google a refusé la connexion (admin_policy_enforced).".into())
        );
        browser.join().unwrap();
    }
}
