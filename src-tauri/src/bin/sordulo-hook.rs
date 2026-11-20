//! `sordulo-hook` : relais entre les hooks de Claude Code et Sordulo OS (std + serde_json seulement).
//!
//! Appel : `sordulo-hook <EventName>` avec le JSON du hook sur stdin (commandes installées dans
//! `~/.claude/settings.json` par « Connecter Claude Code », voir `src/claude/settings.rs`).
//!
//! 1. Lit `{ port, token }` dans `claude-relay.json`, écrit par l'app au démarrage dans son dossier de
//!    données (`app_data_dir()` de Tauri pour `com.sordulo.os` : `%APPDATA%\com.sordulo.os` sous Windows).
//!    `SORDULO_HOOK_RELAY_FILE` remplace ce chemin (tests).
//! 2. POSTe `{ "event": <EventName>, "input": <JSON du hook allégé> }` sur `http://127.0.0.1:<port>/hook`
//!    avec `Authorization: Bearer <token>`.
//! 3. PermissionRequest : attend au plus 60 s la décision de l'île, puis imprime sur stdout l'objet
//!    `hookSpecificOutput` (allow ; deny avec message). Tout autre cas : rien sur stdout.
//!
//! Règle absolue : ne jamais bloquer Claude Code. Toujours le code de sortie 0 (même après une erreur
//! ou un panic), rien sur stdout hors décision, connexion courte (300 ms), échéance dure courte (1 s,
//! compatible avec le budget de 1,5 s de SessionEnd) sauf PermissionRequest (63 s, sous les 75 s du
//! `timeout` posé dans settings.json), et un watchdog qui sort 0 si une E/S traîne.
//!
//! Conception inspirée d'un relais de hooks open source sous licence MIT
//! (Copyright (c) 2026 Louis Raillé) ; aucun code n'y est repris mot pour mot.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Identifiant Tauri de l'app (`tauri.conf.json`), nom du dossier de données.
const APP_ID: &str = "com.sordulo.os";
/// Fichier de découverte écrit par l'app (même nom que `claude::RELAY_FILE_NAME`).
const RELAY_FILE_NAME: &str = "claude-relay.json";
const RELAY_FILE_ENV: &str = "SORDULO_HOOK_RELAY_FILE";

const PERMISSION_EVENT: &str = "PermissionRequest";
/// Message renvoyé à Claude quand l'île refuse.
const DENY_MESSAGE: &str = "Refusé depuis Sordulo OS";

const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
const WRITE_TIMEOUT: Duration = Duration::from_millis(500);
/// Échéance dure de tous les événements sauf PermissionRequest.
const EVENT_DEADLINE: Duration = Duration::from_millis(1000);
/// Attente de la décision : `CLAUDE_PERMISSION_TIMEOUT_MS` (60 s) + marge pour la réponse de l'app.
const PERMISSION_READ_DEADLINE: Duration = Duration::from_millis(62_000);
/// Watchdog de PermissionRequest (le `timeout` du hook dans settings.json est de 75 s).
const PERMISSION_DEADLINE: Duration = Duration::from_millis(63_000);

const MAX_STDIN_BYTES: u64 = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_RELAY_FILE_BYTES: u64 = 4096;
/// Les chaînes du JSON transmis sont plafonnées (l'app n'en garde qu'un résumé, jamais le contenu).
const MAX_STRING_BYTES: usize = 2000;

fn main() {
    // Un panic ne doit jamais remonter à Claude Code (code 101 = « hook error ») : sortie 0, muette.
    std::panic::set_hook(Box::new(|_| std::process::exit(0)));

    let started = Instant::now();
    let event = std::env::args().nth(1).unwrap_or_default();
    let permission = event == PERMISSION_EVENT;
    let deadline = if permission {
        PERMISSION_DEADLINE
    } else {
        EVENT_DEADLINE
    };
    std::thread::spawn(move || {
        std::thread::sleep(deadline);
        std::process::exit(0);
    });

    let read_deadline = started
        + if permission {
            PERMISSION_READ_DEADLINE
        } else {
            EVENT_DEADLINE
        };
    if let Some(output) = run(&event, read_deadline) {
        let mut stdout = std::io::stdout().lock();
        let _ = stdout.write_all(output.as_bytes());
        let _ = stdout.flush();
    }
    std::process::exit(0);
}

