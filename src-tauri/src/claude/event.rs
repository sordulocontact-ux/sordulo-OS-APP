//! Types du contrat Claude (`ClaudeHookEventName`, `ClaudeRelayEvent`, `ClaudeConnection`, `ClaudeDecision`
//! de `src/shared/desktop-contract.ts`) et construction d'un `ClaudeRelayEvent` depuis le JSON d'un hook.
//!
//! Fonctions pures, sauf `git_branch` qui lit `.git/HEAD` (sans lancer git).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Longueur maximale (caractères) du résumé d'un outil.
const SUMMARY_MAX_CHARS: usize = 120;
/// Début du prompt gardé pour UserPromptSubmit.
const PROMPT_MAX_CHARS: usize = 80;
/// Message d'une Notification.
const NOTIFICATION_MAX_CHARS: usize = 200;
/// Raison de Stop / SubagentStop / SessionEnd.
const REASON_MAX_CHARS: usize = 80;

/// `ClaudeHookEventName` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaudeHookEventName {
    SessionStart,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    PermissionRequest,
    Notification,
    Stop,
    SubagentStop,
    SessionEnd,
    /// Émis par l'app, pas par un hook : un PermissionRequest en attente s'est terminé sans réponse de
    /// l'île (délai de 10 min écoulé, ou relais qui a raccroché). Porte le requestId de la demande.
    PermissionCancelled,
}

impl ClaudeHookEventName {
    /// Les 9 hooks installés dans `~/.claude/settings.json`, dans cet ordre (sans PermissionCancelled,
    /// que le relais ne peut donc pas envoyer).
    pub const ALL: [Self; 9] = [
        Self::SessionStart,
        Self::UserPromptSubmit,
        Self::PreToolUse,
        Self::PostToolUse,
        Self::PermissionRequest,
        Self::Notification,
        Self::Stop,
        Self::SubagentStop,
        Self::SessionEnd,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SessionStart => "SessionStart",
            Self::UserPromptSubmit => "UserPromptSubmit",
            Self::PreToolUse => "PreToolUse",
            Self::PostToolUse => "PostToolUse",
            Self::PermissionRequest => "PermissionRequest",
            Self::Notification => "Notification",
            Self::Stop => "Stop",
            Self::SubagentStop => "SubagentStop",
            Self::SessionEnd => "SessionEnd",
            Self::PermissionCancelled => "PermissionCancelled",
        }
    }

    /// Nom d'un des 9 hooks (jamais PermissionCancelled).
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|e| e.as_str() == name)
    }
}

/// `ClaudeRelayEvent` du contrat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRelayEvent {
    pub event: ClaudeHookEventName,
    pub session_id: String,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub tool_name: Option<String>,
    pub tool_summary: Option<String>,
    pub file_path: Option<String>,
    pub request_id: Option<String>,
    pub message: Option<String>,
    /// PermissionRequest de l'outil `AskUserQuestion` : les questions et leurs choix, pour répondre
    /// depuis l'île. Absent pour tout le reste.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<ClaudeQuestion>>,
    /// Shell ou sous-agent lancé en arrière-plan (`tool_input.run_in_background`) : Claude finira son tour
    /// mais patientera. Absent (faux) pour tout le reste.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub background: bool,
    /// Epoch Unix en ms.
    pub at: u64,
}

/// `ClaudeQuestion` du contrat : une question de Claude à choix (outil `AskUserQuestion`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeQuestion {
    /// Texte de la question : clé de la réponse renvoyée à Claude Code.
    pub question: String,
    /// Étiquette courte (« Approche », « Format »).
    pub header: Option<String>,
    pub multi_select: bool,
    pub options: Vec<ClaudeQuestionOption>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeQuestionOption {
    pub label: String,
    pub description: Option<String>,
}

/// Outil de Claude Code qui pose des questions à choix.
pub const ASK_USER_QUESTION: &str = "AskUserQuestion";
/// Au plus 4 questions de 4 choix (limites de l'outil), avec une marge.
const MAX_QUESTIONS: usize = 4;
const MAX_OPTIONS: usize = 6;
const QUESTION_MAX_CHARS: usize = 300;
const OPTION_MAX_CHARS: usize = 120;

