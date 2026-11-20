//! Installation des hooks dans `~/.claude/settings.json` et copie du relais dans un dossier stable.
//!
//! Fusion (fonctions pures `install_hooks` / `uninstall_hooks`, testées) :
//! - nos entrées sont reconnues à leur commande, qui contient `sordulo-hook` ;
//! - Connecter ajoute, pour chacun des 9 événements, un groupe à la fin du tableau de l'événement ;
//!   un événement qui a déjà exactement notre entrée n'est pas touché (connecter deux fois n'ajoute
//!   rien) ; une ancienne entrée à nous (autre chemin, autre timeout) est remplacée ;
//! - Déconnecter retire seulement nos entrées, puis les groupes, tableaux et l'objet `hooks` devenus
//!   vides À CAUSE de ce retrait (un groupe vide qui existait déjà reste) ;
//! - tous les autres réglages et hooks sont conservés, dans leur ordre (`serde_json/preserve_order`).
//!
//! Écriture (`connect_file` / `disconnect_file`) : fichier absent ou vide = `{}` ; JSON invalide ou
//! racine non objet = refus sans rien écrire ; sauvegarde horodatée (`settings.json.sordulo-bak-…`)
//! avant toute écriture ; écriture atomique (fichier temporaire puis renommage) ; refus si le fichier
//! a changé entre la lecture et l'écriture.
//!
//! Commande écrite (Windows) : `"C:/Users/…/com.sordulo.os/bin/sordulo-hook.exe" PreToolUse`.
//! Claude Code lance les hooks dans Git Bash sous Windows : chemin entre guillemets doubles (espaces)
//! et barres obliques `/` (une `\` est gardée entre guillemets par bash, mais `/` marche aussi dans
//! cmd et PowerShell et évite toute ambiguïté). Les chemins contenant `"`, `$`, `` ` ``, `%` ou un
//! saut de ligne sont refusés (interprétés par bash ou cmd même entre guillemets).

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use super::event::ClaudeHookEventName;
use crate::time::file_timestamp;

/// Ce qui identifie nos entrées dans settings.json.
pub const RELAY_MARKER: &str = "sordulo-hook";
/// Nom du binaire du relais.
pub const RELAY_EXE: &str = if cfg!(windows) {
    "sordulo-hook.exe"
} else {
    "sordulo-hook"
};
/// `timeout` (s) des événements d'information.
const EVENT_TIMEOUT_SECS: u64 = 5;
/// `timeout` (s) de PermissionRequest : au-delà des 60 s d'attente, pour que le relais rende la main lui-même.
const PERMISSION_TIMEOUT_SECS: u64 = 75;

fn timeout_of(event: ClaudeHookEventName) -> u64 {
    match event {
        ClaudeHookEventName::PermissionRequest => PERMISSION_TIMEOUT_SECS,
        _ => EVENT_TIMEOUT_SECS,
    }
}

/// UserPromptSubmit et Stop n'acceptent pas de matcher.
fn has_matcher(event: ClaudeHookEventName) -> bool {
    !matches!(
        event,
        ClaudeHookEventName::UserPromptSubmit | ClaudeHookEventName::Stop
    )
}

/// Chemin du relais tel qu'écrit dans la commande : `"C:/…/sordulo-hook.exe"`.
pub fn quoted_exe(exe: &Path) -> Result<String, String> {
    let text = exe.to_string_lossy().replace('\\', "/");
    if text
        .chars()
        .any(|c| matches!(c, '"' | '$' | '`' | '%' | '\n' | '\r'))
    {
        return Err(format!(
            "Chemin du relais non pris en charge (caractère spécial) : {text}"
        ));
    }
    Ok(format!("\"{text}\""))
}

/// Commande complète d'un événement.
pub fn hook_command(quoted_exe: &str, event: ClaudeHookEventName) -> String {
    format!("{quoted_exe} {}", event.as_str())
}

