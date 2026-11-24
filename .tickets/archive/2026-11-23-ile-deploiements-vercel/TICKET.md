# Île : déploiements Vercel (chargement, en ligne, échec)

## Ticket d'origine
Demande de Sacha (23/11) : « Je voudrais rajouter une nouvelle chose dans l'île. Je voudrais rajouter les push, surtout les déploiements versels. Donc, voir Le déploiement vecel est fini, le chargmeent,ect »

## Contexte
- L'île sait déjà afficher un déploiement, sans source : étape de progression `deploy` (icône nuage, `PROGRESS_VISUALS`), notification `deployed` (« X est en ligne », « Déploiement Vercel réussi », bouton Ouvrir → `openUrl`) dans `catalog.ts`, simulation dans le labo et le prototype `design/prototypes/ile-sordulo-os.html`. Le déploiement n'est pas une activité exclusive (il cède la place à l'appel, passe devant Claude et la musique).
- Modèle à suivre : sources du contrôleur (`controller/sources/*.ts`, deps injectées, tests avec horloge factice), connecteur Spotify (carte `live` de la page Connecteurs, notification `spotifyReconnect`), interrupteur du menu du soleil (musique, mode concentration : `tray.rs`, `state.rs`, événement vers l'île).
- L'API Vercel accepte les appels du navigateur (CORS `*`, vérifié le 23/11) et la CSP de Tauri est nulle : pas de Rust pour interroger Vercel.
- Jeton invalide : Vercel répond 401, ou 403 avec `error.invalidToken = true` (vérifié le 23/11).
Cadrage design : niveau 0 (l'île a déjà les visuels du déploiement dans le prototype).

## Décisions
- Connecteur lié au **compte Sordulo OS**, pas à l'ordinateur (réponse de Sacha) : jeton Vercel collé une fois dans la carte Vercel de la page Connecteurs, gardé dans Supabase, table `vercel_connections` (migration 0008), chaque compte ne lit que sa ligne (RLS `user_id = auth.uid()`). Jeton plutôt qu'OAuth (« le plus simple pour le user » laissé à mon choix : OAuth demanderait de créer une intégration Vercel ; le jeton se crée en un clic depuis un lien direct).
- Marche aussi sur la version web pour la connexion (le jeton est lié au compte) ; l'île ne tourne que dans l'app de bureau.
- Périmètre : les déploiements de **production** visibles par le jeton (réponse de Sacha : « les push production du jeton »), tous projets, compte personnel et équipes du jeton, quel que soit l'auteur.
- Client Vercel partagé `src/lib/vercel.ts` (posé par l'orchestrateur) : normalisation pure, appels `/v2/user`, `/v2/teams`, `/v6/deployments?target=production`, `/v13/deployments/:id` (alias de production pour « Ouvrir »), lecture / écriture du jeton.
- Contrat bureau posé par l'orchestrateur : `DeploymentsEnabledState`, `DESKTOP_EVENTS.deploymentsEnabled`, `DESKTOP_COMMANDS.getDeploymentsEnabled`, wrappers `getDeploymentsEnabled` / `onDeploymentsEnabled`.
- Ajouts retenus (réponse de Sacha) : échec signalé (« Voir les logs »), anneau réaliste (durée estimée d'après les derniers déploiements du projet), branche et commit (libellé « projet · branche », message du commit dans la notification), case « Afficher les déploiements dans l'île » dans le menu du soleil.
- Choix par défaut : jeton refusé → notification « Reconnecte Vercel » une seule fois, bouton vers la page Connecteurs (comme Spotify), plus de sondage jusqu'à un nouveau jeton ; déploiement annulé → l'activité disparaît sans notification ; seuls les déploiements qui finissent pendant que l'île tourne sont notifiés ; case du menu non mémorisée entre deux lancements (comme la musique).
- Commit sur `main` à la fin, push par Sacha via GitHub Desktop après avoir prévenu Maël (réponse de Sacha).

## Hors périmètre
- Aperçus (preview), autres hébergeurs, lien projet Vercel ↔ projet Sordulo OS, OAuth Vercel, webhooks, chiffrement du jeton au repos (Vault).

## Critères d'acceptation
- [x] (code et tests ; à voir à l'œil connecté, la page demande une session) Page Connecteurs : carte Vercel ; « Connecter » ouvre une fenêtre avec le lien de création du jeton, le jeton est vérifié auprès de Vercel puis enregistré ; « Connecté : <compte> » ; « Déconnecter » ; jeton refusé = message clair ; web et bureau.
- [x] Migration 0008 : chaque compte ne lit, n'écrit et ne supprime que sa ligne (tests RLS).
- [x] (labo vérifié dans Chrome, source testée ; vrai jeton à essayer) Île : un déploiement de production qui construit apparaît en progression « projet · branche », anneau estimé d'après les derniers déploiements du projet.
- [x] (labo vérifié dans Chrome, source testée) Fin : « X est en ligne » avec le message du commit, bouton Ouvrir vers l'adresse de production ; échec : « X : échec », bouton « Voir les logs ».
- [x] (testé) Jeton refusé : « Reconnecte Vercel » une fois, sondage arrêté.
- [x] (Rust compilé sur macOS, source testée) Menu du soleil : « Afficher les déploiements dans l'île » ; décochée = plus de sondage ni d'activité.
- [x] Labo : déploiement réussi et en échec simulés.
- [x] typecheck, lint, tests, build ; Rust compilé sur macOS (`cargo check`, `cargo test --lib`), Windows à compiler chez Maël.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : migration 0008, client `src/lib/vercel.ts`, contrat bureau, wrappers | `supabase/migrations/0008_*`, `src/lib/vercel.ts`, `src/shared/desktop-contract.ts`, `src/lib/desktop.ts` | - | orchestrateur | validé |
| L1 | Carte Vercel de la page Connecteurs, tests du client Vercel, tests RLS 0008 | `src/features/connectors/**`, `src/lib/vercel.test.ts`, `supabase/tests/**` | L0 | sonnet / medium | validé |
| L2 | Source « déploiements » de l'île, notifications, labo | `src/features/island/**` | L0 | opus / high | validé |
| L3 | Rust : case du menu du soleil, état, commande, événement | `src-tauri/src/{tray,state,events,commands,lib}.rs` | L0 | sonnet / medium | validé |

## Journal
- 23/11 Exploration, questions posées. L0 fait par l'orchestrateur (typecheck vert).
- 23/11 L1 (sonnet), L2 (opus), L3 (sonnet) lancés en parallèle.
- 23/11 L3 validé : relu, `cargo check` sans avertissement, `cargo test --lib` 176 verts (macOS seulement ; rustfmt absent).
- 23/11 L1 validé : relu (carte, fenêtre de connexion, hook TanStack Query, tests client + RLS 0008), typecheck / lint / 110 tests verts. Pas de logo Vercel : initiales « VE ».
- 23/11 L2 validé : relu (source deployments.ts, catalogue deployFailed / vercelReconnect, labo), 407 tests de l'île verts.
- 23/11 Validation finale : typecheck, lint, 976 tests, build, `cargo check` + `cargo test --lib` (176) sur macOS. Labo vérifié dans Chrome (progression « PDS OS · main », en ligne, échec). Corrigé par l'orchestrateur : titre d'échec tronqué avant le nom du projet (« Le déploiement de PD… ») → « PDS OS : échec ».

## Rapport
**Fait** : connecteur Vercel lié au compte Sordulo OS et déploiements de production dans l'île. Page Connecteurs : carte Vercel (web et bureau), fenêtre de connexion avec lien de création du jeton, jeton vérifié auprès de Vercel puis gardé dans Supabase, « Connecté : <compte> », « Déconnecter ». Île : progression « projet · branche » pendant la construction, anneau estimé (médiane des 5 derniers déploiements du projet, 15 s à 15 min, 60 s par défaut), puis « X est en ligne » (message du commit, Ouvrir → adresse de production) ou « X : échec » (« Voir les logs »), annulé = rien ; jeton refusé = « Reconnecte Vercel » une fois et sondage arrêté ; case « Afficher les déploiements dans l'île » dans le menu du soleil.

**Fichiers** : `supabase/migrations/0008_vercel_connections.sql`, `src/lib/vercel.ts` (+ test), `src/shared/desktop-contract.ts`, `src/lib/desktop.ts`, `src/features/connectors/**` (carte, `VercelConnectModal`, `useVercel`, `vercelView`), `supabase/tests/{harness,vercel.test}.ts`, `src/features/island/**` (source `deployments.ts` + test, catalogue, types, labo), `src-tauri/src/{tray,state,events,commands,lib}.rs`, `CLAUDE.md`.

**Vérifications** : typecheck, lint, 976 tests (dont client Vercel, RLS 0008, source des déploiements), build ; Rust compilé et testé sur macOS ; labo vérifié dans Chrome.

**Décisions prises sans demander** : jeton plutôt qu'OAuth ; production de toutes les portées du jeton quel que soit l'auteur ; sondage 3 s en cours / 10 s sinon, attente croissante jusqu'à 60 s en erreur ; jeton relu toutes les 60 s ; référence par portée (rien de notifié pour ce qui était fini avant le lancement) ; case du menu non mémorisée ; titre d'échec « X : échec » ; sous-titre « Reconnecte Vercel » : « Le jeton a expiré ou a été révoqué ».

**À faire** :
- Appliquer la migration 0008 en production AVANT de pousser (`npm run db:migrate`).
- Prévenir Maël (île et `src-tauri/` sont son chantier) ; il compile et teste Windows.
- Essai réel : créer un jeton Vercel, le coller dans la carte, pousser sur main et regarder l'île.
- Logo Vercel absent (initiales « VE ») : à exporter du Figma par Sacha.
- Jeton gardé en clair dans Supabase, lisible seulement par son compte (chiffrement au repos hors périmètre).
- La page Connecteurs est réservée aux admins.

**Non retenu** : aperçus (preview), lien projet Vercel ↔ projet Sordulo OS, OAuth, webhooks.
