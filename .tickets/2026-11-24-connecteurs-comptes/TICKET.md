# Connecteurs : seulement les comptes de l'utilisateur, plus les services internes de l'app

## Ticket d'origine
« et je veux que dans connector toute les api utilise pour l'app ( deepgram, mistral, supabase,ect ne doit pas être connecter ) si dans le futur quelqu'un veut connecter son supabase pour que l'ia pose des questions il devrait le faire avec son compte, pareil pour Claude, le claude connecté doit être le compte branché pour le mcp pas le compte claude api, et pour spotify le compte ne doit pas être dans le .env tout doit être un jeton » (Sacha, 24/11/2026)

## Décisions (réponses de Sacha, 24/11)
- Deepgram et Mistral : retirés de la page (services internes, pas des connecteurs).
- Supabase : « Bientôt » : brancher SON propre Supabase avec son compte pour que l'IA y pose des questions.
- Claude : la carte montre le relais Claude Code de l'ordinateur (déjà là : Claude dans l'île), Connecter / Déconnecter comme dans le menu du soleil. MCP plus tard. Plus aucun lien avec la clé API Claude de l'app.
- Spotify : Client ID de chacun (son app developer.spotify.com), collé dans la carte, enregistré sur le compte Sordulo OS. Plus de VITE_SPOTIFY_CLIENT_ID.
- Spotify : connexion liée au compte (comme Vercel) : refresh token dans Supabase (table propre à chaque compte), suit le compte sur tous les ordinateurs.
- Plus aucun connecteur au statut « connecté » figé dans le catalogue (le statut `connected` disparaît).

## Lots
| Lot | Objectif | Fichiers possédés | Modèle | Statut |
|---|---|---|---|---|
| L1 | Catalogue + carte Claude Code (commandes connect / disconnect pour la fenêtre principale) | src/features/connectors/{catalog.ts,catalog.test.ts,ConnectorsPage.tsx,connectors.module.css,claudeCode*.ts,useClaudeCode.ts}, src/assets/connectors (suppression deepgram/mistral), src-tauri/src/commands.rs (+ lib.rs, claude/mod.rs si besoin), contrat + desktop.ts (parties Claude) | sonnet | validé |
| L2 | Spotify par compte : migration 0009, lib, Rust, fenêtre du Client ID | supabase/migrations/0009_*, supabase/tests/spotify*, src/lib/spotify*.ts, src-tauri/src/spotify/**, src/features/connectors/{spotify*.ts,useSpotify.ts,SpotifyConnectModal.tsx}, island source si besoin, contrat + desktop.ts (parties Spotify), .env.example | opus | validé |

## Journal
- 24/11 L1 et L2 lancés.
- 24/11 L1 validé (diff relu : catalogue, carte Claude Code, claude_connect / claude_disconnect ; l'événement de connexion part aussi vers la fenêtre principale).
- 24/11 L2 validé (migration 0009 relue). Orchestrateur : fenêtre Spotify branchée dans ConnectorsPage.tsx, détail Spotify du catalogue, VITE_SPOTIFY_CLIENT_ID retiré de vite-env.d.ts, phrase CLAUDE.md.

## Rapport
Fait : Deepgram et Mistral retirés ; Supabase « Bientôt » (son propre projet) ; Claude = relais Claude Code de l'ordinateur (claude_connect / claude_disconnect, réservés à la fenêtre principale) ; Spotify lié au compte (migration 0009 `spotify_connections` + `spotify_replace_refresh_token`, Client ID de chacun, rien sur le disque, rotation gérée entre ordinateurs).
Vérifications : typecheck, lint, npm test (85 fichiers, 1059 tests dont RLS), build, cargo test (207) : OK. Compilé sur macOS seulement.
Reste : appliquer 0009 en prod AVANT de pousser ; Maël compile Windows ; essai réel (Connecter Claude Code depuis la page, Client ID Spotify + autorisation) ; comptes Spotify déjà connectés à reconnecter ; retirer VITE_SPOTIFY_CLIENT_ID des .env.local. EVENT_SPOTIFY_TOKEN déclaré dans spotify/mod.rs plutôt que events.rs (petit écart, à ranger si Maël préfère).
Pas de commit (non demandé).