fn our_hook(quoted_exe: &str, event: ClaudeHookEventName) -> Value {
    json!({
        "type": "command",
        "command": hook_command(quoted_exe, event),
        "timeout": timeout_of(event),
    })
}

fn our_group(quoted_exe: &str, event: ClaudeHookEventName) -> Value {
    let hook = our_hook(quoted_exe, event);
    if has_matcher(event) {
        json!({ "matcher": "*", "hooks": [hook] })
    } else {
        json!({ "hooks": [hook] })
    }
}

/// Une entrée de hook à nous (commande qui contient `sordulo-hook`).
pub fn is_ours(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(RELAY_MARKER))
}

/// Contenu de settings.json → objet JSON. Vide = `{}` ; invalide ou non objet = erreur.
pub fn parse_settings(text: &str) -> Result<Value, String> {
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let value: Value = serde_json::from_str(text)
        .map_err(|e| format!("~/.claude/settings.json n'est pas un JSON valide ({e})."))?;
    if !value.is_object() {
        return Err("~/.claude/settings.json ne contient pas un objet JSON.".into());
    }
    Ok(value)
}

/// Nos 9 hooks sont présents.
pub fn is_connected(settings: &Value) -> bool {
    let Some(hooks) = settings.get("hooks").and_then(Value::as_object) else {
        return false;
    };
    ClaudeHookEventName::ALL.iter().all(|event| {
        hooks
            .get(event.as_str())
            .and_then(Value::as_array)
            .is_some_and(|groups| groups.iter().any(|g| group_hooks(g).iter().any(is_ours)))
    })
}

fn group_hooks(group: &Value) -> &[Value] {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// Retire nos entrées d'un tableau de groupes ; supprime les groupes vidés par ce retrait.
/// Rend `true` si quelque chose a été retiré.
fn remove_ours(groups: &mut Vec<Value>) -> bool {
    let mut changed = false;
    groups.retain_mut(|group| {
        let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
            return true;
        };
        let before = list.len();
        list.retain(|hook| !is_ours(hook));
        if list.len() == before {
            return true;
        }
        changed = true;
        !list.is_empty()
    });
    changed
}

/// Ajoute nos 9 hooks (idempotent). Rend `true` si `settings` a changé.
pub fn install_hooks(settings: &mut Value, quoted_exe: &str) -> Result<bool, String> {
    let root = settings
        .as_object_mut()
        .ok_or("~/.claude/settings.json ne contient pas un objet JSON.")?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("La clé « hooks » de ~/.claude/settings.json n'est pas un objet : rien n'a été modifié.")?;
    // Vérifier tous les événements avant de modifier quoi que ce soit.
    for event in ClaudeHookEventName::ALL {
        if hooks.get(event.as_str()).is_some_and(|v| !v.is_array()) {
            return Err(format!(
                "La clé « hooks.{} » de ~/.claude/settings.json n'est pas un tableau : rien n'a été modifié.",
                event.as_str()
            ));
        }
    }
    let mut changed = false;
    for event in ClaudeHookEventName::ALL {
        let wanted = our_hook(quoted_exe, event);
        let groups = hooks
            .entry(event.as_str())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .expect("vérifié plus haut");
        let ours: Vec<&Value> = groups
            .iter()
            .flat_map(group_hooks)
            .filter(|h| is_ours(h))
            .collect();
        if ours.len() == 1 && *ours[0] == wanted {
            continue;
        }
        remove_ours(groups);
        groups.push(our_group(quoted_exe, event));
        changed = true;
    }
    Ok(changed)
}

/// Retire nos hooks de tous les événements. Rend `true` si `settings` a changé.
pub fn uninstall_hooks(settings: &mut Value) -> Result<bool, String> {
    let Some(root) = settings.as_object_mut() else {
        return Err("~/.claude/settings.json ne contient pas un objet JSON.".into());
    };
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else {
        return Ok(false);
    };
    let mut changed = false;
    let mut emptied = Vec::new();
    for (event, value) in hooks.iter_mut() {
        if let Some(groups) = value.as_array_mut() {
            if remove_ours(groups) {
                changed = true;
                if groups.is_empty() {
                    emptied.push(event.clone());
                }
            }
        }
    }
    for event in &emptied {
        hooks.shift_remove(event);
    }
    if !emptied.is_empty() && hooks.is_empty() {
        root.shift_remove("hooks");
    }
    Ok(changed)
}

