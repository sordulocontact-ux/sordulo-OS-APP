# Île : musique de Spotify sur un autre appareil (connecteur Spotify)

## Ticket d'origine
Demande de Maël (21/11) : « j'écoute Spotify sur mon téléphone et c'est le même compte qui est sur Arc. Mais quand c'est mon téléphone qui joue la musique, l'île n'affiche pas la musique […] on va partir sur la connexion Spotify parce que je veux absolument qu'il y ait la pochette. »

## Contexte
- La musique de l'île existe (ticket archivé `2026-11-21-ile-musique`) : lecteur du système (Windows GSMTC, macOS AppleScript) dans `src-tauri/src/music.rs` + `platform/*/media.rs`, événement `desktop://music` (`MusicState`), commandes `get_music`, `get_music_artwork`, `music_command`, source front `controller/sources/music.ts`, rendu (pochette, barres, vue ouverte, Claude devant la musique).
- Quand un autre appareil joue (téléphone, enceinte), l'onglet Spotify d'Arc ne fait que télécommander : aucune lecture sur le PC, donc rien dans l'île.
- Page Connecteurs existante (`src/features/connectors/`, route `/connectors`, admins) : catalogue statique (Claude, Deepgram, Mistral, Supabase connectés ; Gmail, Stripe… « Bientôt »).
- Rust : `reqwest` 0.13 déjà tiré par Tauri (sans TLS), `sha2`, `base64`, `getrandom`, `dirs` disponibles ; serveur local `TcpListener` sur 127.0.0.1 déjà utilisé par le relais Claude.

## Décisions
- Connecteur Spotify par l'API Web officielle, OAuth PKCE sans secret, redirection en boucle locale `http://127.0.0.1:43127/callback` (réponse de Maël + règles Spotify).
- L'ordinateur d'abord : ce qui joue sur le PC passe devant ; Spotify (autre appareil) quand rien ne joue sur le PC (réponse de Maël).
- Connexion et déconnexion dans la page Connecteurs (réponse de Maël : « il y a une page exprès pour les connecteurs »), carte Spotify ; bouton actif seulement dans l'app de bureau.
- Ajouts retenus (réponse de Maël) : nom de l'appareil (« Spotify sur iPhone de Maël »), podcasts (épisodes), avertir si la connexion saute (notification de l'île « Reconnecte Spotify » + carte du connecteur).
- Premium détecté par l'API (`/v1/me`, `product`) : commandes depuis l'île seulement en Premium, sinon boutons masqués (`MusicState.canControl`) (choix par défaut, pas de question).
- Client ID de l'app Spotify : `VITE_SPOTIFY_CLIENT_ID` (`.env.local`, `.env.example`), transmis à Rust par `spotify_connect({ clientId })` et gardé avec les jetons (choix par défaut : pas un secret avec PKCE, suit la config existante).
- Jetons gardés par Rust dans le dossier de données de l'app (`spotify.json`) (choix par défaut).
- Contrat posé par l'orchestrateur : `MusicState.canControl?`, `SpotifyStatus`, `DESKTOP_EVENTS.spotify`, `DESKTOP_COMMANDS.spotifyStatus / spotifyConnect / spotifyDisconnect`, wrappers `src/lib/desktop.ts`, `IslandMusic.canControl`.
- Commits : corrections de l'île committées d'abord (5969629, 23c6e3d), puis Spotify à la fin sur main (réponse de Maël).

