# Sordulo OS, MVP du 18 novembre (réunion → tickets → tâches)

## Ticket d'origine
Fichier `ticket-mvp-sordulo-os.md` à la racine du repo (texte complet, non modifié).

### Modification du ticket (18/11, ~12h20) : app de bureau Tauri
Sordulo OS devient aussi une app de bureau : Tauri 2 emballe l'app React/Vite existante (un seul code, même interface, fonctions bureau en plus). La version web reste sur Vercel avec le même code. Objectif : Windows pour 20h (PC de Maël), macOS juste après (Mac de Sacha).
Fonction bureau : quand le micro s'active (Meet, Zoom, Teams, n'importe quelle app), proposer « Transcrire cet appel ? » ; si oui, enregistrer micro + son de l'ordi (sans bot), créer une entrée « meeting » dans le projet choisi, et le pipeline existant prend le relais.
Détails : détection Windows par le registre `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone` (sous-clés des apps + `NonPackaged`, actif si `LastUsedTimeStop` = 0, ignorer Sordulo OS), toutes les 2 s ; fenêtre près de la zone de notification avec choix du projet et rappel « Prévenez les participants que l'appel est enregistré » ; WASAPI micro + loopback de la sortie par défaut mixés dans un seul fichier ; proposer d'arrêter quand le micro redevient inactif ; envoi par le même chemin que l'envoi audio manuel (code réutilisé, pas dupliqué) ; icône soleil dans la zone de notification (ouvrir, statut, démarrer/arrêter, quitter), fermeture de la fenêtre = reste actif ; même connexion Supabase ; `npm run tauri dev` suffit ce soir.
macOS (pas ce soir) : réutiliser Coucou (https://github.com/Louis-CFM/coucou, MIT) — `SystemMute.swift` (micro actif) et `NoteAudio.swift` (process tap Core Audio) ; garder le copyright MIT, ne pas utiliser les noms Coucou/Mochi ni leurs sons.
Organisation imposée : lots Rust (src-tauri/) sans fichier front ; un seul lot front bureau, après l'envoi audio manuel qu'il réutilise ; lots Rust en parallèle des lots web. Priorité : retour écrit, validation, kanban, envoi audio manuel, puis bureau. Plan B si le bureau n'est pas prêt à 18h30 : envoi manuel.

## Contexte
Repo vide au départ (LICENSE + ticket). Outil interne de l'agence Sordulo (Maël dev, Sacha design), multi-organisation dès la base.
Parcours visé : entrée (texte collé ou audio) → analyse Claude → tickets proposés avec tâches → validation → kanban attribué.
Depuis la modification du ticket : app de bureau Tauri 2 (`src-tauri/`) qui charge le même front Vite ; fonctions bureau visibles seulement dans Tauri.
Socle posé par l'orchestrateur : Vite 8 + React 19 + TS 6 strict, ESLint 10, Vitest, React Router 7, TanStack Query, Supabase JS, zod 4, SDK Anthropic, `@vercel/functions`. Un plugin Vite (`vite-plugin-api.ts`) sert les fonctions `/api` en dev, sans CLI Vercel.

## Décisions
- Stack, Supabase, Vercel, Claude côté serveur, Storage isolé dans un module, tokens CSS, attribution par le code (source : ticket).
- Transcription : **Deepgram** (nova-3, `language=fr`, `diarize=true`, appel synchrone à partir d'une URL signée) (source : réponse de l'utilisateur).
- Supabase : clés + `SUPABASE_DB_URL` dans `.env.local`, migrations et seed appliqués par scripts Node (`npm run db:migrate`, `npm run db:seed`) (source : réponse de l'utilisateur).
- Emails du seed dans `SEED_MAEL_EMAIL` / `SEED_SACHA_EMAIL`, jamais dans git (source : réponse de l'utilisateur).
- Ajouts retenus : relance sans doublons, réattribution manuelle d'une tâche, noms des voix (`inputs.speaker_names`) (source : réponse de l'utilisateur). Ajout refusé : charge par personne.
- Déploiement : l'utilisateur connecte le repo à Vercel. Je fournis `vercel.json` + README de déploiement (source : réponse de l'utilisateur).
- Git : commits par phase directement sur `main` (source : réponse de l'utilisateur).
- TypeScript 6.0 et non 7 : typescript-eslint supporte au plus `<6.1` (choix par défaut).
- Fonctions `/api` : signature Web `export async function POST(request: Request)`. Les fichiers `api/_lib/*` ne sont pas des routes. Les imports relatifs dans `api/` et `src/shared/` finissent en `.js` (ESM Node) (choix par défaut).
- Traitement asynchrone : `/api/inputs/process` répond 202 et continue via `waitUntil` (`@vercel/functions`), `maxDuration` 300 s. Le front interroge la ligne `inputs` toutes les 2 s (polling plutôt que Realtime, plus simple et fiable ce soir) (choix par défaut).
- Les tâches sont créées en même temps que les tickets proposés, déjà attribuées. Le kanban ne montre que les tâches dont le ticket est `validated` ou `done`. Si on change la compétence d'une tâche à la validation, elle est réattribuée par la même fonction partagée `src/shared/assignment.ts` (choix par défaut).
- Validation, refus et kanban passent par le client Supabase avec la RLS. Seuls l'analyse, la transcription et l'URL d'upload passent par `/api` (clés secrètes) (choix par défaut).
- Modèle Claude : `ANTHROPIC_MODEL`, `claude-opus-5-5` par défaut dans `.env.example`. Sortie structurée via `messages.parse` + `zodOutputFormat`, effort `low` pour tenir sous la minute. Refus (`stop_reason: refusal`) → statut `error` avec message. Pas de `fallbacks` serveur, car le modèle est variable (choix par défaut).
- Liaison compte ↔ membre : trigger sur `auth.users` + RPC `claim_membership()` appelée après connexion (cas d'un compte auth déjà existant). Un email inconnu peut se connecter mais ne voit rien (écran « accès non autorisé ») (choix par défaut).
- Glisser-déposer : HTML5 natif + menu de statut accessible au clavier (pas de librairie) (choix par défaut).
- Supabase : migration appliquée par le SQL Editor (pas de mot de passe DB) et seed par l'API service_role (mêmes UUID fixes que `scripts/db-seed.mjs`). Emails : mael.auzenet@sordulo.com, sacha.moricet@sordulo.com (dans `.env.local` uniquement) (source : réponse de l'utilisateur).
- Clé Anthropic : espace de travail dédié « Sordulo OS », limite 100 $US/mois (la console ne propose que le dollar), clé `sordulo-os` expirant le 18/12/2026. Les crédits « API credit (Max) » (100 $US, octroyés le 12/11, expirent le 06/12) ; aucun moyen de paiement enregistré, donc aucune dépense au-delà (source : réponse de l'utilisateur + console).
- **Repli IA gratuit : Mistral** quand Claude est indisponible (crédits épuisés, limite atteinte, erreur non récupérable). `MISTRAL_API_KEY`, `MISTRAL_MODEL` (défaut `mistral-small-latest`) ; sans clé, pas de repli (source : réponse de l'utilisateur).
- Storage : limite fixe de **50 Mo par fichier** sur le plan Free (vérifiée dans Storage > Settings). `AUDIO_MAX_BYTES` passe à 50 Mo. Enregistrement bureau en **MP3 mono 16 kHz ~32 kb/s** (≈ 15 Mo/h, une heure d'appel passe) (choix par défaut, imposé par la limite).
- Bureau — compilation : pas de droits admin sur le PC, les Build Tools ont échoué (code 1602). Rust installé par rustup (utilisateur) ; **MSVC portable** (compilateur + SDK Windows officiels Microsoft) extrait dans `%LOCALAPPDATA%\msvc` sans admin (source : réponse de l'utilisateur).
- Bureau — connexion : **code à 6 chiffres** en plus du lien magique (le lien s'ouvre dans le navigateur, pas dans Tauri). Modèle d'email « Magic Link » Supabase modifié pour inclure `{{ .Token }}` ; `verifyOtp({ email, token, type: 'email' })` (source : réponse de l'utilisateur).
- Bureau — architecture : contrat IPC dans `src/shared/desktop-contract.ts` ; interface Rust commune `src-tauri/src/platform/mod.rs` (`MicMonitor`, `Recorder`), une implémentation par OS (`platform/windows/` ce soir, `platform/macos/` en stub). Fenêtre `prompt` créée cachée au démarrage, route `/desktop/prompt` : c'est elle qui pilote tout le cycle (démarrer, arrêter, lire le fichier, envoyer via la fonction partagée d'envoi audio, lancer le traitement, supprimer le fichier local) (choix par défaut).
- Bureau — envoi : extraction de la séquence d'envoi de `NewInputModal` dans `src/features/inputs/uploadMeeting.ts`, utilisée par la modal ET par la fenêtre bureau (pas de duplication) (source : ticket).

## Hors périmètre
Devis, factures, contrats, prospection, catalogue, tableau de bord, fichiers projet hors audio, réorganisation auto des tâches, notifications, design final, charge par personne, R2.
Bureau, ce soir : implémentation macOS (lot L13, note ci-dessous), signature, installateur, mises à jour automatiques, build de production de l'app bureau (il faudra alors `VITE_API_BASE_URL` vers Vercel).

## Critères d'acceptation
- [ ] Maël et Sacha se connectent et voient seulement les données de Sordulo.
- [ ] Coller un retour écrit d'Ibé crée des tickets proposés en moins d'une minute.
- [ ] Sur l'écran de validation, on peut modifier, valider ou refuser chaque ticket, et tout valider d'un coup.
- [ ] Les tâches validées apparaissent dans le kanban, attribuées selon la compétence.
- [ ] Une tâche dev qui dépend d'une tâche design l'indique dans le kanban.
- [ ] Un fichier audio d'environ 5 minutes est transcrit avec les voix séparées, puis analysé.
- [ ] Une erreur de transcription ou d'analyse s'affiche clairement, et on peut relancer.
- [ ] Typecheck, lint et build passent. L'app est déployée sur Vercel.
- [ ] Toutes les valeurs de style viennent du fichier de tokens.
- [ ] Sur Windows, un appel Meet de 2 minutes déclenche la proposition, l'enregistrement contient les deux voix (micro + son système), et l'entrée apparaît dans le projet avec ses tickets proposés.
- [ ] La version web (navigateur / Vercel) est identique : aucune fonction bureau visible hors Tauri.
- [ ] L'app bureau reste dans la zone de notification à la fermeture de la fenêtre ; le menu (ouvrir, statut, démarrer/arrêter, quitter) fonctionne.
- [ ] Si Claude est indisponible et qu'une clé Mistral est configurée, l'analyse passe par Mistral.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : config, tokens, contrat de données, client API, plugin dev /api | package.json, tsconfig*, eslint, vite*, vercel.json, .env.example, src/styles/, src/shared/types.ts, src/shared/api-contract.ts, src/lib/ | - | orchestrateur | validé |
| L1 | Base : migrations SQL, RLS, trigger, bucket, scripts migrate/seed | supabase/, scripts/ | L0 | opus / high | validé |
| L2 | Backend : /api (create, process), auth, storage, Deepgram, Claude, attribution, tests | api/, src/shared/* (sauf types.ts, api-contract.ts) | L0 | opus / high | validé |
| L3 | UI kit + shell + auth + liste projets + page projet (onglets, stubs) | src/components/, src/app/, src/features/auth/, src/features/projects/, src/main.tsx, src/features/*/index stubs | L0 | sonnet / medium | validé |
| L4 | Onglet Entrées : nouvelle entrée texte/audio, upload signé, statut, relance, fiche avec transcription et noms des voix | src/features/inputs/ | L3 | sonnet / medium | validé |
| L5 | Écran de validation + onglet Tickets | src/features/review/, src/features/tickets/ | L3 | sonnet / medium | validé |
| L6 | Onglet Tâches : kanban 4 colonnes, DnD + menu, filtre personne, dépendances, réattribution | src/features/tasks/ | L3 | sonnet / medium | validé |
| L7 | Intégration : README, test bout en bout, corrections | README.md + corrections ciblées | L1–L6 | orchestrateur | en cours |
| L8 | Coque Tauri : config, fenêtres main/prompt, zone de notification (soleil), boucle de détection 2 s, commandes IPC, état, single-instance | src-tauri/ (sauf src/platform/**), icônes | contrats L0 bis | opus / high | validé |
| L9 | Windows : détection micro (registre) + capture WASAPI micro + loopback, mix, MP3 16 kHz mono | src-tauri/src/platform/windows/** | contrats L0 bis | opus / high | validé |
| L10 | Front bureau : détection Tauri, `uploadMeeting.ts` partagé (refacto de NewInputModal), fenêtre `/desktop/prompt`, boutons d'enregistrement | src/lib/desktop.ts, src/features/desktop/**, src/features/inputs/uploadMeeting.ts + NewInputModal.tsx, src/app/routes.tsx, src/app/AppLayout.* | L4 (validé), contrat IPC | sonnet / medium | validé |
| L11 | Connexion par code à 6 chiffres (web + bureau) | src/features/auth/LoginPage.tsx (+ son CSS) | L3 | sonnet / low | validé |
| L12 | Repli IA Mistral quand Claude échoue | api/_lib/analysis*.ts, api/_lib/mistral*.ts, tests | L2 | sonnet / medium | validé |
| L13 | macOS (APRÈS ce soir) : `platform/macos/` | src-tauri/src/platform/macos/** | L8, L9 | opus / high | plus tard |

Socle bureau posé par l'orchestrateur (« L0 bis ») : `@tauri-apps/api` + `@tauri-apps/cli` + `@mistralai/mistralai`, script `npm run tauri`, port Vite figé (5173, strictPort), `src/shared/desktop-contract.ts` (contrat IPC), `src-tauri/Cargo.toml`, `src-tauri/src/platform/mod.rs` (interface commune) et `platform/macos/mod.rs` (stub), `AUDIO_MAX_BYTES` = 50 Mo.

### Note pour le lot L13 (macOS, à faire après ce soir)
- Implémenter `CoreAudioMicMonitor` et `CoreAudioRecorder` dans `src-tauri/src/platform/macos/` (le stub et l'interface existent déjà).
- Porter depuis Coucou (https://github.com/Louis-CFM/coucou, licence MIT) : `NotchBuddy/Sources/App/SystemMute.swift` (détection du micro actif via Core Audio) et `NotchBuddy/Sources/App/NoteAudio.swift` (capture du son système par un process tap Core Audio, macOS 14.4+, + micro). Options : appeler du Swift compilé via un petit pont (swift-rs / objc2) ou réécrire en Rust avec `objc2-core-audio`.
- Obligatoire : conserver la mention de copyright MIT d'origine en tête des fichiers portés (et dans un fichier THIRD_PARTY_NOTICES). Ne pas utiliser les noms « Coucou », « Mochi », ni leurs sons.
- Permissions macOS : micro (`NSMicrophoneUsageDescription`) et capture audio système (`NSAudioCaptureUsageDescription`) dans `Info.plist`.
- Sortie identique à Windows : MP3 mono 16 kHz ~32 kb/s, même `RecordingInfo`.

## Journal
(Heures avant 12h30 : estimations, l'horloge réelle était en avance de ~45 min sur ces notes. Heures exactes ensuite.)
- 11:05 Lecture du ticket, exploration (repo vide), questions posées.
- 11:25 L0 socle validé (typecheck, lint, build OK).
- 11:35 L1 (opus/high), L2 (opus/high), L3 (sonnet/medium) lancés en parallèle.
- 11:50 L3 validé (tsc, eslint, 0 valeur en dur ; ajout token --opacity-disabled, import config .ts). L4, L5, L6 lancés.
- 11:55 L1 validé (46/46 tests RLS sur PGlite, lint OK). Reste : appliquer sur le vrai projet dès que .env.local existe.
- 12:05 L6 validé (eslint OK, 17/17 tests, 0 valeur en dur). .env.local créé (gabarit vide) à la demande de l'utilisateur.
- 12:10 L4 validé (tsc OK sur ses fichiers, eslint OK, 0 valeur en dur). À corriger en intégration : Échap pendant l'upload (Modal du kit).
- 12:15 L5 validé (tsc -b, eslint, 65/65 tests, build OK).
- 12:25 L2 validé (create + format.parse au lieu de messages.parse pour lire stop_reason avant parsing : accepté). Modal : prop dismissible. L7 intégration démarrée.
- 12:30 README commité. En attente : .env.local (toutes les clés vides) pour migrate/seed réels, test bout en bout et parcours navigateur.
- 12:45 Migration revue avec le skill supabase-postgres-best-practices : helper RLS déplacé en schéma private, politiques en initplan. 46/46 tests RLS OK.
- 13:00 Nettoyage du projet Supabase (accord explicite de l'utilisateur, « tout, comptes compris ») : schéma public supprimé puis recréé avec les droits Supabase par défaut (22 tables, 2 vues, 44 fonctions d'une ancienne version), 2 comptes auth supprimés, tâches cron retirées, historique supabase_migrations vidé, buckets quote-files (8 fichiers), call-audio (1), quote-pdfs supprimés via l'UI Storage.
- 13:20 Migration appliquée via SQL Editor (contenu vérifié identique au fichier : longueur + hash). Redirect URL localhost:5173/** ajoutée. Clés créées et écrites dans .env.local via presse-papiers (jamais affichées) : Supabase secret, Anthropic (workspace « Sordulo OS », limite 100 $US/mois, expire 18/12/2026), Deepgram (sans expiration). Les 3 clés testées : OK. Reste : emails du seed.
- 12:15 Seed fait par l'API service_role (Sordulo, Maël, Sacha, Ibé, App Ibé). Modification du ticket reçue (app de bureau Tauri) ; questions posées (installation, connexion bureau, emails).
- 12:25 Rust installé (rustup, utilisateur). Build Tools : échec 1602 (pas d'admin) → MSVC portable en cours de téléchargement. Limite Storage vérifiée : 50 Mo. Repli Mistral demandé. Socle bureau (L0 bis) posé.
- 12:44 MSVC portable OK (cargo build hello world). L8, L9 (opus/high), L10, L12 (sonnet/medium), L11 (sonnet/low) lancés. Modèle d'email Supabase non modifiable sans SMTP perso (plan Free) → connexion bureau par collage du lien magique (verifyOtp token_hash) ; L11 relancé avec cette spec.
- 12:56 L11 validé (code ou lien collé, 6/6 tests). L12 validé (repli Mistral, 35 tests api). L10 validé (uploadMeeting partagé + refacto NewInputModal, fenêtre prompt, bouton header ; 88/88 tests, build OK). Mistral : la console indique que le plan Free n'active pas les clés API (bouton « Nouvelle clé » désactivé) → repli inactif tant qu'il n'y a pas de clé utilisable.
- 13:00 E2E réel (Supabase + Claude Opus 5.5) sur un retour écrit type d'Ibé : status ready en 8,6 s, 3 tickets (modification, bug high, new_request), citations exactes, compliment ignoré, 5 tâches : design→Sacha, dev→Maël, dev dépend du design. Entrée de test « Test E2E retours Ibé » laissée en base pour tester l'UI (à supprimer avant la vraie réunion si besoin).
- 13:08 L8 validé (cargo build/clippy/test OK, lancement réel : icône créée, boucle de détection active, single-instance OK ; pas de vérification visuelle, session verrouillée). Contrat : MicApp en camelCase, rustfmt sur platform/mod.rs et macos/mod.rs.
- 13:12 L9 validé (crate complet : clippy 0 warning, 33/33 tests Rust ; détection testée sur un exe qui enregistre, auto-exclusion OK même par chemin court ; MP3 15 s = 61 Ko, 16 kHz mono décodé OK ; loopback non validé avec du son : sortie Windows en sourdine). Décision acceptée : périphérique débranché → silence + réouverture du périphérique par défaut, sans couper l'enregistrement.
- 13:13 App bureau lancée (cargo run, Vite partagé) : démarrage, icône, boucle de détection OK. En attente du test utilisateur (connexion par lien collé, appel Meet de 2 min).
- 14:35 Retour test : le lien de l'email ouvrait le navigateur (localhost) au lieu de l'app bureau. Correctif : schéma `sordulo://auth` associé à l'exe au démarrage (HKCU, sans admin), `emailRedirectTo` = `sordulo://auth` dans l'app bureau, l'URL arrive par single-instance (ou argv au démarrage), la fenêtre principale la lit avec `take_auth_callback` puis `setSession`. Le lien collé reste en secours. À ajouter dans Supabase > Redirect URLs : `sordulo://auth`. Les arrêts de l'app et de Vite venaient du manque de mémoire du PC (Claude Code a stoppé les tâches), pas du clic.
- 14:48 Retour test : la dictée vocale (claude.exe) déclenchait « Transcrire cet appel ? ». Correctif à la demande de l'utilisateur : seules les apps d'appel comptent (navigateurs pour Meet, Zoom, Teams, Slack, Discord, WhatsApp, Webex…, `src-tauri/src/call_apps.rs`), et le micro doit rester actif 6 s avant la proposition. Limite de Supabase sur les emails atteinte : connexion de l'app bureau faite avec un lien généré côté serveur (clé service, en local), ouvert via `sordulo://` ; le chemin du lien de bout en bout est vérifié (303 vers sordulo://auth, l'app reçoit le lien).
