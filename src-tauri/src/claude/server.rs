//! Serveur local du relais : HTTP/1.1 minimal sur 127.0.0.1 (port aléatoire), un thread par requête.
//!
//! Seule route : `POST /hook` avec `Authorization: Bearer <jeton>` et le corps
//! `{ "event": <ClaudeHookEventName>, "input": <JSON du hook> }` envoyé par `sordulo-hook`.
//! Réponses : `200 {}` (pas de décision) ou, pour PermissionRequest, `200 { "behavior": "allow" }` /
//! `200 { "behavior": "deny", "message": … }` ; `401` mauvais jeton, `400` / `404` / `413` sinon.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::event::{ClaudeDecision, ClaudeHookEventName};
use crate::events::CLAUDE_PERMISSION_TIMEOUT_MS;

const IO_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_HEAD_BYTES: usize = 16 * 1024;
/// Le relais plafonne déjà les chaînes à 2 000 octets.
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
/// Pas de la boucle d'attente d'une décision (vérifie aussi que le relais est toujours là).
const WAIT_STEP: Duration = Duration::from_millis(500);

/// Demandes d'autorisation en attente : requestId → canal vers le thread qui tient la connexion du relais.
#[derive(Default)]
pub struct Pending {
    map: Mutex<HashMap<String, Sender<ClaudeDecision>>>,
    /// Réponses aux questions d'un `AskUserQuestion` (texte de la question → choix), jointes à « allow ».
    answers: Mutex<HashMap<String, Value>>,
}

/// Retire la demande de la liste quand le thread qui l'attend se termine (réponse, délai, abandon,
/// panic) : pas de demande orpheline.
pub struct PendingGuard<'a> {
    pending: &'a Pending,
    id: String,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.pending.lock().remove(&self.id);
        self.pending.answers_lock().remove(&self.id);
    }
}

impl Pending {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Sender<ClaudeDecision>>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn register(&self, id: String) -> (Receiver<ClaudeDecision>, PendingGuard<'_>) {
        let (sender, receiver) = mpsc::channel();
        self.lock().insert(id.clone(), sender);
        (receiver, PendingGuard { pending: self, id })
    }

    fn answers_lock(&self) -> MutexGuard<'_, HashMap<String, Value>> {
        self.answers.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Transmet la décision ; `false` si la demande n'attend plus (délai dépassé, relais parti).
    #[cfg(test)]
    fn answer(&self, id: &str, decision: ClaudeDecision) -> bool {
        self.answer_with(id, decision, None)
    }

    /// Comme `answer`, avec les réponses aux questions (`{ "<question>": "<choix>" }`) jointes à « allow ».
    pub fn answer_with(&self, id: &str, decision: ClaudeDecision, answers: Option<Value>) -> bool {
        let sender = self.lock().get(id).cloned();
        let Some(sender) = sender else {
            return false;
        };
        if let Some(answers) = answers.filter(|a| a.is_object()) {
            self.answers_lock().insert(id.to_owned(), answers);
        }
        sender.send(decision).is_ok()
    }

    fn take_answers(&self, id: &str) -> Option<Value> {
        self.answers_lock().remove(id)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

/// Hook reçu : (événement, JSON du hook, requestId pour PermissionRequest et PermissionCancelled).
/// PermissionCancelled reprend le JSON de la demande annulée.
pub type OnHook = dyn Fn(ClaudeHookEventName, &Value, Option<String>) + Send + Sync;

/// Ce dont le serveur a besoin, sans dépendre de Tauri (testable).
pub struct Relay {
    pub token: String,
    pub pending: Arc<Pending>,
    pub new_request_id: fn() -> String,
    pub on_hook: Box<OnHook>,
    /// Attente maximale d'une décision (`CLAUDE_PERMISSION_TIMEOUT_MS`).
    pub permission_timeout: Duration,
}

impl Relay {
    pub fn new(
        token: String,
        pending: Arc<Pending>,
        new_request_id: fn() -> String,
        on_hook: Box<OnHook>,
    ) -> Self {
        Self {
            token,
            pending,
            new_request_id,
            on_hook,
            permission_timeout: Duration::from_millis(CLAUDE_PERMISSION_TIMEOUT_MS),
        }
    }
}

/// Ouvre l'écoute et lance le thread d'acceptation. Rend le port choisi par le système.
pub fn spawn(relay: Arc<Relay>) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    std::thread::Builder::new()
        .name("claude-relay".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let relay = relay.clone();
                        let spawned = std::thread::Builder::new()
                            .name("claude-hook".into())
                            .spawn(move || handle(&relay, stream));
                        if let Err(e) = spawned {
                            log::warn!("relais Claude : thread impossible : {e}");
                        }
                    }
                    Err(e) => log::warn!("relais Claude : connexion refusée : {e}"),
                }
            }
        })?;
    Ok(port)
}