## Hors périmètre
- Connecteur Spotify multi-organisation côté serveur, volume, file d'attente, autres services de musique en ligne.
- Page Connecteurs ouverte à tous les rôles (aujourd'hui admins) : à voir plus tard.

## Critères d'acceptation
- [x] Page Connecteurs : carte Spotify ; dans l'app de bureau « Connecter » ouvre Spotify dans le navigateur, puis « Connecté : <compte> » (Premium ou non), « Déconnecter » ; sur le web, indique que c'est dans l'app de bureau ; Client ID manquant = message clair.
- [ ] (à tester par Maël, compte réel) Musique jouée sur le téléphone avec le même compte : l'île l'affiche avec la vraie pochette et ses couleurs, titre, artiste, progression, « Spotify sur <appareil> ».
- [x] Le PC qui joue passe devant Spotify à distance.
- [ ] (à tester par Maël) Premium : précédent / lecture-pause / suivant commandent l'appareil distant ; sans Premium : boutons masqués.
- [x] Podcasts affichés (épisode, émission, pochette).
- [x] Accès perdu : notification de l'île « Reconnecte Spotify », carte en « À reconnecter ».
- [x] Windows et macOS (code HTTP et OAuth partagé, ouverture du navigateur des deux côtés) ; Rust compilé et testé sur Windows.
- [x] typecheck, lint, tests, build, `cargo test --lib`.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Contrat, wrappers, types | `src/shared/desktop-contract.ts`, `src/lib/desktop.ts`, `src/features/island/types.ts`, `.env.example` | - | orchestrateur | validé |
| L1 | Rust : OAuth PKCE, jetons, lecture « en cours » Spotify, fusion avec le lecteur du PC, pochette, commandes, événement et commandes Tauri | `src-tauri/**` | L0 | opus / high | validé |
| L2 | Page Connecteurs : carte Spotify vivante (connexion, état, déconnexion, à reconnecter) | `src/features/connectors/**` | L0 | sonnet / medium | validé |
| L3 | Île : boutons masqués sans Premium, notification « Reconnecte Spotify », labo | `src/features/island/controller/**`, `src/features/island/catalog.ts`, `src/features/island/view/layers/ActivityLayers.tsx`, `src/features/island/lab/**` | L0 | sonnet / medium | validé |

## Journal
- 21/11 Exploration, questions, contrat (L0). Corrections de l'île committées avant (5969629, 23c6e3d).
- 21/11 L1 (opus), L2 et L3 (sonnet) lancés en parallèle.
- 21/11 L2 validé (carte vivante, describeSpotify testé). L3 validé ; l'orchestrateur ajoute le genre de notification `spotifyReconnect` (types.ts, catalogue, labo), `VITE_SPOTIFY_CLIENT_ID` dans vite-env.d.ts, et la hauteur de la vue ouverte sans la ligne des boutons (`MUSIC_OPEN.controlsRow`, paramètre `musicControls` de islandSize, moteur, labo).
- 21/11 L1 validé : relu, `cargo test --lib` 148 verts, `cargo build` sans avertissement (vérifiés par l'orchestrateur). App Spotify « Sordulo OS » créée sur le compte perso de Maël (accord explicite : conditions acceptées), Client ID ajouté à .env.local.
- 21/11 Validation finale : typecheck, lint, 846 tests, build, cargo test / build verts.

## Rapport
**Fait** : connecteur Spotify de l'app de bureau. Page Connecteurs : carte Spotify vivante (Connecter, connexion dans le navigateur, « Connecté : compte » Premium ou gratuit, Déconnecter, À reconnecter, Client ID manquant, web = app de bureau). Rust : OAuth PKCE (127.0.0.1:43127), jetons dans `app_data_dir/spotify.json`, rafraîchissement, `/v1/me/player` (morceaux et épisodes), « Spotify sur <appareil> », pochette téléchargée dans le même cache que celle du PC, fusion avec l'ordinateur d'abord, commandes en Premium, `platform::open_url` Windows et macOS, événement `desktop://spotify`. Île : boutons masqués et vue raccourcie sans Premium, commandes ignorées, notification « Reconnecte Spotify » (une fois par perte), labo (Spotify téléphone sans Premium, notification).

**Fichiers** : `src-tauri/src/spotify/**`, `platform/{windows,macos}/open_url.rs`, `platform/mod.rs`, `music.rs`, `commands.rs`, `events.rs`, `lib.rs`, `Cargo.toml` ; `src/features/connectors/**` ; `src/features/island/` (catalog, sources spotify et music, ActivityLayers, geometry, engine, Island, types, labo) ; contrat, `src/lib/desktop.ts`, `src/vite-env.d.ts`, `.env.example`.

**Vérifications** : typecheck, lint, 846 tests, build ; Rust Windows : `cargo test --lib` 148 verts, `cargo build` sans avertissement, TLS Windows vérifiée par le diagnostic `spotify_joignable`. Non testé : connexion réelle au compte et lecture sur le téléphone (à faire par Maël), macOS (à compiler chez Sacha).

**Décisions prises sans demander** : Premium détecté par l'API ; Client ID par `VITE_SPOTIFY_CLIENT_ID` transmis à Rust ; jetons dans un fichier du dossier de l'app ; `invalid_client` reste une simple erreur (pas « À reconnecter ») ; proxy système non géré (variables d'environnement seulement) ; quand l'appli Spotify du PC montre déjà la même lecture, la source du PC est gardée (nom « Spotify »).

**À faire** : tester la connexion et la musique du téléphone ; ajouter le compte de Sacha dans « User Management » de l'app Spotify ; Sacha compile et teste sur Mac ; page Connecteurs réservée aux admins (à ouvrir aux autres rôles si besoin).