/// Questions d'un `AskUserQuestion` (`tool_input.questions`), `None` si absentes ou illisibles.
pub fn questions_of(tool_input: &Value) -> Option<Vec<ClaudeQuestion>> {
    let questions: Vec<ClaudeQuestion> = tool_input
        .get("questions")?
        .as_array()?
        .iter()
        .take(MAX_QUESTIONS)
        .filter_map(|q| {
            // Le texte exact sert de clé à la réponse : jamais tronqué.
            let question = q.get("question")?.as_str()?.trim().to_owned();
            if question.is_empty() || question.chars().count() > QUESTION_MAX_CHARS * 4 {
                return None;
            }
            let options: Vec<ClaudeQuestionOption> = q
                .get("options")?
                .as_array()?
                .iter()
                .take(MAX_OPTIONS)
                .filter_map(|o| {
                    let label = o.get("label")?.as_str()?.trim().to_owned();
                    (!label.is_empty()).then(|| ClaudeQuestionOption {
                        label,
                        description: str_field(o, "description")
                            .map(|d| shorten(&one_line(&d), OPTION_MAX_CHARS)),
                    })
                })
                .collect();
            (!options.is_empty()).then(|| ClaudeQuestion {
                question,
                header: str_field(q, "header").map(|h| shorten(&one_line(&h), OPTION_MAX_CHARS)),
                multi_select: q.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                options,
            })
        })
        .collect();
    (!questions.is_empty()).then_some(questions)
}

/// `ClaudeConnection` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeConnection {
    pub connected: bool,
    pub last_event_at: Option<u64>,
}

/// `ClaudeDecision` du contrat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaudeDecision {
    Allow,
    Deny,
    Later,
}

/// Construit l'événement envoyé à l'île. `branch` est calculée à part (`git_branch`) pour rester pur.
pub fn build_event(
    event: ClaudeHookEventName,
    input: &Value,
    at: u64,
    branch: Option<String>,
    request_id: Option<String>,
) -> ClaudeRelayEvent {
    let cwd = str_field(input, "cwd");
    let tool_name = str_field(input, "tool_name");
    let empty = Value::Null;
    let tool_input = input.get("tool_input").unwrap_or(&empty);
    let (tool_summary, file_path) = match tool_name.as_deref() {
        // Annulation : seulement de quoi retrouver la demande (session, outil, requestId).
        _ if event == ClaudeHookEventName::PermissionCancelled => (None, None),
        Some(tool) => (
            tool_summary(tool, tool_input, cwd.as_deref()),
            written_file(tool, tool_input, cwd.as_deref()),
        ),
        None => (None, None),
    };
    let message = match event {
        ClaudeHookEventName::Notification => {
            str_field(input, "message").map(|m| shorten(&one_line(&m), NOTIFICATION_MAX_CHARS))
        }
        ClaudeHookEventName::UserPromptSubmit => {
            str_field(input, "prompt").map(|p| shorten(&one_line(&p), PROMPT_MAX_CHARS))
        }
        ClaudeHookEventName::Stop
        | ClaudeHookEventName::SubagentStop
        | ClaudeHookEventName::SessionEnd => {
            str_field(input, "reason").map(|r| shorten(&one_line(&r), REASON_MAX_CHARS))
        }
        _ => None,
    };
    let questions = match (event, tool_name.as_deref()) {
        (ClaudeHookEventName::PermissionRequest, Some(ASK_USER_QUESTION)) => questions_of(tool_input),
        _ => None,
    };
    let background = event != ClaudeHookEventName::PermissionCancelled
        && tool_name.as_deref().is_some_and(|tool| runs_in_background(tool, tool_input));
    ClaudeRelayEvent {
        event,
        session_id: str_field(input, "session_id").unwrap_or_default(),
        cwd,
        branch,
        tool_name,
        tool_summary,
        file_path,
        request_id,
        message,
        questions,
        background,
        at,
    }
}

/// Outils qui peuvent tourner en arrière-plan : shells et sous-agents.
const BACKGROUND_TOOLS: [&str; 4] = ["Bash", "PowerShell", "Agent", "Task"];

/// L'outil est lancé en arrière-plan (`run_in_background: true`).
pub fn runs_in_background(tool: &str, tool_input: &Value) -> bool {
    BACKGROUND_TOOLS.contains(&tool)
        && tool_input.get("run_in_background").and_then(Value::as_bool).unwrap_or(false)
}