/// En-tête d'une requête.
#[derive(Debug, PartialEq, Eq)]
pub struct RequestHead {
    pub method: String,
    pub path: String,
    pub bearer: Option<String>,
    pub content_length: usize,
}

/// Analyse la ligne de requête et les en-têtes (sans le `\r\n\r\n` final).
pub fn parse_head(head: &str) -> Option<RequestHead> {
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next()?.split(' ');
    let method = request_line.next()?.to_string();
    let path = request_line.next()?.to_string();
    if !request_line.next()?.starts_with("HTTP/1.") {
        return None;
    }
    let mut bearer = None;
    let mut content_length = 0;
    for line in lines {
        let (name, value) = line.split_once(':')?;
        let value = value.trim();
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.parse().ok()?;
        } else if name.eq_ignore_ascii_case("authorization") {
            bearer = value.strip_prefix("Bearer ").map(|t| t.trim().to_string());
        }
    }
    Some(RequestHead {
        method,
        path,
        bearer,
        content_length,
    })
}

/// Comparaison en temps constant (longueurs connues : le jeton fait toujours 64 caractères).
pub fn same_token(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Lit une requête complète ; en cas d'erreur, rend le code HTTP à renvoyer.
fn read_request(stream: &mut TcpStream) -> Result<(RequestHead, Vec<u8>), u16> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEAD_BYTES {
            return Err(400);
        }
        match stream.read(&mut chunk) {
            Ok(0) => return Err(400),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return Err(400),
        }
    };
    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| 400u16)?;
    let head = parse_head(head).ok_or(400u16)?;
    if head.content_length > MAX_BODY_BYTES {
        return Err(413);
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < head.content_length {
        match stream.read(&mut chunk) {
            Ok(0) => return Err(400),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return Err(400),
        }
    }
    body.truncate(head.content_length);
    Ok((head, body))
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Comme `decision_body`, avec les réponses aux questions jointes à « allow » (`answers`), que le relais
/// remet dans `updatedInput` pour Claude Code.
pub fn decision_body_with(decision: Option<ClaudeDecision>, answers: Option<Value>) -> String {
    match (decision, answers) {
        (Some(ClaudeDecision::Allow), Some(answers)) => {
            json!({ "behavior": "allow", "answers": answers }).to_string()
        }
        (decision, _) => decision_body(decision),
    }
}

/// Corps de la réponse au relais pour une décision (`None` = pas de décision).
pub fn decision_body(decision: Option<ClaudeDecision>) -> String {
    match decision {
        Some(ClaudeDecision::Allow) => json!({ "behavior": "allow" }).to_string(),
        Some(ClaudeDecision::Deny) => {
            json!({ "behavior": "deny", "message": "Refusé depuis Sordulo OS" }).to_string()
        }
        Some(ClaudeDecision::Later) | None => "{}".to_string(),
    }
}

fn handle(relay: &Relay, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let (head, body) = match read_request(&mut stream) {
        Ok(request) => request,
        Err(status) => return respond(&mut stream, status, "{}"),
    };
    if head.method != "POST" || head.path != "/hook" {
        return respond(&mut stream, 404, "{}");
    }
    let authorized = head
        .bearer
        .as_deref()
        .is_some_and(|t| same_token(t.as_bytes(), relay.token.as_bytes()));
    if !authorized {
        log::warn!("relais Claude : requête refusée (jeton absent ou invalide)");
        return respond(&mut stream, 401, "{}");
    }
    let Ok(request) = serde_json::from_slice::<Value>(&body) else {
        return respond(&mut stream, 400, "{}");
    };
    let Some(event) = request
        .get("event")
        .and_then(Value::as_str)
        .and_then(ClaudeHookEventName::parse)
    else {
        return respond(&mut stream, 400, "{}");
    };
    let input = request.get("input").cloned().unwrap_or(Value::Null);

    if event != ClaudeHookEventName::PermissionRequest {
        // Rendre la main au relais d'abord, puis prévenir l'île.
        respond(&mut stream, 200, "{}");
        (relay.on_hook)(event, &input, None);
        return;
    }

    // PermissionRequest : la connexion reste ouverte jusqu'à la réponse de l'île (10 min au plus).
    let request_id = (relay.new_request_id)();
    let (receiver, pending) = relay.pending.register(request_id.clone());
    (relay.on_hook)(event, &input, Some(request_id.clone()));
    let outcome = wait_for_decision(&receiver, &stream, relay.permission_timeout);
    // Retirer la demande de la liste avant de prévenir l'île (le garde le ferait aussi en cas de panic).
    drop(pending);
    match outcome {
        Outcome::Answered(decision) => {
            let answers = relay.pending.take_answers(&request_id);
            respond(&mut stream, 200, &decision_body_with(Some(decision), answers));
        }
        Outcome::TimedOut => {
            log::info!(
                "relais Claude : demande {request_id} sans réponse, main rendue au terminal"
            );
            respond(&mut stream, 200, &decision_body(None));
            cancel(relay, &input, request_id);
        }
        Outcome::Abandoned => {
            log::info!("relais Claude : demande {request_id} abandonnée par Claude Code");
            cancel(relay, &input, request_id);
        }
    }
}

/// Fin d'une demande d'autorisation en attente.
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// L'île a répondu avec `claude_answer` (allow / deny / later).
    Answered(ClaudeDecision),
    /// Délai écoulé sans réponse.
    TimedOut,
    /// Le relais a raccroché (Claude Code est passé à autre chose).
    Abandoned,
}

