# L'île Sordulo OS (interface permanente de l'app de bureau)

## Ticket d'origine
`ticket-ile-sordulo-os.md` (racine du repo, 20/11/2026). Source de vérité visuelle : `design/prototypes/ile-sordulo-os.html`. Quand le prototype et le ticket divergent, le ticket gagne.

## Contexte
App de bureau Tauri 2 (Windows) autour du front React 19 + Vite + TS strict. Aujourd'hui la fenêtre `prompt` (route `/desktop/prompt`, `src/features/desktop/DesktopPromptPage.tsx`) est une barre 620 × 64 qui propose de transcrire un appel détecté, enregistre, puis envoie l'audio.

Ce qui existe et sera réutilisé :
- Rust : détection du micro et des apps d'appel (`monitor.rs`, `call_apps.rs`, `platform/windows/mic.rs`, `activity.rs`), capture WASAPI micro + son de l'ordinateur avec niveaux RMS (`platform/windows/mixer.rs`, `recorder.rs`), menu du soleil (`tray.rs`), fenêtres (`windows_mgmt.rs`), contrat IPC (`events.rs` ⇔ `src/shared/desktop-contract.ts`).
- Front : wrappers IPC (`src/lib/desktop.ts`), envoi de l'audio avec relance sans doublon (`src/features/inputs/uploadMeeting.ts`), enregistrement en attente gardé en local (`src/features/desktop/storage.ts`), statuts des entrées `uploaded → transcribing → analyzing → ready | error`, écran de validation `/projects/:projectId/inputs/:inputId/review`, kit UI (`src/components/ui`), tokens (`src/styles/tokens.css`).
- Base : `tasks.assignee_member_id`, statut de tâche `review` (aucun champ « relecteur »), aucune table dans Realtime.

## Décisions
- Police de l'île : Google Sans Flex, la police de l'app (`--island-font: var(--font-sans)`), pas Geist. (réponse utilisateur)
- Zone « Claude Code » du glisser-déposer : copie le chemin du fichier dans le presse-papiers + notification « Chemin copié : colle-le dans Claude Code ». (réponse utilisateur)
- « Une tâche attend ta relecture » : déclarée et typée dans le catalogue, non branchée (pas de rôle relecteur). (réponse utilisateur)
- Migration `0003` : colonne `tasks.assigned_by_member_id` remplie par trigger depuis `auth.uid()`, table `tasks` ajoutée à la publication `supabase_realtime`. Écrite ET appliquée (`npm run db:migrate`). Risque de collision de numéro avec le ticket V0.2 de Sacha, à signaler dans le rapport. (réponse utilisateur)
- Demande d'autorisation Claude Code : le relais attend au plus 60 s la réponse de l'île, puis rend la main sans décision ; île non lancée = main rendue tout de suite. (réponse utilisateur)
- Ajouts retenus : labo de l'île dans le navigateur, replacement au changement d'écran/résolution/échelle, notification « appel non envoyé » au démarrage, état de la connexion Claude Code dans le menu du soleil. (réponse utilisateur)
- Commits : un commit par phase validée, sur `feature/ile`, sans push. (réponse utilisateur)
- Fenêtre : on garde le label `prompt` et la route `/desktop/prompt` (moins de changements dans capabilities, single-instance, contrat) ; seuls son contenu et sa forme changent. (choix par défaut)
- « Connecter / Déconnecter Claude Code » et « Mode concentration » vivent dans le menu du soleil : c'est le seul lieu de réglage de l'app de bureau, et le ticket y place déjà le mode concentration ; les pages annexes sont à Sacha. (déduit du ticket)
- L'île est collée au bord haut de la zone de travail de l'écran principal (pas de marge), comme le prototype. (prototype)
- Couleurs, police, tailles de texte de l'île : section « Île » de `tokens.css`. Tailles par état, positions des éléments partagés et ressort : `src/features/island/geometry.ts` uniquement. (ticket)
- Survol pendant l'enregistrement : taille `agentOpen` (clé `meetOpen`, alias de mêmes dimensions) avec app, projet, bouton « Arrêter ». (ticket)
- Hook `UserPromptSubmit` ajouté aux 8 hooks du ticket : il donne la « tâche » de chaque session (début du premier prompt) affichée dans `multi`. (choix par défaut, coût nul)
- Session non connectée à Supabase : l'île reste au repos ; un appel détecté affiche une notification « Connecte-toi dans Sordulo OS » avec « Ouvrir ». (choix par défaut, état le plus proche du prototype)
- Relais Claude Code : port local aléatoire sur 127.0.0.1 + jeton aléatoire, écrits dans un fichier du dossier de données de l'app, lu par le binaire du hook. (ticket : « 127.0.0.1 avec un jeton »)