/// Chaîne non vide (après trim) d'un champ.
fn str_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Résumé lisible et court de l'entrée d'un outil : commande, chemin, motif, URL… jamais un contenu.
pub fn tool_summary(tool: &str, input: &Value, cwd: Option<&str>) -> Option<String> {
    let field = |key: &str| str_field(input, key);
    let path = |key: &str| field(key).map(|p| display_path(&p, cwd));
    let summary = match tool {
        "Bash" | "PowerShell" => field("command"),
        "Read" | "Edit" | "Write" | "MultiEdit" => path("file_path"),
        "NotebookEdit" | "NotebookRead" => path("notebook_path"),
        "Grep" => field("pattern").map(|pattern| match path("path") {
            Some(dir) => format!("{pattern} dans {dir}"),
            None => pattern,
        }),
        "Glob" => field("pattern"),
        "LS" => path("path"),
        "WebFetch" => field("url"),
        "WebSearch" => field("query"),
        "Task" | "Agent" => field("description"),
        "Skill" => field("skill").or_else(|| field("command")),
        "TodoWrite" => {
            input
                .get("todos")
                .and_then(Value::as_array)
                .map(|todos| match todos.len() {
                    1 => "1 tâche".to_string(),
                    n => format!("{n} tâches"),
                })
        }
        "AskUserQuestion" => input
            .get("questions")
            .and_then(Value::as_array)
            .and_then(|q| q.first())
            .and_then(|q| str_field(q, "question")),
        // Outils inconnus (MCP…) : premier champ « sûr » trouvé, jamais content / new_string / prompt.
        _ => [
            "command",
            "file_path",
            "notebook_path",
            "path",
            "url",
            "pattern",
            "query",
            "description",
        ]
        .into_iter()
        .find_map(|key| {
            if key.ends_with("path") {
                path(key)
            } else {
                field(key)
            }
        }),
    }?;
    Some(shorten(&one_line(&summary), SUMMARY_MAX_CHARS))
}

/// Chemin absolu du fichier modifié par Edit / Write / MultiEdit / NotebookEdit (conflits entre sessions).
pub fn written_file(tool: &str, input: &Value, cwd: Option<&str>) -> Option<String> {
    let key = match tool {
        "Edit" | "Write" | "MultiEdit" => "file_path",
        "NotebookEdit" => "notebook_path",
        _ => return None,
    };
    let raw = str_field(input, key)?;
    if is_absolute(&raw) {
        return Some(raw);
    }
    match cwd {
        Some(cwd) => Some(PathBuf::from(cwd).join(&raw).to_string_lossy().into_owned()),
        None => Some(raw),
    }
}

/// Absolu au sens Windows (`C:\…`, `\\serveur\…`) ou à la Git Bash / Unix (`/c/…`), quel que soit le
/// système qui exécute (les tests tournent sur Windows et sur macOS).
fn is_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    drive || Path::new(path).is_absolute() || path.starts_with('/') || path.starts_with('\\')
}

/// Chemin relatif au dossier de la session s'il est dedans (avec des `/`), sinon tel quel.
fn display_path(path: &str, cwd: Option<&str>) -> String {
    let normalize = |p: &str| p.replace('\\', "/");
    let full = normalize(path);
    if let Some(cwd) = cwd {
        let base = normalize(cwd);
        let base = base.trim_end_matches('/');
        if !base.is_empty() && full.len() > base.len() {
            let (head, rest) = full.split_at(base.len());
            // Windows : chemins insensibles à la casse.
            if head.eq_ignore_ascii_case(base) && rest.starts_with('/') {
                return rest.trim_start_matches('/').to_string();
            }
        }
    }
    full
}

/// Espaces et sauts de ligne réduits à un seul espace.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Coupe à `max` caractères avec « … ».
fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out = out.trim_end().to_string();
    out.push('…');
    out
}

/// Branche git courante du dossier (ou d'un parent), en lisant `.git/HEAD`. Gère les worktrees et
/// sous-modules (`.git` fichier `gitdir: …`). HEAD détachée : 7 premiers caractères du commit.
pub fn git_branch(cwd: &Path) -> Option<String> {
    for dir in cwd.ancestors() {
        let dot_git = dir.join(".git");
        let Ok(meta) = std::fs::metadata(&dot_git) else {
            continue;
        };
        let git_dir = if meta.is_dir() {
            dot_git
        } else {
            let content = std::fs::read_to_string(&dot_git).ok()?;
            gitdir_from_file(&content, dir)?
        };
        let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
        return branch_from_head(&head);
    }
    None
}

