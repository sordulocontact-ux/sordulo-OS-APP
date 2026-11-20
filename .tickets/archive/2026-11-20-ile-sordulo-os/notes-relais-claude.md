# Notes de recherche : relais de hooks Claude Code (Windows)

Date : 2026-11-20. Sources : dépôt Louis-CFM/coucou (dossier `windows/hook`, MIT) et doc officielle https://code.claude.com/docs/en/hooks.

Limite : l'outil de lecture web ne restitue pas le code source mot pour mot (résumés seulement). Les extraits Rust de la section 1 sont donc des paraphrases fidèles, pas des copies. Avant de reprendre du code littéral, relire les fichiers sources directement (voir licence en 1.5).

## 1. Résumé du relais Windows de Coucou

### 1.1 Structure
- Langage : Rust. Crate `coucou-hook`, un seul binaire `coucou-hook` (`src/main.rs`), version, édition et licence héritées du workspace.
- Fichiers : `main.rs` (orchestration), `normalize.rs` (noms d'événements et champs), `reply.rs` (sortie vers l'agent), `statusline.rs` (option `--statusline`), `win.rs` (pipe nommé Windows), `unix.rs` (socket Unix Linux).
- Dépendances : `serde_json` 1 ; Windows seulement : `windows` 0.61 (Foundation, Security, Security Authorization, ToolHelp, Pipes, Threading) pour lire son propre SID, vérifier qui sert le pipe et détecter la mort du processus parent ; Linux : `libc`.
- Le relais sert plusieurs agents (Claude Code, Gemini, Cursor, Copilot, Antigravity...) : il normalise les noms d'événements vers ceux de Claude Code et ajoute un champ `coucou_agent`. Pour nous, inutile : un seul agent.

### 1.2 Transport
- Pipe nommé Windows `\\.\pipe\coucou-<SID utilisateur>` (repli sur `USERNAME` puis `"user"`). Linux : `$XDG_RUNTIME_DIR/coucou.sock`.
- Le relais envoie UNE ligne de JSON terminée par un saut de ligne (protocole documenté : "newline-terminated JSON").
- Connexion : ouverture du pipe en lecture/écriture dans une boucle jusqu'à `CONNECT_TIMEOUT` (valeur non visible ; la doc Windows parle de 300 ms pour joindre l'app). On ne réessaie que sur `ERROR_PIPE_BUSY` (231), en dormant 15 ms. Toute autre erreur (pipe absent) : abandon immédiat.
- Sécurité : après connexion, vérifie que le processus serveur du pipe tourne sous le même utilisateur ; sinon rien n'est envoyé.
- Esquisse (paraphrase) :
```rust
loop {
    match open_pipe(path) {
        Ok(pipe) => return if server_is_same_user(pipe) { Some(pipe) } else { None },
        Err(e) if e.is_busy() && now < deadline => sleep(15ms),
        Err(_) => return None,
    }
}
```
- Surveillance du parent : `Parent::gone()` (attente à timeout zéro sur le processus parent) permet d'arrêter l'attente si Claude Code a quitté.