fn wait_for_decision(
    receiver: &Receiver<ClaudeDecision>,
    stream: &TcpStream,
    timeout: Duration,
) -> Outcome {
    let deadline = Instant::now() + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Outcome::TimedOut;
        }
        match receiver.recv_timeout(WAIT_STEP.min(deadline - now)) {
            Ok(decision) => return Outcome::Answered(decision),
            Err(RecvTimeoutError::Timeout) => {
                if peer_closed(stream) {
                    return Outcome::Abandoned;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return Outcome::TimedOut,
        }
    }
}

/// `PermissionCancelled` à l'île : la demande s'est terminée sans réponse de sa part.
fn cancel(relay: &Relay, input: &Value, request_id: String) {
    (relay.on_hook)(
        ClaudeHookEventName::PermissionCancelled,
        input,
        Some(request_id),
    );
}

/// Le relais a fermé la connexion (hook tué, Claude Code arrêté) ?
fn peer_closed(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let mut byte = [0u8; 1];
    let closed = match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) if e.kind() == ErrorKind::WouldBlock => false,
        Err(_) => true,
    };
    let _ = stream.set_nonblocking(false);
    closed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_relay_requests() {
        let head = parse_head(
            "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:5\r\nauthorization: Bearer abc\r\nContent-Length: 12\r\nConnection: close",
        )
        .unwrap();
        assert_eq!(
            head,
            RequestHead {
                method: "POST".into(),
                path: "/hook".into(),
                bearer: Some("abc".into()),
                content_length: 12
            }
        );
        let anonymous = parse_head("GET / HTTP/1.1\r\nHost: x").unwrap();
        assert_eq!(anonymous.bearer, None);
        assert_eq!(anonymous.content_length, 0);
        assert!(parse_head("POST /hook\r\n").is_none());
        assert!(parse_head("POST /hook HTTP/1.1\r\nContent-Length: abc").is_none());
        assert!(parse_head("POST /hook HTTP/1.1\r\nsans deux points").is_none());
    }

    #[test]
    fn token_comparison() {
        assert!(same_token(b"abcd", b"abcd"));
        assert!(!same_token(b"abcd", b"abce"));
        assert!(!same_token(b"abcd", b"abc"));
        assert!(!same_token(b"", b"a"));
    }

    #[test]
    fn decision_bodies_match_the_relay() {
        assert_eq!(
            decision_body(Some(ClaudeDecision::Allow)),
            r#"{"behavior":"allow"}"#
        );
        let deny: Value = serde_json::from_str(&decision_body(Some(ClaudeDecision::Deny))).unwrap();
        assert_eq!(deny["behavior"], "deny");
        assert_eq!(decision_body(Some(ClaudeDecision::Later)), "{}");
        let answered: Value = serde_json::from_str(&decision_body_with(
            Some(ClaudeDecision::Allow),
            Some(json!({ "Quelle approche ?": "Simple" })),
        ))
        .unwrap();
        assert_eq!(answered["answers"]["Quelle approche ?"], "Simple");
        // Pas de réponses jointes à un refus.
        let deny: Value = serde_json::from_str(&decision_body_with(
            Some(ClaudeDecision::Deny),
            Some(json!({ "q": "a" })),
        ))
        .unwrap();
        assert!(deny.get("answers").is_none());
        assert_eq!(decision_body(None), "{}");
    }

    // --- Serveur réel sur 127.0.0.1, sans Tauri ---

    use std::sync::mpsc::Receiver as Rx;

    type Seen = (ClaudeHookEventName, Value, Option<String>);

    fn start(timeout: Duration) -> (u16, Arc<Pending>, Rx<Seen>) {
        let (tx, rx) = mpsc::channel::<Seen>();
        let tx = Mutex::new(tx);
        let pending = Arc::new(Pending::default());
        let mut relay = Relay::new(
            "cafe".into(),
            pending.clone(),
            || "req".to_string(),
            Box::new(move |event, input, id| {
                let _ = tx.lock().unwrap().send((event, input.clone(), id));
            }),
        );
        relay.permission_timeout = timeout;
        let port = spawn(Arc::new(relay)).unwrap();
        (port, pending, rx)
    }

    fn post(port: u16, token: &str, body: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "POST /hook HTTP/1.1\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        let status = head.split(' ').nth(1).unwrap().parse().unwrap();
        (status, body.to_string())
    }

    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn refuses_bad_tokens_and_bad_requests() {
        let (port, _, rx) = start(WAIT);
        assert_eq!(post(port, "beef", r#"{"event":"Stop","input":{}}"#).0, 401);
        assert_eq!(post(port, "", r#"{"event":"Stop","input":{}}"#).0, 401);
        assert_eq!(
            post(port, "cafe", r#"{"event":"Inconnu","input":{}}"#).0,
            400
        );
        assert_eq!(post(port, "cafe", "pas du json").0, 400);
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn relays_information_events() {
        let (port, _, rx) = start(WAIT);
        let (status, body) = post(
            port,
            "cafe",
            r#"{"event":"PreToolUse","input":{"session_id":"s","tool_name":"Bash"}}"#,
        );
        assert_eq!((status, body.as_str()), (200, "{}"));
        let (event, input, id) = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(event, ClaudeHookEventName::PreToolUse);
        assert_eq!(input["session_id"], "s");
        assert_eq!(id, None);
    }

    #[test]
    fn permission_request_waits_for_the_island() {
        let (port, pending, rx) = start(WAIT);
        let island = std::thread::spawn(move || {
            let (event, _, id) = rx.recv_timeout(WAIT).unwrap();
            assert_eq!(event, ClaudeHookEventName::PermissionRequest);
            assert!(pending.answer(&id.unwrap(), ClaudeDecision::Allow));
            (pending, rx)
        });
        let (status, body) = post(
            port,
            "cafe",
            r#"{"event":"PermissionRequest","input":{"session_id":"s"}}"#,
        );
        assert_eq!((status, body.as_str()), (200, r#"{"behavior":"allow"}"#));
        let (pending, rx) = island.join().unwrap();
        // La demande est retirée après la réponse ; une seconde réponse est refusée.
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(pending.len(), 0);
        assert!(!pending.answer("req", ClaudeDecision::Deny));
        // Réponse de l'île : pas d'annulation.
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn later_gives_no_decision_and_no_cancellation() {
        let (port, pending, rx) = start(WAIT);
        let island = std::thread::spawn(move || {
            let (_, _, id) = rx.recv_timeout(WAIT).unwrap();
            assert!(pending.answer(&id.unwrap(), ClaudeDecision::Later));
            rx
        });
        let body = r#"{"event":"PermissionRequest","input":{}}"#;
        assert_eq!(post(port, "cafe", body), (200, "{}".to_string()));
        let rx = island.join().unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn timeout_gives_no_decision_and_cancels() {
        let (port, pending, rx) = start(Duration::from_millis(300));
        let body = r#"{"event":"PermissionRequest","input":{"session_id":"s","cwd":"C:\\x","tool_name":"Bash"}}"#;
        let started = Instant::now();
        assert_eq!(post(port, "cafe", body), (200, "{}".to_string()));
        assert!(started.elapsed() < Duration::from_secs(2));

        let (event, _, id) = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(event, ClaudeHookEventName::PermissionRequest);
        assert_eq!(id.as_deref(), Some("req"));
        let (event, input, id) = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(event, ClaudeHookEventName::PermissionCancelled);
        assert_eq!(id.as_deref(), Some("req"));
        assert_eq!(input["session_id"], "s");
        assert_eq!(input["tool_name"], "Bash");
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn abandoned_request_is_cleaned_up() {
        let (port, pending, rx) = start(WAIT);
        let body = r#"{"event":"PermissionRequest","input":{}}"#;
        {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(
                stream,
                "POST /hook HTTP/1.1\r\nAuthorization: Bearer cafe\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            rx.recv_timeout(WAIT).unwrap();
            assert_eq!(pending.len(), 1);
        } // Le relais disparaît (connexion fermée).
          // Annulation émise, demande retirée de la liste.
        let (event, _, id) = rx.recv_timeout(Duration::from_secs(3)).unwrap();
        assert_eq!(event, ClaudeHookEventName::PermissionCancelled);
        assert_eq!(id.as_deref(), Some("req"));
        assert_eq!(pending.len(), 0);
    }
}