/// `gitdir: <chemin>` d'un fichier `.git` (relatif au dossier qui le contient).
fn gitdir_from_file(content: &str, base: &Path) -> Option<PathBuf> {
    let target = content
        .lines()
        .find_map(|line| line.trim().strip_prefix("gitdir:"))?
        .trim();
    if target.is_empty() {
        return None;
    }
    let path = PathBuf::from(target);
    Some(if path.is_absolute() {
        path
    } else {
        base.join(path)
    })
}

fn branch_from_head(head: &str) -> Option<String> {
    let head = head.trim();
    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return (!branch.is_empty()).then(|| branch.to_string());
    }
    (head.len() >= 7 && head.bytes().all(|b| b.is_ascii_hexdigit())).then(|| head[..7].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CWD: &str = "C:\\Users\\mael\\sordulo-OS";

    fn summary(tool: &str, input: Value) -> Option<String> {
        tool_summary(tool, &input, Some(CWD))
    }

    #[test]
    fn tool_summaries() {
        assert_eq!(
            summary(
                "Bash",
                json!({ "command": "npm run\n  typecheck", "description": "x" })
            ),
            Some("npm run typecheck".into())
        );
        assert_eq!(
            summary(
                "Read",
                json!({ "file_path": "C:\\Users\\mael\\sordulo-OS\\CLAUDE.md" })
            ),
            Some("CLAUDE.md".into())
        );
        assert_eq!(
            summary(
                "Edit",
                json!({ "file_path": "c:\\users\\mael\\sordulo-os\\src\\lib.rs", "old_string": "SECRET", "new_string": "SECRET" })
            ),
            Some("src/lib.rs".into())
        );
        assert_eq!(
            summary(
                "Write",
                json!({ "file_path": "D:\\autre\\a.txt", "content": "SECRET" })
            ),
            Some("D:/autre/a.txt".into())
        );
        assert_eq!(
            summary(
                "Grep",
                json!({ "pattern": "TODO", "path": "C:\\Users\\mael\\sordulo-OS\\src" })
            ),
            Some("TODO dans src".into())
        );
        assert_eq!(
            summary("Glob", json!({ "pattern": "**/*.rs" })),
            Some("**/*.rs".into())
        );
        assert_eq!(
            summary(
                "WebFetch",
                json!({ "url": "https://example.com", "prompt": "x" })
            ),
            Some("https://example.com".into())
        );
        assert_eq!(
            summary("WebSearch", json!({ "query": "tauri" })),
            Some("tauri".into())
        );
        assert_eq!(
            summary(
                "Task",
                json!({ "description": "Explorer", "prompt": "long" })
            ),
            Some("Explorer".into())
        );
        assert_eq!(
            summary("TodoWrite", json!({ "todos": [{}, {}] })),
            Some("2 tâches".into())
        );
        assert_eq!(
            summary("mcp__x__y", json!({ "content": "SECRET", "query": "q" })),
            Some("q".into())
        );
        assert_eq!(summary("mcp__x__y", json!({ "content": "SECRET" })), None);
        assert_eq!(summary("Bash", json!({})), None);
        let long = summary("Bash", json!({ "command": "a".repeat(500) })).unwrap();
        assert_eq!(long.chars().count(), SUMMARY_MAX_CHARS);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn questions_for_the_island() {
        let input = json!({
            "session_id": "s",
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [
                { "question": "Quelle approche ?", "header": "Approche", "multiSelect": false,
                  "options": [ { "label": "Simple", "description": "Rapide" }, { "label": "Complète" }, { "label": " " } ] },
                { "question": "", "options": [ { "label": "x" } ] }
            ] }
        });
        let event = build_event(ClaudeHookEventName::PermissionRequest, &input, 1, None, Some("r".into()));
        let questions = event.questions.unwrap();
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].question, "Quelle approche ?");
        assert_eq!(questions[0].header.as_deref(), Some("Approche"));
        assert_eq!(questions[0].options.len(), 2);
        assert_eq!(questions[0].options[0].description.as_deref(), Some("Rapide"));
        // Pas de questions hors PermissionRequest ni pour un autre outil.
        assert!(build_event(ClaudeHookEventName::PreToolUse, &input, 1, None, None).questions.is_none());
        let bash = json!({ "session_id": "s", "tool_name": "Bash", "tool_input": { "command": "ls" } });
        assert!(build_event(ClaudeHookEventName::PermissionRequest, &bash, 1, None, None).questions.is_none());
    }

    #[test]
    fn written_files_are_absolute() {
        let input = json!({ "file_path": "C:\\a\\b.rs" });
        assert_eq!(
            written_file("Edit", &input, Some(CWD)),
            Some("C:\\a\\b.rs".into())
        );
        assert_eq!(
            written_file("Write", &input, None),
            Some("C:\\a\\b.rs".into())
        );
        assert_eq!(
            written_file("MultiEdit", &input, None),
            Some("C:\\a\\b.rs".into())
        );
        assert_eq!(
            written_file(
                "NotebookEdit",
                &json!({ "notebook_path": "/c/n.ipynb" }),
                Some(CWD)
            ),
            Some("/c/n.ipynb".into())
        );
        let relative =
            written_file("Edit", &json!({ "file_path": "src/a.rs" }), Some(CWD)).unwrap();
        assert!(relative.starts_with(CWD) && relative.ends_with("a.rs"));
        assert_eq!(written_file("Read", &input, Some(CWD)), None);
        assert_eq!(
            written_file("Bash", &json!({ "command": "rm x" }), Some(CWD)),
            None
        );
    }

    #[test]
    fn builds_permission_request() {
        let input = json!({
            "session_id": "abc123",
            "cwd": CWD,
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": { "command": "rm -rf node_modules", "description": "Remove" },
        });
        let event = build_event(
            ClaudeHookEventName::PermissionRequest,
            &input,
            42,
            Some("feature/ile".into()),
            Some("req1".into()),
        );
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(
            json,
            json!({
                "event": "PermissionRequest",
                "sessionId": "abc123",
                "cwd": CWD,
                "branch": "feature/ile",
                "toolName": "Bash",
                "toolSummary": "rm -rf node_modules",
                "filePath": null,
                "requestId": "req1",
                "message": null,
                "at": 42
            })
        );
    }

    #[test]
    fn background_shells_and_subagents() {
        let bash = json!({ "session_id": "s", "tool_name": "Bash",
            "tool_input": { "command": "npm run dev", "run_in_background": true } });
        let event = build_event(ClaudeHookEventName::PreToolUse, &bash, 1, None, None);
        assert!(event.background);
        assert_eq!(serde_json::to_value(&event).unwrap()["background"], json!(true));
        let agent = json!({ "session_id": "s", "tool_name": "Agent",
            "tool_input": { "prompt": "x", "run_in_background": true } });
        assert!(build_event(ClaudeHookEventName::PreToolUse, &agent, 1, None, None).background);
        // Premier plan, autre outil ou annulation : pas d'arrière-plan, et le champ n'est pas envoyé.
        let front = json!({ "session_id": "s", "tool_name": "Bash", "tool_input": { "command": "ls" } });
        let event = build_event(ClaudeHookEventName::PreToolUse, &front, 1, None, None);
        assert!(!event.background);
        assert!(serde_json::to_value(&event).unwrap().get("background").is_none());
        let read = json!({ "session_id": "s", "tool_name": "Read",
            "tool_input": { "file_path": "a", "run_in_background": true } });
        assert!(!build_event(ClaudeHookEventName::PreToolUse, &read, 1, None, None).background);
        assert!(!build_event(ClaudeHookEventName::PermissionCancelled, &bash, 1, None, None).background);
    }

    #[test]
    fn messages_per_event() {
        let prompt =
            json!({ "session_id": "s", "prompt": format!("Corrige  le\nbug {}", "x".repeat(200)) });
        let event = build_event(
            ClaudeHookEventName::UserPromptSubmit,
            &prompt,
            1,
            None,
            None,
        );
        let message = event.message.unwrap();
        assert!(message.starts_with("Corrige le bug x"));
        assert_eq!(message.chars().count(), PROMPT_MAX_CHARS);

        let notification = json!({ "session_id": "s", "message": "Claude attend ta réponse" });
        let event = build_event(
            ClaudeHookEventName::Notification,
            &notification,
            1,
            None,
            None,
        );
        assert_eq!(event.message.as_deref(), Some("Claude attend ta réponse"));

        let end = json!({ "session_id": "s", "reason": "prompt_input_exit" });
        let event = build_event(ClaudeHookEventName::SessionEnd, &end, 1, None, None);
        assert_eq!(event.message.as_deref(), Some("prompt_input_exit"));

        let stop = json!({ "session_id": "s", "stop_hook_active": false, "last_assistant_message": "fini" });
        let event = build_event(ClaudeHookEventName::Stop, &stop, 1, None, None);
        assert_eq!(event.message, None);
        assert_eq!(event.tool_name, None);

        let write = json!({
            "session_id": "s", "cwd": CWD, "tool_name": "Write",
            "tool_input": { "file_path": "C:\\Users\\mael\\sordulo-OS\\a.md", "content": "SECRET" }
        });
        let event = build_event(ClaudeHookEventName::PreToolUse, &write, 1, None, None);
        assert_eq!(event.tool_summary.as_deref(), Some("a.md"));
        assert_eq!(
            event.file_path.as_deref(),
            Some("C:\\Users\\mael\\sordulo-OS\\a.md")
        );
        assert!(!serde_json::to_string(&event).unwrap().contains("SECRET"));
    }

    #[test]
    fn event_names_round_trip() {
        for event in ClaudeHookEventName::ALL {
            assert_eq!(ClaudeHookEventName::parse(event.as_str()), Some(event));
            assert_eq!(serde_json::to_value(event).unwrap(), json!(event.as_str()));
        }
        assert_eq!(ClaudeHookEventName::parse("StopFailure"), None);
        // Réservé à l'app : le relais ne peut pas l'envoyer.
        assert_eq!(ClaudeHookEventName::parse("PermissionCancelled"), None);
        assert!(!ClaudeHookEventName::ALL.contains(&ClaudeHookEventName::PermissionCancelled));
    }

    #[test]
    fn builds_permission_cancelled() {
        let input = json!({
            "session_id": "abc123",
            "cwd": CWD,
            "tool_name": "Write",
            "tool_input": { "file_path": "C:\\Users\\mael\\sordulo-OS\\a.md", "content": "SECRET" },
        });
        let event = build_event(
            ClaudeHookEventName::PermissionCancelled,
            &input,
            7,
            Some("main".into()),
            Some("req1".into()),
        );
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({
                "event": "PermissionCancelled",
                "sessionId": "abc123",
                "cwd": CWD,
                "branch": "main",
                "toolName": "Write",
                "toolSummary": null,
                "filePath": null,
                "requestId": "req1",
                "message": null,
                "at": 7
            })
        );
    }

    #[test]
    fn contract_shapes() {
        assert_eq!(
            serde_json::to_value(ClaudeConnection {
                connected: true,
                last_event_at: None
            })
            .unwrap(),
            json!({ "connected": true, "lastEventAt": null })
        );
        let d: ClaudeDecision = serde_json::from_value(json!("later")).unwrap();
        assert_eq!(d, ClaudeDecision::Later);
        assert!(serde_json::from_value::<ClaudeDecision>(json!("maybe")).is_err());
    }

    #[test]
    fn head_parsing() {
        assert_eq!(
            branch_from_head("ref: refs/heads/feature/ile\n"),
            Some("feature/ile".into())
        );
        assert_eq!(
            branch_from_head("0123456789abcdef0123456789abcdef01234567\n"),
            Some("0123456".into())
        );
        assert_eq!(branch_from_head(""), None);
        assert_eq!(
            gitdir_from_file("gitdir: ../repo/.git/worktrees/w\n", Path::new("/x/w")),
            Some(PathBuf::from("/x/w").join("../repo/.git/worktrees/w"))
        );
    }

    /// Dossier temporaire unique pour un test (supprimé à la fin).
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "sordulo-test-{name}-{}-{}",
                std::process::id(),
                crate::time::now_ms()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_branch_from_repo_and_worktree() {
        let tmp = TempDir::new("git");
        // Dépôt classique, lu depuis un sous-dossier.
        let repo = tmp.0.join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::create_dir_all(repo.join("src/deep")).unwrap();
        std::fs::write(repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(git_branch(&repo.join("src/deep")), Some("main".into()));

        // Worktree : `.git` est un fichier qui pointe vers le dossier du worktree.
        let wt_git = repo.join(".git/worktrees/wt");
        std::fs::create_dir_all(&wt_git).unwrap();
        std::fs::write(wt_git.join("HEAD"), "ref: refs/heads/feature/x\n").unwrap();
        let wt = tmp.0.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), "gitdir: ../repo/.git/worktrees/wt\n").unwrap();
        assert_eq!(git_branch(&wt), Some("feature/x".into()));

        // Hors dépôt.
        let outside = tmp.0.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        // (Le dossier temporaire du système n'est normalement pas dans un dépôt git.)
        if git_branch(&std::env::temp_dir()).is_none() {
            assert_eq!(git_branch(&outside), None);
        }
    }
}