/// Texte écrit : JSON indenté de 2 espaces, saut de ligne final.
fn render(settings: &Value) -> Result<String, String> {
    serde_json::to_string_pretty(settings)
        .map(|mut s| {
            s.push('\n');
            s
        })
        .map_err(|e| format!("Impossible de préparer ~/.claude/settings.json : {e}"))
}

/// Lit le fichier : `None` s'il n'existe pas.
fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Impossible de lire {} : {e}", path.display())),
    }
}

fn decode(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes).map_err(|_| "~/.claude/settings.json n'est pas en UTF-8.".into())
}

/// Applique `edit` au fichier ; sauvegarde puis écrit seulement si quelque chose change.
fn edit_file(
    path: &Path,
    now_ms: u64,
    edit: impl FnOnce(&mut Value) -> Result<bool, String>,
) -> Result<bool, String> {
    let original = read_file(path)?;
    let mut settings = parse_settings(decode(original.as_deref().unwrap_or_default())?)?;
    if !edit(&mut settings)? {
        return Ok(false);
    }
    let text = render(&settings)?;

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Impossible de créer {} : {e}", dir.display()))?;
    }
    if let Some(bytes) = original.as_deref().filter(|b| !b.is_empty()) {
        let backup = sibling(path, &format!("sordulo-bak-{}", file_timestamp(now_ms)));
        std::fs::write(&backup, bytes).map_err(|e| {
            format!("Sauvegarde de settings.json impossible, rien n'a été modifié : {e}")
        })?;
        log::info!("sauvegarde de settings.json : {}", backup.display());
    }
    let tmp = sibling(path, "sordulo-tmp");
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|e| format!("Écriture de {} impossible : {e}", tmp.display()))?;
    // Un autre programme (Claude Code) a pu écrire entre-temps : on n'écrase pas ses changements.
    if read_file(path)? != original {
        let _ = std::fs::remove_file(&tmp);
        return Err("~/.claude/settings.json a changé pendant la mise à jour : réessaie.".into());
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Écriture de {} impossible : {e}", path.display())
    })?;
    Ok(true)
}

/// `settings.json` → `settings.json.<suffix>` dans le même dossier.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(suffix);
    path.with_file_name(name)
}

/// Connecte : rend `true` si le fichier a été modifié.
pub fn connect_file(path: &Path, quoted_exe: &str, now_ms: u64) -> Result<bool, String> {
    edit_file(path, now_ms, |s| install_hooks(s, quoted_exe))
}

/// Déconnecte : rend `true` si le fichier a été modifié.
pub fn disconnect_file(path: &Path, now_ms: u64) -> Result<bool, String> {
    if read_file(path)?.is_none() {
        return Ok(false);
    }
    edit_file(path, now_ms, uninstall_hooks)
}

/// État de connexion lu dans le fichier (fichier absent ou illisible = non connecté).
pub fn read_connected(path: &Path) -> bool {
    let Ok(Some(bytes)) = read_file(path) else {
        return false;
    };
    decode(&bytes)
        .and_then(parse_settings)
        .is_ok_and(|s| is_connected(&s))
}