/// Tout le travail ; `None` = rien à écrire sur stdout.
fn run(event: &str, read_deadline: Instant) -> Option<String> {
    if !is_event_name(event) {
        return None;
    }
    // Lire stdin en octets bruts (jamais de String depuis la console), même si l'app est absente.
    let mut raw = Vec::new();
    std::io::stdin()
        .take(MAX_STDIN_BYTES)
        .read_to_end(&mut raw)
        .ok()?;
    let relay = read_relay_file()?;
    let input: Value = serde_json::from_slice(&raw).ok()?;
    // Entrée complète de l'outil, avant allègement : `updatedInput` la remplace en entier.
    let tool_input = input.get("tool_input").cloned();
    let body = request_body(event, input);
    let (status, response) = post(&relay, &body, read_deadline)?;
    decide_output_for(event, status, &response, tool_input.as_ref())
}

/// Nom d'événement plausible (lettres seulement) : l'app vérifie qu'il fait partie des siens.
fn is_event_name(event: &str) -> bool {
    !event.is_empty() && event.len() <= 64 && event.bytes().all(|b| b.is_ascii_alphabetic())
}

#[derive(Debug, PartialEq, Eq)]
struct Relay {
    port: u16,
    token: String,
}

fn relay_file_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(RELAY_FILE_ENV) {
        return Some(PathBuf::from(path));
    }
    data_dir().map(|dir| dir.join(APP_ID).join(RELAY_FILE_NAME))
}

/// Même dossier que `dirs::data_dir()` utilisé par Tauri pour `app_data_dir()`.
#[cfg(windows)]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

fn read_relay_file() -> Option<Relay> {
    let file = std::fs::File::open(relay_file_path()?).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_RELAY_FILE_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    parse_relay(&bytes)
}

/// `{ "port": 1234, "token": "<hex>" }` ; le jeton n'est accepté qu'en hexadécimal (en-tête HTTP sûr).
fn parse_relay(bytes: &[u8]) -> Option<Relay> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let port = u16::try_from(value.get("port")?.as_u64()?).ok()?;
    let token = value.get("token")?.as_str()?;
    if port == 0
        || token.is_empty()
        || token.len() > 256
        || !token.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    Some(Relay {
        port,
        token: token.to_string(),
    })
}

/// Clé ajoutée à l'entrée du hook : l'app d'où vient la session (pour rouvrir la bonne fenêtre).
const HOST_KEY: &str = "sordulo_host";

/// App qui a lancé Claude Code, d'après l'environnement hérité : chemin de l'éditeur (VS Code, Cursor :
/// `VSCODE_GIT_ASKPASS_NODE`, posé dans leurs terminaux sous Windows comme sous macOS), bundle id de l'app
/// sous macOS (`__CFBundleIdentifier`), `TERM_PROGRAM`.
fn host_info() -> Value {
    let var = |key: &str| std::env::var(key).ok().filter(|v| !v.trim().is_empty());
    json!({
        "editor_exe": var("VSCODE_GIT_ASKPASS_NODE"),
        "bundle_id": var("__CFBundleIdentifier"),
        "term_program": var("TERM_PROGRAM"),
    })
}

/// Corps envoyé à l'app : la sortie des outils est retirée, les chaînes sont plafonnées.
fn request_body(event: &str, mut input: Value) -> Vec<u8> {
    if let Some(object) = input.as_object_mut() {
        object.remove("tool_response");
        object.insert(HOST_KEY.into(), host_info());
    }
    cap_strings(&mut input);
    serde_json::to_vec(&json!({ "event": event, "input": input })).unwrap_or_default()
}

fn cap_strings(value: &mut Value) {
    match value {
        Value::String(s) => truncate_bytes(s, MAX_STRING_BYTES),
        Value::Array(items) => items.iter_mut().for_each(cap_strings),
        Value::Object(map) => map.values_mut().for_each(cap_strings),
        _ => {}
    }
}

/// Coupe à `max` octets au plus, sur une frontière de caractère.
fn truncate_bytes(s: &mut String, max: usize) {
    if s.len() > max {
        let mut end = max;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
    }
}