## Hors périmètre
- Musique (lecture en cours), progression des déploiements Vercel, branchement des devis, paiements, échéances, rappels de call, fichiers de projet (zone « Fichiers » masquée), version macOS (tailles Mac déclarées mais inactives), pages annexes.
- Version release / installeur de l'app de bureau.

## Critères d'acceptation
- [ ] Au repos, l'île est une fine ligne en haut au centre ; on clique à travers partout ailleurs, y compris sur les fenêtres juste en dessous. **Code fait, à vérifier dans l'app** : fenêtre transparente + `island_window::decide` (6 tests, dont échelle 150 %) ; non lancée, l'instance `tauri dev` de l'utilisateur tournait avec l'ancien binaire Rust.
- [x] Les transitions entre états suivent le prototype (forme, ressort, éléments qui glissent), vérifiées à l'œil à côté du prototype ouvert dans le navigateur. Preuve : labo `/desktop/ile-labo` comparé au prototype servi en local (appel, multiOpen, agentAskCall, jardin) ; chemin SVG comparé exactement au prototype dans `geometry.test.ts`.
- [ ] Un vrai appel Discord ou Meet : proposition, enregistrement avec onde et minuteur, arrêt au survol, import, analyse, notification « N tickets à valider » qui ouvre l'écran de validation. **À faire par l'utilisateur** (appel réel). Parcours couvert par les tests des sources (`call`, `upload`, `analysis`, `callFlow`).
- [x] Les scénarios de priorité A à F du prototype passent en tests. Preuve : `src/features/island/coordinator/scenarios.test.ts`.
- [ ] Deux sessions Claude Code en même temps apparaissent dans l'île ; une demande d'autorisation se valide depuis l'île ; l'île fermée, Claude Code demande dans le terminal sans attendre. **Partiel** : relais sans app → code 0, rien sur stdout, ~120 ms (mesuré par L7) ; serveur réel testé (allow, later, délai, abandon) ; réducteur et source testés. Reste à vérifier en vrai après « Connecter Claude Code ».
- [x] Les hooks Claude Code existants sont conservés après « Connecter » et « Déconnecter ». Preuve : tests de fusion/retrait sur fixtures (`claude/settings.rs`), connecter puis déconnecter redonne le fichier d'origine ; sauvegarde horodatée avant chaque écriture. Le vrai `~/.claude/settings.json` n'a pas été modifié.
- [ ] Un fichier audio déposé sur la zone « Transcrire » crée une entrée sur le projet choisi. **À vérifier dans l'app** : `drop.test.ts` (30 tests) + `read_dropped_audio` testé côté Rust.
- [x] Typecheck, lint, tests (front et Rust) et build passent. Preuve : 337 tests Vitest, cargo test 90 + 8, clippy 0 avertissement, `npm run build` OK.
- [x] Toutes les couleurs et polices viennent des tokens. Preuve : tests `tone.test.ts` et `garden/tokens.test.ts` (aucun hex, aucun px/rem hors 1px, chaque `var()` existe dans `tokens.css`).

## Lots
Contrats écrits par l'orchestrateur avant les lots : `src/features/island/types.ts`, ajouts de `src/shared/desktop-contract.ts` et `src-tauri/src/events.rs`, section « Île » de `src/styles/tokens.css`.

| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L1 | Coque Rust de l'île : fenêtre transparente sans bordure, taille du plus grand état, clics qui passent à travers + surveillance du curseur, zones cliquables envoyées par le front, placement en haut au centre + replacement au changement d'écran, `open_main_at` + événement `navigate`, mode concentration dans le menu du soleil | `src-tauri/src/windows_mgmt.rs`, `src-tauri/src/island_window.rs` (nouveau), `src-tauri/src/platform/mod.rs`, `src-tauri/src/platform/windows/mod.rs`, `src-tauri/src/platform/windows/cursor.rs` (nouveau), `src-tauri/src/platform/macos/mod.rs`, `src-tauri/src/tray.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/state.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/Cargo.toml`, `src/lib/desktop.ts` | contrats | opus / high | validé |
| L2 | Coordination sans interface : activités, bulle secondaire, épinglage, file des notifications, interruptions, regroupement, mode concentration, résumé de fin d'appel ; catalogue typé des notifications (branchées et prévues) ; scénarios A à F en tests | `src/features/island/coordinator/**`, `src/features/island/catalog.ts` | contrats | opus / high | validé |
| L3 | Rendu de l'île : `geometry.ts` (tailles Windows + Mac, ressort, éléments partagés, bulle), moteur de ressort, forme SVG, fondu des couches, éléments partagés, bulle secondaire, contenu de chaque état (hors jardin), reduced-motion | `src/features/island/geometry.ts`, `src/features/island/view/**`, `src/styles/tokens.css` (section Île seulement) | contrats | opus / high | validé |
| L4 | Niveau sonore en direct (micro + son de l'ordinateur) émis pendant l'enregistrement | `src-tauri/src/platform/windows/recorder.rs`, `mixer.rs`, `capture.rs`, `src-tauri/src/platform/mod.rs`, `src-tauri/src/recording.rs`, `src-tauri/src/monitor.rs` | L1 | sonnet / medium | validé |
| L5 | Parcours d'appel dans l'île : contrôleur Tauri ⇄ coordinateur, `appel` / `meet` / arrêt au survol / `progress` sur les vrais statuts / « N tickets à valider » / erreurs + Réessayer / appel non envoyé au démarrage / connexion requise ; remplace la barre ; navigation de la fenêtre principale | `src/features/desktop/**`, `src/features/island/controller/**`, `src/features/island/catalog.ts`, `src/features/island/view/layers/CallLayers.tsx`, `src/app/AppLayout.tsx` | L1, L2, L3 | opus / high | validé |
| L11 | Labo de l'île `/desktop/ile-labo` (navigateur, hors app) : chaque état, survol, plateforme, scénarios A à F, ressort | `src/features/island/lab/**`, `src/app/routes.tsx` | L2, L3 | sonnet / medium | validé |
| L12 | Conformité `CLAUDE.md` : aucune valeur `px`/`rem` dans les `.module.css` de l'île et du labo (tokens `--island-*`), pas de `letter-spacing` en dur | `src/features/island/view/Island.module.css`, `src/features/island/lab/IslandLab.module.css`, `src/styles/tokens.css` (section Île) | L5 | sonnet / medium | validé |
| L6 | Notification d'attribution : migration 0003 appliquée, abonnement Realtime, notification « X t'a assigné une tâche » qui ouvre la tâche | `supabase/migrations/0003_*.sql`, `src/features/island/controller/sources/assignments*` (nouveau ; enregistré par l'orchestrateur dans `sources/index.ts`), `src/shared/types.ts` | L5 | sonnet / medium | validé (migration non appliquée) |
| L7 | Relais Claude Code en Rust : binaire `sordulo-hook`, serveur local 127.0.0.1 + jeton, attente 60 s max sur PermissionRequest, jamais bloquant ; Connecter / Déconnecter (fusion + sauvegarde de `~/.claude/settings.json`) ; état de connexion dans le menu du soleil ; événements vers l'île | `src-tauri/src/claude/**`, `src-tauri/src/bin/**`, `src-tauri/src/lib.rs`, `src-tauri/src/tray.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/state.rs`, `src-tauri/Cargo.toml` | L1 | opus / high | validé |
| L8 | Claude Code dans l'île : sessions, `agent` (projet, branche, étape), `agentAsk` (réponse renvoyée), `multi`, conflits, notifications Claude | `src/features/island/claude/**`, `controller/sources/claude*` (enregistré par l'orchestrateur), `view/layers/ClaudeLayers.tsx` | L5, L7 | opus / high | validé |
| L9 | Glisser-déposer : réveil à 24 px, zones, « Transcrire » (audio → entrée réunion), « Claude Code » (chemin copié), « Fichiers » masquée | `src/features/island/drop/**`, `controller/sources/drop*`, `view/layers/DragLayers.tsx`, `src-tauri/src/dropped.rs`, commandes Rust + presse-papiers | L5 (sessions lues dans la vue, pas de dépendance au code de L8) | sonnet / medium | validé |
| L10 | Jardin des Claude : portage de l'animation du prototype (personnages, sous-agents, interactions, événements) | `src/features/island/garden/**`, `view/Island.tsx` + moteur (taille animée), `controller/IslandController.tsx`, `lab/**`, `src/styles/tokens.css` (section Île) | tous | opus / high | validé |

Phases et commits : P1 = L1, L2, L3, L11 · P2 = L4, L5 · P3 = L6 · P4 = L7, L8 · P5 = L9 · P6 = L10.

## Journal
- 20/11 Exploration, questions posées (2 tours), décisions notées.
- 20/11 Contrats écrits par l'orchestrateur : `src/features/island/types.ts`, ajouts IPC (`desktop-contract.ts`, `events.rs`, dont `desktop://island-pointer` pour un survol fiable malgré les clics transparents), section « Île » de `tokens.css`. Typecheck + lint OK.
- 20/11 L1, L2, L3 lancés en parallèle. Recherche préparatoire du relais (notes pour L7) lancée.
- 20/11 Notes du relais prêtes (`notes-relais-claude.md`) : sortie PermissionRequest `hookSpecificOutput.decision.behavior`, toujours sortir 0, SessionEnd budget 1,5 s, copyright MIT « Copyright (c) 2026 Louis Raillé » si du code est repris.
- 20/11 L2 validé : `IslandCoordinator` (API documentée en tête de `coordinator.ts`), catalogue de 20 sortes, 44 tests (scénarios A à F + cas ciblés) OK, lint OK. Écarts assumés : « 1 sur N » et withCall recalculés en direct, notification recouverte par un overlay remise en tête de file, doublons ignorés. Défauts gardés : « Voir » du regroupement ferme la notification, `pathCopied` affiche le nom du fichier, `loginRequired` ouvre `/login`.
- 20/11 L1 validé : fenêtre île 640 × 260 transparente, clics transparents + thread curseur 16 ms (`island_window::decide`, 6 tests), replacement toutes les 2 s, `open_main_at`, mode concentration dans le menu du soleil, plugin positioner retiré, wrappers `desktop.ts` pour tout le contrat. cargo test 47 OK, clippy OK. App non lancée par le lot (une instance de l'utilisateur tourne). À retenir pour L5 : html/body transparents sur `/desktop/prompt`, sélecteur de projet maison dans la forme (le `<select>` natif déborde des zones cliquables), un clic dans l'île lui donne le focus clavier.
- 20/11 Contrat : ajout `CLAUDE_PERMISSION_TIMEOUT_MS` (60 000). L4 et L7 lancés.
- 20/11 L4 validé : niveau en direct par atomiques publiés depuis la capture (sans verrou), échelle -55..-12 dB lissée, `desktop://audio-level` toutes les 90 ms pendant l'enregistrement. cargo test 52 OK.
- 20/11 L3 validé : `geometry.ts` + `view/` (moteur de ressort par refs, forme exacte du prototype, éléments partagés, bulle + fantôme, toutes les couches hors jardin), 180 tests OK, typecheck/lint OK, vérifié dans Chrome par le lot. `meetOpen` : « Enregistrement en cours », app + projet, minuteur en haut à droite, onde en bas à gauche face au bouton « Arrêter ». Tokens ajoutés dans la section Île (durées, zones de dépôt, pochette). `tone.test.ts` garde `/// <reference types="node" />` (Vitest ne passe pas les .css en ?raw ; essai fait). Réponses : taille animée pour le jardin → à ajouter par L10 ; focus clavier = survol → le contrôleur (L5) appelle `setHover`.
- 20/11 Contrat : `NotificationKind` `callEnded` + action `stopRecording` (proposition d'arrêt quand le micro redevient inactif, absente du prototype). L5 et L11 lancés.
- 20/11 L7 rendu : relais `sordulo-hook` (std + serde_json, 1 s d'échéance, 62 s pour PermissionRequest, toujours code 0, ~120 ms sans app), serveur 127.0.0.1 + jeton 64 hex, fusion/retrait des 9 hooks avec sauvegarde horodatée et écriture atomique, relais copié dans `%LOCALAPPDATA%\com.sordulo.os\bin\`, menu du soleil (état + Connecter/Déconnecter). cargo test 79 + 8 OK, clippy OK. Vrai `~/.claude/settings.json` non modifié. Retour envoyé : émettre `PermissionCancelled` (ajouté au contrat) quand une demande finit sans réponse de l'île. `beforeDevCommand` de `tauri.conf.json` compile désormais aussi `sordulo-hook` (orchestrateur).
- 20/11 L7 validé après retour : `PermissionCancelled` émis sur délai écoulé ou relais qui raccroche, jamais après `claude_answer`. cargo test 81 + 8 OK, clippy OK.
- 20/11 L11 validé : labo `/desktop/ile-labo` (dev seulement, absent du build). Vérifié dans Chrome par l'orchestrateur à côté du prototype servi en local : « Appel détecté » et `multiOpen` (400 × 220) conformes, seule la police diffère (décision).
- 20/11 `CLAUDE.md` trouvé à la racine (non suivi, créé avant le ticket) : ses règles priment. Écart relevé : `Island.module.css` contient 142 valeurs px (consigne donnée à L3 par l'orchestrateur, contraire à la règle 1), `IslandLab.module.css` 2, et un `letter-spacing: normal`. Lot L12 ajouté après L5 pour les passer en tokens. Commit de la phase 1 repoussé après L12. Les briefs suivants citent `CLAUDE.md`.
- 20/11 L5 validé : contrôleur à sources (`controller/runtime.ts`, une source = un fichier + une ligne dans `sources/index.ts`), parcours complet appel → meet → arrêt au survol → import → analyse (lecture de l'entrée toutes les 2 s, `process` répond 202) → « N tickets à valider » / « Aucun ticket proposé » ; erreurs + Réessayer ; file des appels non envoyés ; sélecteur de projet maison dans la forme ; `loginRequired` ; navigation de la fenêtre principale. 224 tests, build OK. Non testé dans Tauri (instance de l'utilisateur en cours).
- 20/11 Contrat : sortes `recording` et `recordError` (contournements de L5). Retour à L5 : catalogue (2 sortes, `interrupt` pour `callEnded` et `recording`), suppression de `hideCurrentWindow`, libellé lecteur d'écran du mode manuel. L6, L8, L12 lancés. `sources/index.ts` réservé à l'orchestrateur pour éviter les conflits entre L6 et L8.
- 20/11 Retouche L5 validée : `recording` et `recordError` au catalogue (23 sortes), `callEnded`/`recording` en interruption, `hideCurrentWindow` supprimé, libellé « Enregistrer un appel ». Fixtures du labo complétées par l'orchestrateur. Erreurs de typecheck restantes = travaux en cours de L6 (`Task` élargi, fixtures de tests à compléter) et L12.
- 20/11 L12 validé : 142 valeurs px passées en tokens `--island-space-N` / `--island-size-N` / `--island-radius-N` + tokens de détail, `--island-letter-spacing: normal` (annule le letter-spacing global du body, seul écart à la règle 7, assumé), tests « aucun px/rem hors 1px » ajoutés. Rendu vérifié dans le labo par l'orchestrateur (agentAskCall identique).
- 20/11 L6 validé sur le code : migration `0003_task_assigned_by.sql` (colonnes `assigned_by_member_id` / `assigned_at`, trigger `tasks_20_track_assignment` en security definer, ajout idempotent à `supabase_realtime`), source `assignments.ts` (dédoublonnage par (tâche, assigned_at), regroupement par auteur sur 2 s). **Migration NON appliquée : `SUPABASE_DB_URL` est vide dans `.env.local`** → action utilisateur. Fixtures `diff.test.ts` / `board.test.ts` complétées et source enregistrée par l'orchestrateur. Limite : les tâches pré-attribuées par l'IA (pipeline en service role) gardent `assigned_by` à null ; la validation sans changement d'assigné ne notifie donc pas, seule une (ré)attribution faite par un membre notifie. Typecheck, lint, 235 tests OK.
- 20/11 L9 lancé (en parallèle de L8, fichiers disjoints). Commits repoussés à la fin de L8 : `ClaudeLayers.tsx` (non suivi) est en cours de modification et le rendu en dépend.
- 20/11 L8 validé : réducteur pur `reduceClaude` (sessions, étapes en français, statuts, sous-agents, conflits par paire et par fichier) + source `claude.ts` (agent / multi, demandes avec minuteur 60 s et `PermissionCancelled`, Autoriser / Refuser / Plus tard, Répondre, notifications claudeDone / multiDone / claudeStop / conflict). Source enregistrée par l'orchestrateur ; roue de l'étape affichée seulement en travail (orchestrateur). 282 tests, typecheck, lint, build OK. Choix : inactive après 15 min, oubliée après 3 h ; « Voir » épingle l'activité Claude si elle est dans la bulle. Non relayé : `PostToolUseFailure` (erreur d'outil), `error` vrai seulement après un refus.
- 20/11 L10 (jardin) lancé en parallèle de L9 (fichiers disjoints), tout le reste étant validé.
- 20/11 L9 validé : source `drop.ts` (réveil dans la marge de 24 px, zones sur la forme avec hystérésis, Transcrire → entrée réunion sur le dernier projet + progression + suivi d'analyse, Claude Code → chemin copié + `pathCopied`, Fichiers non rendue), Rust `read_dropped_audio` (fenêtre prompt, extension audio, 500 Mo max) et `copy_text` (presse-papiers Windows). Source enregistrée par l'orchestrateur. 312 tests, cargo test 90 + 8, clippy OK. Limites : rectangle de la forme lu dans le DOM (`[data-state] > :first-child`), envoi limité à 50 Mo par `uploadMeetingRecording`, rien vérifié dans l'app lancée.
- 20/11 L10 validé : moteur pur `GardenSim` (14 interactions, sous-agents, événements réels : arrivée, départ, fin, réveil, erreur + consolation, conflit), rendu DOM hors React branché sur la boucle de l'île (pas de seconde boucle rAF), départ depuis l'icône, labo complété. 337 tests, build OK. Vérifié dans le labo par l'orchestrateur.
- 20/11 Validation finale : typecheck, lint, 337 tests, build, cargo test 90 + 8, clippy 0. Sélecteur DOM du dépôt toujours valide après L10.

## Rapport

### Ce qui a été fait
- **Coque Rust de l'île** : la fenêtre `prompt` devient une île transparente de 640 × 260, toujours au premier plan, hors barre des tâches, collée en haut au centre de l'écran principal et replacée au changement d'écran. Les clics passent à travers sauf sur les formes (thread curseur à 16 ms + zones envoyées par le front), et `desktop://island-pointer` sert de survol fiable. Le mode concentration est dans le menu du soleil. `open_main_at` navigue la fenêtre principale. L'ancienne barre 620 × 64 et le plugin positioner sont supprimés.
- **Rendu** : `geometry.ts` est la seule source des tailles Windows + Mac (Mac inactif), du ressort 380 / 26 et des éléments partagés. Moteur à ressort par refs, forme SVG identique au prototype, couches de tous les états, bulle secondaire avec « +N » et fantôme, reduced-motion. Survol de l'enregistrement (`meetOpen`) avec bouton Arrêter.
- **Coordination** : `IslandCoordinator` sans interface couvre les priorités, la bulle, l'épinglage, la file, les interruptions, le regroupement, le mode concentration et le résumé de fin d'appel. Catalogue typé de 23 sortes de notifications : 15 branchées, 8 prévues.
- **Parcours d'appel** : appel détecté → choix du projet (sélecteur maison) → enregistrement (onde sur le vrai niveau micro + son de l'ordinateur, minuteur) → arrêt au survol, par la notification « L'appel semble terminé » ou par le menu → import → analyse sur les vrais statuts → « N tickets à valider » qui ouvre l'écran de validation. Erreurs avec Réessayer, file des appels non envoyés relancée au démarrage, `loginRequired` sans session.
- **Attribution** : migration 0003 (auteur et date d'attribution par trigger, `tasks` dans Realtime) + source Realtime, avec regroupement par auteur sur 2 s.
- **Claude Code** :
  - relais `sordulo-hook` (std + serde_json, jamais bloquant, 60 s max pour une autorisation) ;
  - serveur local 127.0.0.1 + jeton ;
  - Connecter / Déconnecter avec fusion et sauvegarde de `settings.json`, état dans le menu du soleil ;
  - dans l'île : sessions, étapes en français, `agent` / `agentAsk` / `multi`, conflits, notifications ; `PermissionCancelled` quand le terminal reprend la main.
- **Glisser-déposer** : réveil dans la marge de 24 px, zones sur la forme. Transcrire → entrée réunion sur le dernier projet. Claude Code → chemin copié (presse-papiers Windows). Fichiers : zone non rendue.
- **Jardin des Claude** : portage complet de l'animation du prototype, piloté par les vraies sessions.
- **Labo** `/desktop/ile-labo` (dev seulement) pour comparer chaque état et les scénarios A à F au prototype.

### Fichiers principaux
- Rust : `src-tauri/src/island_window.rs`, `platform/windows/{cursor,clipboard}.rs`, `claude/**`, `bin/sordulo-hook.rs`, `dropped.rs`, + `windows_mgmt.rs`, `tray.rs`, `commands.rs`, `lib.rs`, `state.rs`, `monitor.rs`, `platform/**`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`.
- Front : `src/features/island/**` (types, catalog, geometry, coordinator, view, controller, claude, drop, garden, lab), `src/features/desktop/**` (ancienne barre supprimée), `src/shared/desktop-contract.ts`, `src/shared/types.ts`, `src/lib/desktop.ts`, `src/styles/tokens.css` (section Île), `src/app/{routes,AppLayout}.tsx`, `src/assets/island/claude-code.png`.
- Base : `supabase/migrations/0003_task_assigned_by.sql`.

### Vérifications
- typecheck, lint, 337 tests Vitest, build ; cargo test 90 + 8, clippy 0 avertissement.
- Visuel : labo comparé au prototype dans Chrome (appel, multiOpen, agentAskCall, jardin).
- Non vérifié dans l'app lancée : une instance `tauri dev` de l'utilisateur tournait (ancien binaire Rust) et n'a pas été arrêtée.

### Décisions prises sans demander
- Label `prompt` et route `/desktop/prompt` gardés.
- Hook `UserPromptSubmit` ajouté (tâche de chaque session).
- Île collée au haut de la zone de travail.
- `meetOpen` composé dans le style d'`agentOpen`.
- Sortes ajoutées au contrat : `callEnded` (« L'appel semble terminé », Arrêter), `recording`, `recordError`. `callEnded` et `recording` interrompent, même en mode concentration.
- `PermissionCancelled` ajouté au contrat.
- `beforeDevCommand` compile aussi `sordulo-hook`.
- Délais Claude : inactive après 15 min, oubliée après 3 h.
- Zone Claude Code active si une session n'est ni terminée ni en pause.
- Dépôt : zones dès que le curseur est sur la forme, gardées jusqu'à 24 px (hystérésis).
- Tokens d'espacement de l'île nommés par leur valeur (`--island-space-14`…).
- `--island-letter-spacing: normal` annule le letter-spacing global du body, seul écart assumé à la règle 7.

### À faire par l'utilisateur
1. **Migration 0003 non appliquée** : `SUPABASE_DB_URL` est vide dans `.env.local`. La renseigner (URI Session pooler), puis `npm run db:migrate`. Sans ça, la notification d'attribution ne se déclenche pas.
2. Arrêter l'instance `tauri dev` en cours puis relancer `npm run tauri dev`, pour que le nouveau Rust (île, relais, dépôt) soit actif.
3. Tests réels :
   - clics à travers l'île au repos ;
   - appel Discord ou Meet de bout en bout ;
   - « Connecter Claude Code » puis deux sessions + une autorisation depuis l'île ; île fermée → le terminal demande tout de suite ;
   - glisser un audio sur « Transcrire ».

### Points à regarder
- **Numéro 0003** : collision probable avec le ticket V0.2 de Sacha, renommer la plus récente avant le merge.
- **Attribution par l'IA** : les tâches pré-attribuées par l'IA (pipeline en service role) n'ont pas d'auteur. Valider sans changer l'assigné ne notifie pas ; seule une (ré)attribution par un membre notifie.
- **Relais** : `PostToolUseFailure` n'est pas relayé, donc l'état « bloquée » n'apparaît qu'après un refus. Les sauvegardes de `settings.json` s'accumulent, sans nettoyage.
- **Dépôt** :
  - rien n'est détecté hors de la marge de 24 px (limite Windows acceptée par le ticket) ;
  - pas de drag depuis une app lancée en administrateur (UIPI) ;
  - envoi limité à 50 Mo ;
  - le rectangle de la forme est lu dans le DOM.
- **Focus** : un clic dans l'île lui donne le focus clavier (sinon le sélecteur ne marcherait pas).
- **`CLAUDE.md`** (non suivi, pas modifié) : il décrit encore `/desktop/prompt` comme une « petite fenêtre près de la zone de notification » ; à mettre à jour (c'est désormais l'île).
- **Commits** : avec les lots en parallèle sur des fichiers partagés (lib.rs, contrat, sources/index.ts), les commits sont regroupés par phase et par zone, pas strictement lot par lot. Seul l'état final compile à coup sûr ; les commits intermédiaires peuvent ne pas compiler seuls.

### Pour Sacha (cas absents du prototype)
- Survol de l'enregistrement : « Enregistrement en cours », app + projet, bouton Arrêter.
- « L'appel semble terminé » est une notification avec bouton Arrêter (10 s).
- Mode manuel : « Enregistrer un appel », bouton Annuler.
- « Aucun ticket proposé » avec bouton Ouvrir → fiche de l'entrée.
- Notifications d'erreur : envoi, analyse, enregistrement.
- « Chemin copié » avec le nom du fichier.
- Zone « Transcrire » : affiche le projet cible.
- Jardin : bulle d'attente « ! » ; « ? » orange pour une session bloquée.

### Idées non retenues ou hors périmètre
- Musique, déploiements Vercel, devis, paiements, échéances, rappels de call, fichiers de projet (déclarés au catalogue, non branchés), macOS (tailles prévues dans `geometry.ts`, lot L13).