/// Copie `<source_dir>/sordulo-hook(.exe)` dans `dest_dir` si elle manque ou diffère, et rend son chemin.
/// Une copie en cours d'utilisation (hook lancé par Claude Code) est renommée puis remplacée.
pub fn install_relay(source_dir: &Path, dest_dir: &Path, now_ms: u64) -> Result<PathBuf, String> {
    let source = source_dir.join(RELAY_EXE);
    let dest = dest_dir.join(RELAY_EXE);
    let Ok(bytes) = std::fs::read(&source) else {
        if dest.is_file() {
            log::warn!(
                "relais introuvable à côté de l'app ({}), copie existante gardée",
                source.display()
            );
            return Ok(dest);
        }
        return Err(format!(
            "Relais introuvable : {} (compile-le avec « cargo build --bin sordulo-hook » dans src-tauri).",
            source.display()
        ));
    };
    if std::fs::read(&dest).is_ok_and(|current| current == bytes) {
        // Copie d'une version qui oubliait le droit d'exécution (macOS : « Permission denied »).
        crate::platform::make_executable(&dest)
            .map_err(|e| format!("Relais non exécutable ({}) : {e}", dest.display()))?;
        return Ok(dest);
    }
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Impossible de créer {} : {e}", dest_dir.display()))?;
    let tmp = sibling(&dest, "new");
    std::fs::write(&tmp, &bytes)
        .map_err(|e| format!("Copie du relais impossible ({}) : {e}", tmp.display()))?;
    crate::platform::make_executable(&tmp)
        .map_err(|e| format!("Relais non exécutable ({}) : {e}", tmp.display()))?;
    if dest.exists() && std::fs::remove_file(&dest).is_err() {
        // Windows : un exécutable lancé ne se supprime pas, mais se renomme.
        let old = sibling(&dest, &format!("old-{}", file_timestamp(now_ms)));
        std::fs::rename(&dest, &old)
            .map_err(|e| format!("Remplacement du relais impossible : {e}"))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| format!("Copie du relais impossible : {e}"))?;
    remove_old_copies(dest_dir);
    log::info!("relais copié : {}", dest.display());
    Ok(dest)
}