/// POST HTTP/1.1 écrit à la main ; `None` à la moindre erreur ou à l'échéance.
fn post(relay: &Relay, body: &[u8], read_deadline: Instant) -> Option<(u16, Vec<u8>)> {
    let addr = SocketAddr::from(([127, 0, 0, 1], relay.port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok()?;
    let _ = stream.set_nodelay(true);
    stream.set_write_timeout(Some(WRITE_TIMEOUT)).ok()?;
    let head = format!(
        "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        relay.port,
        relay.token,
        body.len()
    );
    stream.write_all(head.as_bytes()).ok()?;
    stream.write_all(body).ok()?;
    stream.flush().ok()?;

    let mut response = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let remaining = read_deadline.checked_duration_since(Instant::now())?;
        if remaining.is_zero() {
            return None;
        }
        stream.set_read_timeout(Some(remaining)).ok()?;
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                response.extend_from_slice(&buf[..n]);
                if response.len() > MAX_RESPONSE_BYTES {
                    return None;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return None,
        }
    }
    parse_response(&response)
}

/// `(code HTTP, corps)` d'une réponse complète.
fn parse_response(bytes: &[u8]) -> Option<(u16, Vec<u8>)> {
    let split = bytes.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&bytes[..split]).ok()?;
    let status_line = head.lines().next()?;
    let mut parts = status_line.split_whitespace();
    if !parts.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let status = parts.next()?.parse().ok()?;
    Some((status, bytes[split + 4..].to_vec()))
}

/// Ce que le relais imprime sur stdout : seulement une décision allow / deny à un PermissionRequest
/// (l'app répond `{ "behavior": "allow" }`, `{ "behavior": "deny", "message"? }`, ou `{}` sans décision).
#[cfg(test)]
fn decide_output(event: &str, status: u16, body: &[u8]) -> Option<String> {
    decide_output_for(event, status, body, None)
}