### 1.3 Format des messages
- Le payload stdin de Claude Code est réémis tel quel, enrichi : `coucou_agent`, contexte terminal (programme de terminal, distro WSL, Cursor).
- Allègement : suppression des gros champs (sorties d'outils), chaînes plafonnées à 2000 octets ; le texte des Edit/MultiEdit/Write terminés est gardé entier (dans des limites) pour un diff en direct.
- `normalize.rs` : table des noms d'événements (ex. `BeforeTool` vers `PreToolUse`, `AfterAgent` vers `Stop`), remplissage de `tool_name`, `tool_input`, `session_id`, `cwd` s'ils manquent, sans jamais écraser l'existant ; un `Stop` avec `status:"error"` devient `StopFailure`.

### 1.4 PermissionRequest, absence de l'app
- Principe affiché : "never block the agent". Si l'app n'est pas lancée : sortie immédiate code 0, sans rien écrire sur stdout. Chaque étape est sous une échéance.
- Pour PermissionRequest Claude Code : attente de la réponse jusqu'à 110 s (la doc officielle de Coucou ne le dit pas pour Claude Code, valeur issue de la lecture de `main.rs`). Sans réponse : rien n'est imprimé, Claude Code demande dans le terminal.
- Sortie (stdout, un objet JSON), allow (aussi utilisé pour "toujours") :
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```
  deny : même structure avec `"behavior": "deny"` et un champ `message`. Aucune décision : stdout vide. Cas AskUserQuestion : allow + `updatedInput` (question d'origine + map `answers`).
- Pour les agents tiers, un PermissionRequest reçoit immédiatement "pas de décision".

### 1.5 Installation dans settings.json
- Fait côté app (Swift, `ClaudeSettingsFile.swift`), pas par le relais : bouton "Install hooks" qui sauvegarde `~/.claude/settings.json` (`settings.json.bak-AAAAMMJJ-HHMMSS`), fusionne les entrées, montre le diff avant d'écrire, ne touche pas aux hooks de l'utilisateur, la désinstallation retire seulement les entrées de l'app. Écriture atomique (fichier temporaire puis renommage), refus d'écrire si le fichier a changé depuis la lecture, un fichier non-objet JSON est une erreur (pas traité comme vide), liens symboliques et permissions conservés.
- Windows : le relais est copié dans `%LOCALAPPDATA%\Coucou\bin\` au lancement ; les commandes de hooks de Claude Code s'exécutent dans Git Bash, donc chemin entre guillemets avec barres obliques. Le format exact des entrées (matcher, timeout) n'a pas pu être lu (code de construction des entrées non retrouvé) : on utilise celui de la doc officielle, section 4.

### 1.6 Licence (à reprendre si on reprend du code ou une inspiration substantielle)
Fichier LICENSE :
```
MIT License

Copyright (c) 2026 Louis Raillé

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, ...
```
Mention à reprendre : `Copyright (c) 2026 Louis Raillé` + le texte MIT complet (à récupérer sur https://raw.githubusercontent.com/Louis-CFM/coucou/main/LICENSE). Si on écrit notre propre code sans copier, aucune obligation ; si on copie, joindre cette mention (ex. `THIRD_PARTY_NOTICES`).

## 2. Doc officielle : entrée stdin

Champs communs (tous événements) : `session_id`, `transcript_path`, `cwd`, `hook_event_name` ; selon version aussi `prompt_id`, `permission_mode` (`default|plan|acceptEdits|auto|dontAsk|bypassPermissions`), `effort{level}`, `scratchpad_dir`, `agent_id`, `agent_type` (si sous-agent). Tous les champs hors les 4 premiers sont optionnels : les lire en `Option`.

| Événement | Champs spécifiques |
|---|---|
| SessionStart | `source` (`startup|resume|clear|compact|fork`), `model` (optionnel), + champs de cache (`seconds_since_last_response`, `context_tokens`...) |
| UserPromptSubmit | `prompt` |
| PreToolUse | `tool_name`, `tool_input` (objet), `tool_use_id` |
| PostToolUse | `tool_name`, `tool_input`, `tool_response` (dépend de l'outil ; Bash : `stdout, stderr, interrupted, isImage` ; Write : `filePath, type`), `tool_use_id`, `duration_ms` |
| PermissionRequest | `tool_name`, `tool_input`, `permission_suggestions` (optionnel, tableau de `{type:"addRules", rules:[{toolName, ruleContent}], behavior, destination}`) |
| Notification | `message`, `title` (optionnel), `notification_type` (`permission_prompt`, `idle_prompt`, `auth_success`...) |
| Stop | `stop_hook_active`, `last_assistant_message`, `background_tasks[]`, `session_crons[]` |
| SubagentStop | idem Stop + `agent_id`, `agent_type`, `agent_transcript_path` |
| SessionEnd | `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`) |

Exemple PermissionRequest (verbatim doc) :
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-....jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf node_modules", "description": "Remove node_modules directory" },
  "permission_suggestions": [
    { "type": "addRules", "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
      "behavior": "allow", "destination": "localSettings" }
  ]
}
```
Exemples Stop / SubagentStop / SessionEnd (doc) : `{"hook_event_name":"Stop","stop_hook_active":true,"last_assistant_message":"...","background_tasks":[],"session_crons":[]}` ; SessionEnd : `{"hook_event_name":"SessionEnd","reason":"other", ...champs communs}`.

## 3. Sortie attendue et codes de sortie

### PermissionRequest (sortie sur stdout, code 0, un seul objet JSON sans rien d'autre autour)
Autoriser :
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } } }
```
Refuser (message renvoyé à Claude, `interrupt:true` arrête Claude) :
```json
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "deny", "message": "Refusé depuis l'application", "interrupt": false } } }
```
Champs de `decision` : `behavior` (`allow|deny`) ; `updatedInput` (allow seulement, remplace TOUT l'objet d'entrée) ; `updatedPermissions` (allow seulement, ex. règle "toujours autoriser", types `addRules|replaceRules|removeRules|setMode|addDirectories|removeDirectories`, destinations `session|localSettings|projectSettings|userSettings`) ; `message` et `interrupt` (deny seulement). Un hook ne peut pas autoriser ce qu'une règle deny refuse.
Pas de décision : ne rien imprimer, sortir 0 (Claude Code demande dans le terminal). Le code 2 n'est PAS pris en compte pour cet événement (flux inchangé, stderr ignoré), donc inutile.

### Codes de sortie
- 0 : succès ; stdout analysé comme JSON seulement si c'est un unique objet. Stdout texte est ajouté au contexte pour UserPromptSubmit et SessionStart (donc pour nous : ne RIEN écrire sur stdout, sauf PermissionRequest).
- 2 : erreur bloquante, stderr = raison. Bloque : PreToolUse, UserPromptSubmit, Stop, SubagentStop ; sans effet bloquant : PermissionRequest, PostToolUse (stderr montré à Claude), Notification, SessionStart, SessionEnd.
- Autre code (1...) : erreur non bloquante, l'action continue mais un avertissement "hook error" s'affiche. Notre relais doit donc TOUJOURS sortir 0 et ne jamais utiliser 2.

### Timeouts
- Champ `timeout` en secondes dans l'entrée du hook. Défaut : 600 s pour `command`; abaissé à 30 s pour `UserPromptSubmit`. SessionEnd : budget global de 1,5 s, relevé automatiquement jusqu'à 60 s max si un `timeout` plus grand est posé sur le hook (sinon un relais lent est tué à la fermeture).
- Un hook qui dépasse son timeout est tué ; l'action continue (non bloquant).

### Matchers
- Acceptent un matcher : outils (PreToolUse, PostToolUse, PermissionRequest, noms d'outils), SessionStart (`startup|resume|clear|compact|fork`), SessionEnd (raisons), Notification (types), SubagentStart/SubagentStop (type d'agent).
- Pas de matcher (ignoré silencieusement) : UserPromptSubmit, Stop.
- `""`, `"*"` ou absent = tout. Lettres/chiffres/`_`/`-`/espace/`,`/`|` = liste exacte ; autre caractère = regex JavaScript non ancrée.

## 4. Exemple complet de section `hooks` (settings.json)

Format : événement, tableau de groupes `{ matcher?, hooks: [ { type:"command", command, timeout } ] }`. Dans JSON, la barre oblique inverse est doublée. Les guillemets internes sont échappés. Le `timeout` de PermissionRequest (75) dépasse nos 60 s d'attente pour laisser le relais rendre la main lui-même.

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" SessionStart", "timeout": 5 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" UserPromptSubmit", "timeout": 5 } ] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" PreToolUse", "timeout": 5 } ] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" PostToolUse", "timeout": 5 } ] }
    ],
    "PermissionRequest": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" PermissionRequest", "timeout": 75 } ] }
    ],
    "Notification": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" Notification", "timeout": 5 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" Stop", "timeout": 5 } ] }
    ],
    "SubagentStop": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" SubagentStop", "timeout": 5 } ] }
    ],
    "SessionEnd": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "\"C:\\chemin\\sordulo-hook.exe\" SessionEnd", "timeout": 5 } ] }
    ]
  }
}
```
Installation : fusionner sans écraser les hooks existants (ajouter nos groupes au tableau de chaque événement), identifier nos entrées par le nom de l'exécutable dans `command` pour pouvoir les retirer, sauvegarder le fichier avant, écrire de façon atomique, et refuser de modifier un fichier qui n'est pas un objet JSON valide.