/// Supprime les anciennes copies renommées qui ne sont plus utilisées (best effort).
fn remove_old_copies(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let prefix = format!("{RELAY_EXE}.old-");
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "\"C:/Users/Jean Dupont/AppData/Local/com.sordulo.os/bin/sordulo-hook.exe\"";

    fn parse(text: &str) -> Value {
        parse_settings(text).unwrap()
    }

    fn text(v: &Value) -> String {
        serde_json::to_string(v).unwrap()
    }

    /// Réglages d'un utilisateur avec des hooks d'autres outils et des matchers variés.
    const OTHER_TOOLS: &str = r#"{
  "model": "opus",
  "permissions": { "allow": ["Bash(npm run *)"], "deny": [] },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/bin/guard.sh" } ] },
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "prettier --check", "timeout": 30 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "say done" } ] }
    ],
    "Notification": [
      { "matcher": "", "hooks": [] }
    ],
    "PostToolUse": [
      { "matcher": "mcp__.*__write.*", "hooks": [ { "type": "command", "command": "log.sh" } ] }
    ]
  },
  "env": { "A": "1" },
  "theme": "dark"
}"#;

    #[test]
    fn quoting_of_the_relay_path() {
        assert_eq!(
            quoted_exe(Path::new(
                "C:\\Users\\Jean Dupont\\AppData\\Local\\com.sordulo.os\\bin\\sordulo-hook.exe"
            ))
            .unwrap(),
            EXE
        );
        assert!(quoted_exe(Path::new("C:\\Users\\a$b\\sordulo-hook.exe")).is_err());
        assert!(quoted_exe(Path::new("C:\\Users\\100%\\sordulo-hook.exe")).is_err());
        assert_eq!(
            hook_command(EXE, ClaudeHookEventName::PreToolUse),
            format!("{EXE} PreToolUse")
        );
    }

    #[test]
    fn install_keeps_other_tools_and_order() {
        let original = parse(OTHER_TOOLS);
        let mut settings = original.clone();
        assert!(install_hooks(&mut settings, EXE).unwrap());
        assert!(is_connected(&settings));

        // Ordre des clés de premier niveau inchangé.
        let keys: Vec<&String> = settings.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["model", "permissions", "hooks", "env", "theme"]);
        let hooks = settings["hooks"].as_object().unwrap();
        // Événements existants d'abord (dans leur ordre), puis ceux que nous avons créés.
        let events: Vec<&String> = hooks.keys().collect();
        assert_eq!(
            events,
            [
                "PreToolUse",
                "Stop",
                "Notification",
                "PostToolUse",
                "SessionStart",
                "UserPromptSubmit",
                "PermissionRequest",
                "SubagentStop",
                "SessionEnd"
            ]
        );
        // Hooks existants intacts, les nôtres à la fin.
        let pre = hooks["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 3);
        assert_eq!(pre[0], original["hooks"]["PreToolUse"][0]);
        assert_eq!(pre[1], original["hooks"]["PreToolUse"][1]);
        assert_eq!(
            pre[2],
            json!({ "matcher": "*", "hooks": [ { "type": "command", "command": format!("{EXE} PreToolUse"), "timeout": 5 } ] })
        );
        // Pas de matcher pour Stop et UserPromptSubmit ; 75 s pour PermissionRequest.
        assert!(hooks["Stop"][1].get("matcher").is_none());
        assert!(hooks["UserPromptSubmit"][0].get("matcher").is_none());
        assert_eq!(hooks["PermissionRequest"][0]["hooks"][0]["timeout"], 75);
        // Le groupe vide d'un autre outil est gardé.
        assert_eq!(
            hooks["Notification"][0],
            json!({ "matcher": "", "hooks": [] })
        );
    }

    #[test]
    fn connect_twice_adds_nothing() {
        let mut settings = parse(OTHER_TOOLS);
        install_hooks(&mut settings, EXE).unwrap();
        let once = text(&settings);
        assert!(!install_hooks(&mut settings, EXE).unwrap());
        assert_eq!(text(&settings), once);
    }

    #[test]
    fn stale_entries_are_replaced_not_duplicated() {
        let mut settings = parse(OTHER_TOOLS);
        install_hooks(&mut settings, "\"C:/ancien/sordulo-hook.exe\"").unwrap();
        assert!(install_hooks(&mut settings, EXE).unwrap());
        let all = text(&settings);
        assert!(!all.contains("C:/ancien"));
        assert_eq!(all.matches(RELAY_MARKER).count(), 9);
    }

    #[test]
    fn disconnect_restores_the_original() {
        let original = parse(OTHER_TOOLS);
        let mut settings = original.clone();
        install_hooks(&mut settings, EXE).unwrap();
        assert!(uninstall_hooks(&mut settings).unwrap());
        assert_eq!(text(&settings), text(&original));
        assert!(!is_connected(&settings));
        // Rien à retirer : inchangé.
        assert!(!uninstall_hooks(&mut settings).unwrap());
        assert_eq!(text(&settings), text(&original));
    }

    #[test]
    fn empty_file_round_trip() {
        let mut settings = parse("  \n");
        assert_eq!(settings, json!({}));
        assert!(install_hooks(&mut settings, EXE).unwrap());
        assert_eq!(settings["hooks"].as_object().unwrap().len(), 9);
        assert!(uninstall_hooks(&mut settings).unwrap());
        assert_eq!(text(&settings), "{}");
    }

    #[test]
    fn mixed_group_keeps_the_other_hook() {
        // L'utilisateur a mis un autre hook dans notre groupe : seul le nôtre part.
        let mut settings = json!({
            "hooks": { "Stop": [ { "hooks": [
                { "type": "command", "command": format!("{EXE} Stop"), "timeout": 5 },
                { "type": "command", "command": "say bye" }
            ] } ] }
        });
        assert!(uninstall_hooks(&mut settings).unwrap());
        assert_eq!(
            settings,
            json!({ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say bye" } ] } ] } })
        );
    }

    #[test]
    fn invalid_settings_are_refused() {
        assert!(parse_settings("{ \"hooks\": ").is_err());
        assert!(parse_settings("[1, 2]").is_err());
        assert!(parse_settings("\u{feff}{}").is_ok());
        let mut bad_hooks = json!({ "hooks": [] });
        assert!(install_hooks(&mut bad_hooks, EXE).is_err());
        assert_eq!(bad_hooks, json!({ "hooks": [] }));
        let mut bad_event = json!({ "hooks": { "Stop": { "x": 1 } } });
        assert!(install_hooks(&mut bad_event, EXE).is_err());
        assert_eq!(bad_event, json!({ "hooks": { "Stop": { "x": 1 } } }));
    }

    #[test]
    fn partial_install_is_not_connected() {
        let mut settings = json!({});
        install_hooks(&mut settings, EXE).unwrap();
        settings["hooks"]
            .as_object_mut()
            .unwrap()
            .shift_remove("SessionEnd");
        assert!(!is_connected(&settings));
        assert!(install_hooks(&mut settings, EXE).unwrap());
        assert!(is_connected(&settings));
    }

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

    fn backups(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("sordulo-bak-"))
            .count()
    }

    #[test]
    fn file_connect_and_disconnect() {
        let tmp = TempDir::new("settings");
        let path = tmp.0.join(".claude").join("settings.json");

        // Fichier absent : créé (dossier compris), pas de sauvegarde.
        assert!(connect_file(&path, EXE, 1).unwrap());
        assert!(read_connected(&path));
        assert_eq!(backups(&tmp.0.join(".claude")), 0);
        // Deuxième connexion : rien d'écrit.
        assert!(!connect_file(&path, EXE, 2).unwrap());
        assert_eq!(backups(&tmp.0.join(".claude")), 0);

        // Fichier existant : sauvegarde puis écriture, contenu d'origine retrouvé après déconnexion.
        std::fs::write(&path, OTHER_TOOLS).unwrap();
        assert!(connect_file(&path, EXE, 3).unwrap());
        assert_eq!(backups(&tmp.0.join(".claude")), 1);
        let written = std::fs::read_to_string(&path).unwrap();
        assert!(written.ends_with("}\n") && written.contains("  \"model\": \"opus\""));
        assert!(disconnect_file(&path, 4).unwrap());
        assert_eq!(backups(&tmp.0.join(".claude")), 2);
        assert!(!read_connected(&path));
        assert_eq!(
            text(&parse(&std::fs::read_to_string(&path).unwrap())),
            text(&parse(OTHER_TOOLS))
        );
        assert!(!tmp.0.join(".claude/settings.json.sordulo-tmp").exists());

        // JSON invalide : refus, fichier intact, pas de sauvegarde.
        std::fs::write(&path, "{ invalide").unwrap();
        assert!(connect_file(&path, EXE, 5).is_err());
        assert!(disconnect_file(&path, 6).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ invalide");
        assert_eq!(backups(&tmp.0.join(".claude")), 2);

        // Déconnexion sans fichier : rien.
        assert!(!disconnect_file(&tmp.0.join("absent.json"), 7).unwrap());
    }

    #[test]
    fn relay_copy() {
        let tmp = TempDir::new("relay");
        let source = tmp.0.join("target");
        let dest = tmp.0.join("bin");
        assert!(install_relay(&source, &dest, 1).is_err());

        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join(RELAY_EXE), b"v1").unwrap();
        let copied = install_relay(&source, &dest, 1).unwrap();
        assert_eq!(copied, dest.join(RELAY_EXE));
        assert_eq!(std::fs::read(&copied).unwrap(), b"v1");

        std::fs::write(source.join(RELAY_EXE), b"v2").unwrap();
        install_relay(&source, &dest, 2).unwrap();
        assert_eq!(std::fs::read(&copied).unwrap(), b"v2");

        // Source disparue : la copie existante sert.
        std::fs::remove_file(source.join(RELAY_EXE)).unwrap();
        assert_eq!(install_relay(&source, &dest, 3).unwrap(), copied);
    }
}