/// Comme `decide_output`. Question à choix (`AskUserQuestion`) : l'app joint `answers` à « allow » ; on
/// renvoie alors `updatedInput` = entrée de l'outil + `answers` (texte de la question → choix), que Claude
/// Code prend comme réponse sans afficher sa question.
fn decide_output_for(event: &str, status: u16, body: &[u8], tool_input: Option<&Value>) -> Option<String> {
    if event != PERMISSION_EVENT || status != 200 {
        return None;
    }
    let answer: Value = serde_json::from_slice(body).ok()?;
    let decision = match answer.get("behavior")?.as_str()? {
        "allow" => match (answer.get("answers").filter(|a| a.is_object()), tool_input.and_then(Value::as_object)) {
            (Some(answers), Some(input)) => {
                let mut updated = input.clone();
                updated.insert("answers".into(), answers.clone());
                json!({ "behavior": "allow", "updatedInput": updated })
            }
            _ => json!({ "behavior": "allow" }),
        },
        "deny" => {
            let message = answer
                .get("message")
                .and_then(Value::as_str)
                .filter(|m| !m.trim().is_empty())
                .unwrap_or(DENY_MESSAGE);
            json!({ "behavior": "deny", "message": message, "interrupt": false })
        }
        _ => return None,
    };
    Some(
        json!({
            "hookSpecificOutput": {
                "hookEventName": PERMISSION_EVENT,
                "decision": decision
            }
        })
        .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn allow_and_deny_outputs() {
        let allow = decide_output("PermissionRequest", 200, br#"{"behavior":"allow"}"#).unwrap();
        assert_eq!(
            allow,
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        let deny = decide_output("PermissionRequest", 200, br#"{"behavior":"deny"}"#).unwrap();
        let deny: Value = serde_json::from_str(&deny).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(
            deny["hookSpecificOutput"]["decision"]["message"],
            DENY_MESSAGE
        );
        assert_eq!(deny["hookSpecificOutput"]["decision"]["interrupt"], false);
        let custom = decide_output(
            "PermissionRequest",
            200,
            br#"{"behavior":"deny","message":"Non"}"#,
        )
        .unwrap();
        assert!(custom.contains(r#""message":"Non""#));
    }

    #[test]
    fn no_output_without_a_decision() {
        assert_eq!(decide_output("PermissionRequest", 200, b"{}"), None);
        assert_eq!(
            decide_output("PermissionRequest", 200, br#"{"behavior":null}"#),
            None
        );
        assert_eq!(
            decide_output("PermissionRequest", 200, br#"{"behavior":"ask"}"#),
            None
        );
        assert_eq!(
            decide_output("PermissionRequest", 200, b"pas du json"),
            None
        );
        assert_eq!(
            decide_output("PermissionRequest", 401, br#"{"behavior":"allow"}"#),
            None
        );
        // Les autres événements n'impriment jamais rien.
        assert_eq!(
            decide_output("PreToolUse", 200, br#"{"behavior":"allow"}"#),
            None
        );
        assert_eq!(decide_output("SessionStart", 200, b"{}"), None);

        // Question à choix : réponses remises dans l'entrée complète de l'outil.
        let input = json!({ "questions": [{ "question": "Quelle approche ?", "options": [{ "label": "Simple" }] }] });
        let out = decide_output_for(
            "PermissionRequest",
            200,
            br#"{"behavior":"allow","answers":{"Quelle approche ?":"Simple"}}"#,
            Some(&input),
        )
        .unwrap();
        let out: Value = serde_json::from_str(&out).unwrap();
        let updated = &out["hookSpecificOutput"]["decision"]["updatedInput"];
        assert_eq!(updated["answers"]["Quelle approche ?"], "Simple");
        assert_eq!(updated["questions"][0]["question"], "Quelle approche ?");
        assert_eq!(out["hookSpecificOutput"]["decision"]["behavior"], "allow");
    }

    #[test]
    fn relay_file_parsing() {
        assert_eq!(
            parse_relay(br#"{"port":4321,"token":"ab12"}"#),
            Some(Relay {
                port: 4321,
                token: "ab12".into()
            })
        );
        assert_eq!(parse_relay(br#"{"port":0,"token":"ab"}"#), None);
        assert_eq!(parse_relay(br#"{"port":70000,"token":"ab"}"#), None);
        assert_eq!(parse_relay(br#"{"port":1,"token":"a\r\nX: y"}"#), None);
        assert_eq!(parse_relay(br#"{"port":1}"#), None);
        assert_eq!(parse_relay(b""), None);
    }

    #[test]
    fn response_parsing() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(parse_response(raw), Some((200, b"{}".to_vec())));
        assert_eq!(
            parse_response(b"HTTP/1.1 401 Unauthorized\r\n\r\n"),
            Some((401, vec![]))
        );
        assert_eq!(parse_response(b"HTTP/1.1 200 OK\r\n"), None);
        assert_eq!(parse_response(b"garbage\r\n\r\n"), None);
    }

    #[test]
    fn body_is_slimmed() {
        let long = "é".repeat(3000); // 6000 octets
        let body = request_body(
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "content": long }, "tool_response": { "x": 1 } }),
        );
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["event"], "PostToolUse");
        assert!(value["input"].get("tool_response").is_none());
        let content = value["input"]["tool_input"]["content"].as_str().unwrap();
        assert!(content.len() <= MAX_STRING_BYTES && content.len() >= MAX_STRING_BYTES - 1);
    }

    #[test]
    fn event_names() {
        assert!(is_event_name("PermissionRequest"));
        assert!(!is_event_name(""));
        assert!(!is_event_name("Pre Tool"));
        assert!(!is_event_name("../x"));
    }

    #[test]
    fn app_absent_returns_fast() {
        // Port fermé : on lie puis on libère un port.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let relay = Relay {
            port,
            token: "ab".into(),
        };
        let start = Instant::now();
        let result = post(&relay, b"{}", Instant::now() + EVENT_DEADLINE);
        assert!(result.is_none());
        assert!(start.elapsed() < Duration::from_millis(400));
    }

    #[test]
    fn round_trip_with_a_fake_app() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 8192];
            let mut got = Vec::new();
            // Lit jusqu'à la fin du corps (petite requête).
            while !got.windows(4).any(|w| w == b"\r\n\r\n") || !got.ends_with(b"}") {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                got.extend_from_slice(&buf[..n]);
            }
            let text = String::from_utf8(got).unwrap();
            assert!(text.starts_with("POST /hook HTTP/1.1\r\n"));
            assert!(text.contains("Authorization: Bearer beef\r\n"));
            let body = r#"{"behavior":"allow"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        let relay = Relay {
            port,
            token: "beef".into(),
        };
        let body = request_body("PermissionRequest", json!({ "session_id": "s" }));
        let (status, response) =
            post(&relay, &body, Instant::now() + Duration::from_secs(5)).unwrap();
        server.join().unwrap();
        assert!(decide_output("PermissionRequest", status, &response)
            .unwrap()
            .contains("allow"));
    }
}