## 5. Pièges Windows
- Chemins avec espaces : la commande est une chaîne unique, donc mettre l'exe entre guillemets (échappés `\"` dans le JSON). Sur Claude Code Windows, les commandes passent par Git Bash : les barres obliques inverses non protégées peuvent être mangées ; Coucou utilise des barres obliques avec guillemets. Recommandation : écrire le chemin avec `/` (`"C:/Users/x/AppData/Local/Sordulo/bin/sordulo-hook.exe" PreToolUse`), ce qui marche dans Git Bash comme dans cmd. Tester les deux formes avant de figer. Éviter un chemin avec apostrophe ou `%`.
- Copier l'exe dans un dossier stable (`%LOCALAPPDATA%\...\bin`) plutôt que de pointer vers le dossier de build ou l'installateur qui change.
- Encodage : stdin est en UTF-8 (JSON). Lire les octets bruts (`read_to_end`) puis `serde_json::from_slice`, jamais `read_line` ni `String` depuis la console (évite les erreurs si l'entrée est invalide UTF-8 ; ne pas paniquer). Sortie : octets UTF-8 sans BOM.
- Stdout : n'écrire que pour PermissionRequest avec décision, un seul objet JSON, rien d'autre (ni log, ni `println!` de debug). Les logs vont dans un fichier ou stderr (stderr est ignoré avec code 0).
- Fenêtre console : un exe console lancé par Claude Code peut faire clignoter une fenêtre ; compiler en sous-système console est toléré, ou `#![windows_subsystem = "windows"]` (alors stdout/stdin peuvent être inutilisables : à éviter, on a besoin des deux).
- Panique : ajouter `panic = "abort"` ou envelopper dans `catch_unwind` et sortir 0 ; un panic donne un code 101 (erreur non bloquante mais bruyante).
- Antivirus/SmartScreen : un exe non signé peut être ralenti au premier lancement ; garder le binaire petit, sans dépendances lourdes.
- SessionEnd : budget de 1,5 s, donc le relais doit rester sous cette durée même en cas d'app absente (timeouts courts).

## 6. Recommandation de conception pour notre relais (`sordulo-hook`)

1. Dépendances : `std` + `serde_json` uniquement. Transport : `std::net::TcpStream` vers `127.0.0.1:<port>` avec requête HTTP/1.1 écrite à la main (pas de crate HTTP). Ou, plus simple et plus robuste, un pipe nommé comme Coucou (mais l'énoncé impose HTTP local ; garder HTTP).
2. Découverte : l'app écrit port + jeton dans un fichier (ex. `%LOCALAPPDATA%\Sordulo\hook.json`, droits utilisateur). Le relais le lit ; fichier absent ou illisible : sortir 0 immédiatement.
3. Flux : lire stdin en octets, parser en `serde_json::Value`, injecter le nom d'événement (argument CLI, plus fiable que `hook_event_name`), allèger (plafonner les chaînes ~2000 octets, retirer `tool_response` volumineux sauf champs utiles), POST `/hook` avec en-tête `Authorization: Bearer <jeton>` et `Content-Type: application/json`, `Connection: close`.
4. Délais : `TcpStream::connect_timeout` ~300 ms (loopback), écriture 500 ms, lecture 500 ms pour les événements sans réponse (ne pas attendre la réponse au-delà d'un accusé court, ou ne pas la lire). PermissionRequest : lecture avec échéance globale 60 s (timeout de lecture recalculé sur le temps restant). Échéance dure globale pour tout événement non permission : ~1 s (compatible SessionEnd 1,5 s).
5. PermissionRequest : l'app répond `{ "behavior": "allow" | "deny", "message"? }` ; le relais construit l'objet `hookSpecificOutput` de la section 3 et l'imprime. Toute autre issue (connexion refusée, 401, timeout, JSON invalide, réponse "none") : n'imprimer rien, sortir 0. Surveiller aussi le processus parent (Claude Code tué) pour interrompre l'attente, comme Coucou le fait, via un thread qui vérifie périodiquement (optionnel en V1).
6. Jamais bloquer : toujours `exit(0)`, y compris après erreur ; pas de `unwrap`/`expect` ; `panic = "abort"` ou `catch_unwind` ; un thread watchdog qui appelle `std::process::exit(0)` après l'échéance dure même si une E/S est bloquée.
7. Sécurité : écouter uniquement sur 127.0.0.1 côté app, jeton aléatoire régénéré à chaque lancement de l'app, comparé en temps constant, fichier de découverte lisible par l'utilisateur seul ; le relais n'envoie rien si le fichier est périmé (app arrêtée : la connexion échoue vite de toute façon).
8. Installation : l'app (pas le relais) modifie `~/.claude/settings.json` avec sauvegarde, diff, fusion non destructive et désinstallation propre (section 4) ; `timeout` 5 s pour les événements d'information, 75 s pour PermissionRequest.
9. Tests : tests unitaires de construction de la sortie PermissionRequest, du plafonnage des chaînes, et du comportement "app absente" (port fermé : sortie 0 en moins de ~400 ms, stdout vide).
10. Nommage : exécutable `sordulo-hook.exe`, jeton/port stockés sous le dossier de données Sordulo ; ne reprendre aucun nom ni protocole propre à un autre produit.
